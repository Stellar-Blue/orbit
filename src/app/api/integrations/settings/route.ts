import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, getSlackSettings } from '@/lib/integrations/server';
import { DEFAULT_SLACK_SETTINGS } from '@/lib/integrations/types';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';

export async function GET() {
  const admin = getAdminClient();
  const settings = await getSlackSettings(admin);
  const { data: lastReconciled } = await admin
    .from('integration_settings')
    .select('value')
    .eq('provider', 'slack')
    .eq('key', 'last_reconciled_at')
    .maybeSingle();
  return NextResponse.json({ settings, lastReconciledAt: lastReconciled?.value || null });
}

export async function PUT(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Partial<typeof DEFAULT_SLACK_SETTINGS>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const allowed = Object.keys(DEFAULT_SLACK_SETTINGS);
  const entries = Object.entries(body).filter(([k, v]) => allowed.includes(k) && typeof v === 'string');

  const admin = getAdminClient();
  for (const [key, value] of entries) {
    await admin.from('integration_settings').upsert({
      provider: 'slack',
      key,
      value: value as string,
    }, { onConflict: 'provider,key' });
  }

  return NextResponse.json({ ok: true, settings: await getSlackSettings(admin) });
}
