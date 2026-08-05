import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, getSlackSettings } from '@/lib/integrations/server';
import { getGraphSettings } from '@/lib/integrations/outlook';
import { DEFAULT_SLACK_SETTINGS } from '@/lib/integrations/types';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';

export async function GET() {
  const admin = getAdminClient();
  const settings = await getSlackSettings(admin);
  const outlook = await getGraphSettings(admin);
  const { data: lastReconciled } = await admin
    .from('integration_settings')
    .select('value')
    .eq('provider', 'slack')
    .eq('key', 'last_reconciled_at')
    .maybeSingle();
  return NextResponse.json({ settings, outlook, lastReconciledAt: lastReconciled?.value || null });
}

export async function PUT(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    provider?: 'slack' | 'm365';
    settings?: Record<string, string>;
    outlook?: { leave_label?: string; remote_label?: string; half_day_label?: string; enabled?: boolean };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const admin = getAdminClient();
  const provider = body.provider === 'm365' ? 'm365' : 'slack';

  if (provider === 'slack') {
    const allowed = Object.keys(DEFAULT_SLACK_SETTINGS);
    for (const [key, value] of Object.entries(body.settings || {})) {
      if (!allowed.includes(key) || typeof value !== 'string') continue;
      await admin.from('integration_settings').upsert({ provider: 'slack', key, value }, { onConflict: 'provider,key' });
    }
  } else {
    const o = body.outlook || {};
    const entries: Array<[string, string]> = [];
    if (typeof o.leave_label === 'string') entries.push(['leave_label', o.leave_label]);
    if (typeof o.remote_label === 'string') entries.push(['remote_label', o.remote_label]);
    if (typeof o.half_day_label === 'string') entries.push(['half_day_label', o.half_day_label]);
    if (typeof o.enabled === 'boolean') entries.push(['enabled', String(o.enabled)]);
    for (const [key, value] of entries) {
      await admin.from('integration_settings').upsert({ provider: 'm365', key, value }, { onConflict: 'provider,key' });
    }
  }

  return NextResponse.json({
    ok: true,
    settings: await getSlackSettings(admin),
    outlook: await getGraphSettings(admin),
  });
}
