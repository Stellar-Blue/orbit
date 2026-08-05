import { NextResponse } from 'next/server';

const PAGE_LIMIT = 200;
const MAX_PAGES = 5; // up to 1,000 companies per sync

interface AttioValueItem {
  option?: { title?: string };
  status?: { title?: string };
  root_domain?: string;
  email_address?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  currency_value?: number | string;
  value?: string | number | boolean | AttioValueItem;
  title?: string;
  name?: string;
}

interface RawAttioRecord {
  id?: { record_id?: string } | string;
  values?: Record<string, AttioValueItem[]>;
}

/**
 * Safely extracts a display string from an Attio v2 record value.
 * Handles every documented value shape at both the item level and the
 * `value`-wrapped level (webhook-style payloads):
 *  - select:        option.title | value.option.title
 *  - status:        status.title | value.status.title
 *  - text/number:   value
 *  - checkbox/date: value
 *  - domain:        root_domain | value.root_domain
 *  - email:         email_address | value.email_address
 *  - personal-name: full_name / first_name last_name | value.full_name
 *  - currency:      currency_value
 *  - raw string item
 */
function extractValue(item: unknown): string {
  if (item == null) return '';
  if (typeof item === 'string') return item;

  const candidates: AttioValueItem[] = [];
  if (typeof item === 'object') {
    candidates.push(item as AttioValueItem);
    const wrapped = (item as AttioValueItem).value;
    if (wrapped !== null && typeof wrapped === 'object') candidates.push(wrapped as AttioValueItem);
  }

  for (const c of candidates) {
    if (c.option && typeof c.option === 'object' && c.option.title) return String(c.option.title);
    if (c.status && typeof c.status === 'object' && c.status.title) return String(c.status.title);
    if (c.root_domain) return String(c.root_domain);
    if (c.email_address) return String(c.email_address);
    if (c.full_name) return String(c.full_name);
    if (c.first_name || c.last_name) return [c.first_name, c.last_name].filter(Boolean).join(' ');
    if (c.currency_value !== undefined && c.currency_value !== null) return String(c.currency_value);
    const scalar = c.value;
    if (typeof scalar === 'string' || typeof scalar === 'number' || typeof scalar === 'boolean') {
      return String(scalar);
    }
    if (c.title) return String(c.title);
    if (c.name) return String(c.name);
  }
  return '';
}

function getValue(record: RawAttioRecord, slugs: string[]): string {
  if (!record.values) return '';
  for (const slug of slugs) {
    const field = record.values[slug];
    if (Array.isArray(field) && field.length > 0) {
      const extracted = extractValue(field[0]);
      if (extracted) return extracted;
    }
  }
  return '';
}

async function queryAttioCompanies(token: string, objectSlug: string, offset: number): Promise<{ ok: boolean; status: number; records: RawAttioRecord[] }> {
  const response = await fetch(`https://api.attio.com/v2/objects/${objectSlug}/records/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ limit: PAGE_LIMIT, offset }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    return { ok: false, status: response.status, records: [] };
  }
  const data = await response.json();
  const records = Array.isArray(data?.data) ? data.data : [];
  return { ok: true, status: 200, records };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, attributeSlug, whitelistValues } = body;

    const cleanToken = (token || '').trim();
    const targetSlug = attributeSlug || 'relationship_type';
    const targetWhitelist: string[] = Array.isArray(whitelistValues) ? whitelistValues : [];

    if (!cleanToken || cleanToken.length < 8) {
      return NextResponse.json(
        { success: false, error: 'No Attio API Key configured. Please save your valid Attio Access Token in Orbit Settings.' },
        { status: 400 }
      );
    }

    // Paginate through the workspace's companies (200 per page, up to 1,000)
    const allRecords: RawAttioRecord[] = [];
    let primaryObject = 'companies';
    for (let offset = 0; offset < MAX_PAGES * PAGE_LIMIT; offset += PAGE_LIMIT) {
      let res = await queryAttioCompanies(cleanToken, primaryObject, offset);

      // If the plural slug 404s, retry the singular object name for this workspace schema
      if (!res.ok && res.status === 404 && offset === 0) {
        primaryObject = 'company';
        res = await queryAttioCompanies(cleanToken, primaryObject, offset);
      }

      if (!res.ok) {
        const errorMsg = `Attio API returned HTTP ${res.status} on /objects/${primaryObject}/records/query. Please verify your API Key has Read Records permissions in Attio.`;
        return NextResponse.json({ success: false, error: errorMsg }, { status: res.status });
      }

      allRecords.push(...res.records);
      if (res.records.length < PAGE_LIMIT) break;
    }

    const liveCompanies = allRecords.map((rec: RawAttioRecord) => {
      const recordId = typeof rec.id === 'string' ? rec.id : (rec.id?.record_id || 'attio_unknown_id');

      const name = getValue(rec, ['name', 'company_name', 'title', 'legal_name', 'company']) || `Attio Entity (${String(recordId).slice(-6)})`;
      const relationship = getValue(rec, [targetSlug, 'relationship_type', 'relationship_status', 'status', 'type', 'category']) || '';
      const countryRaw = getValue(rec, ['country', 'billing_country', 'country_code', 'hq_country']) || 'Europe';
      const vat = getValue(rec, ['vat', 'vat_number', 'tax_id', 'registration_number', 'afm', 'tax_code']) || '';
      const domain = getValue(rec, ['domain', 'website', 'url', 'company_domain', 'web_address', 'domains']) || '';
      const arrRaw = getValue(rec, ['arr', 'estimated_arr', 'mrr', 'revenue', 'value', 'contract_value', 'estimated_arr_usd']);

      let role: 'client' | 'supplier' | 'both' = 'client';
      const relLow = relationship.toLowerCase();
      if (relLow.includes('suppl') || relLow.includes('vendor') || relLow.includes('cost')) {
        role = 'supplier';
      } else if (relLow.includes('both') || relLow.includes('partner') || relLow.includes('joint')) {
        role = 'both';
      }

      let estArr = 0;
      if (arrRaw && !isNaN(Number(arrRaw))) {
        estArr = Number(arrRaw);
      }

      const qualifies = targetWhitelist.length > 0
        ? targetWhitelist.some((val: string) =>
            relationship.toLowerCase() === val.toLowerCase() ||
            relationship.toLowerCase().includes(val.toLowerCase())
          )
        : true;

      return {
        attio_record_id: recordId,
        legal_name: name,
        relationship_status: relationship,
        country_code: countryRaw.length === 2 ? countryRaw.toUpperCase() : countryRaw,
        vat_number: vat || 'N/A in Attio',
        domain: domain,
        suggested_role: role,
        estimated_arr: estArr,
        qualified: qualifies
      };
    });

    return NextResponse.json({
      success: true,
      source: 'live_attio_api',
      count: liveCompanies.length,
      qualifiedCount: liveCompanies.filter((c: { qualified?: boolean }) => c.qualified).length,
      companies: liveCompanies
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Timeout or network exception';
    return NextResponse.json(
      { success: false, error: `Server network error connecting to Attio: ${errMsg}` },
      { status: 500 }
    );
  }
}
