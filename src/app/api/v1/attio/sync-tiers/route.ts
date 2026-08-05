import { NextResponse } from 'next/server';

// Syncs counterparty tiers to the linked Attio company records as a single-select
// attribute (orbit_tier). Idempotent: creates the attribute + options if missing,
// archives nothing here (n-change archiving is a settings-time operation), then
// re-asserts each record's current tier label.

const ATTR_SLUG = 'orbit_tier';

async function attioFetch(path: string, token: string, init: RequestInit = {}) {
  return fetch(`https://api.attio.com/v2${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(init.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
}

async function ensureAttribute(token: string): Promise<{ attributeId?: string; error?: string }> {
  // List attributes to find the orbit_tier attribute (by slug or title)
  const listRes = await attioFetch('/attributes?object=companies', token);
  if (listRes.ok) {
    const list = await listRes.json();
    const existing = (list.data || []).find(
      (a: { api_slug?: string; title?: string; id?: { attribute_id?: string } | string }) =>
        a.api_slug === ATTR_SLUG || (a.title && a.title.toLowerCase().includes('orbit tier'))
    );
    if (existing) return { attributeId: existing.id?.attribute_id || existing.id };
  }

  // Create the select attribute (single-select)
  const createRes = await attioFetch('/attributes', token, {
    method: 'POST',
    body: JSON.stringify({
      object: 'companies',
      data: {
        api_slug: ATTR_SLUG,
        title: 'Orbit Tier',
        description: 'Tier 1 = highest; maintained by Orbit — do not edit',
        type: 'select',
        config: { multi: false }
      }
    })
  });
  if (createRes.ok) {
    const created = await createRes.json();
    return { attributeId: created.data?.id?.attribute_id || created.data?.id };
  }
  if (createRes.status === 409 || createRes.status === 422) {
    // Likely already exists — re-list
    const listRes2 = await attioFetch('/attributes?object=companies', token);
    if (listRes2.ok) {
      const list2 = await listRes2.json();
      const existing = (list2.data || []).find(
        (a: { api_slug?: string; title?: string; id?: { attribute_id?: string } | string }) =>
          a.api_slug === ATTR_SLUG || (a.title && a.title.toLowerCase().includes('orbit tier'))
      );
      if (existing) return { attributeId: existing.id?.attribute_id || existing.id };
    }
  }
  const errText = await createRes.text().catch(() => '');
  return { error: `Attribute create failed (HTTP ${createRes.status}): ${errText.slice(0, 200)}` };
}

async function ensureOptions(token: string, attributeId: string, labels: string[]): Promise<{ error?: string }> {
  // List current options
  let existing: string[] = [];
  const listRes = await attioFetch(`/attributes/${attributeId}/select-options`, token);
  if (listRes.ok) {
    const data = await listRes.json();
    existing = (data.data || []).map((o: { title?: string }) => (o.title || '').toLowerCase());
  }

  for (const label of labels) {
    if (existing.includes(label.toLowerCase())) continue;
    const createRes = await attioFetch(`/attributes/${attributeId}/select-options`, token, {
      method: 'POST',
      body: JSON.stringify({ data: { title: label } })
    });
    if (!createRes.ok && createRes.status !== 409) {
      // Option creation is best-effort; values can still be written by title
      console.warn(`[tier-sync] option create failed for ${label}: HTTP ${createRes.status}`);
    }
  }
  return {};
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, records, tierCount } = body;

    const cleanToken = (token || '').trim();
    const recordsList: Array<{ record_id: string; tier_label: string }> = Array.isArray(records) ? records : [];
    const n = Math.max(2, Math.min(10, Number(tierCount) || 4));

    if (!cleanToken || cleanToken.length < 8) {
      return NextResponse.json({ success: false, error: 'No Attio API Key configured.' }, { status: 400 });
    }
    if (recordsList.length === 0) {
      return NextResponse.json({ success: true, synced: 0, warning: 'No linked records to sync.' });
    }

    const labels = Array.from({ length: n }, (_, i) => `Tier ${i + 1}`).concat(['Unrated']);

    const attr = await ensureAttribute(cleanToken);
    if (attr.error) {
      return NextResponse.json({ success: false, error: attr.error }, { status: 502 });
    }

    await ensureOptions(cleanToken, attr.attributeId as string, labels);

    let synced = 0;
    let failures = 0;
    for (const rec of recordsList) {
      const patchRes = await attioFetch(`/objects/companies/records/${rec.record_id}`, cleanToken, {
        method: 'PATCH',
        body: JSON.stringify({ data: { values: { [ATTR_SLUG]: rec.tier_label } } })
      });
      if (patchRes.ok) synced++;
      else failures++;
    }

    return NextResponse.json({
      success: true,
      synced,
      failures,
      attribute: ATTR_SLUG,
      options: labels,
      note: 'Single-select orbit_tier attribute; label only — score & breakdown never leave Orbit.'
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Network or timeout exception';
    return NextResponse.json({ success: false, error: `Attio tier sync error: ${errMsg}` }, { status: 500 });
  }
}
