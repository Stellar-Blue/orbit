import { NextRequest, NextResponse } from 'next/server';
import { athensToday, computeDayState, deliverSlackOutbox, enqueueOutbox, getAdminClient, getSlackSettings } from '@/lib/integrations/server';
import { syncOutlookForProfile } from '@/lib/integrations/outlook';
import { syncIssuedInvoices } from '@/lib/integrations/mydata';
import { GATED_EMPLOYMENT_TYPES } from '@/lib/integrations/types';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized & Invalid Cron Secret' }, { status: 401 });
  }

  const admin = getAdminClient();
  const settings = await getSlackSettings(admin);
  const today = athensToday();

  // 1. Enqueue today's status mirror for every active gated employee
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, employment_type')
    .in('employment_type', GATED_EMPLOYMENT_TYPES)
    .eq('status', 'active');

  const ops: Array<{ provider: 'slack'; operation: string; orbit_kind: string; orbit_id: string; payload: Record<string, unknown>; idempotency_key: string; ordering_key: string }> = [];
  let leaveCount = 0;
  let remoteCount = 0;

  for (const profile of (profiles || []) as { id: string; employment_type: string }[]) {
    const state = await computeDayState(admin, settings, profile.id, today);
    if (state.kind === 'none') continue;
    if (state.kind === 'leave') leaveCount += 1;
    if (state.kind === 'remote') remoteCount += 1;
    ops.push({
      provider: 'slack',
      operation: 'status_sync',
      orbit_kind: state.kind,
      orbit_id: state.leaveId || profile.id,
      payload: { profile_id: profile.id, date: today, source: 'morning_job' },
      idempotency_key: `slack:status:${profile.id}:${today}:${Date.now()}`,
      ordering_key: `slack:${profile.id}:${today}`,
    });
  }

  const enqueued = await enqueueOutbox(admin, ops);

  // 2. Drain the outbox (morning set + any immediate ops that queued up)
  const summary = await deliverSlackOutbox(admin, 100);

  // 3. Outlook calendar mirroring (leave + remote events, next 60 days per settings)
  const outlookSummary = { ok: 0, skipped: 0, errors: [] as string[] };
  for (const profile of (profiles || []) as { id: string }[]) {
    const r = await syncOutlookForProfile(admin, profile.id);
    if (r.ok) outlookSummary.ok += 1;
    else if (r.skipped && r.skipped !== 'no_credentials' && r.skipped !== 'disabled') {
      outlookSummary.errors.push(`${profile.id}:${r.skipped}`);
    } else {
      outlookSummary.skipped += 1;
    }
  }

  // 4. Reconciliation checkpoint
  await admin.from('integration_settings').upsert({
    provider: 'slack',
    key: 'last_reconciled_at',
    value: new Date().toISOString(),
    description: 'Last nightly/morning integration reconciliation checkpoint',
  }, { onConflict: 'provider,key' });

  // 5. AADE myDATA issued-invoice import (automatic, when credentials are configured)
  let mydata;
  try {
    mydata = await syncIssuedInvoices(admin);
  } catch (e) {
    mydata = { configured: true, ran: true, error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({
    success: true,
    job: 'cron/integration-daily',
    timestamp: new Date().toISOString(),
    today,
    profilesScanned: (profiles || []).length,
    leaveDaysToday: leaveCount,
    remoteDaysToday: remoteCount,
    enqueued,
    delivery: summary,
    outlook: outlookSummary,
    mydata,
  });
}
