import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/integrations/api-helpers';
import { athensToday, computeDayState, deliverSlackOutbox, enqueueOutbox, getAdminClient, getSlackSettings } from '@/lib/integrations/server';
import { syncOutlookForProfile } from '@/lib/integrations/outlook';
import { syncIssuedInvoices } from '@/lib/integrations/mydata';

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const admin = getAdminClient();
  const settings = await getSlackSettings(admin);
  const today = athensToday();

  // Every active employee. Outlook mirroring applies to all of them; the Slack
  // status mirror covers the admin-required set plus optional users who connected.
  const { data: activeProfiles } = await admin
    .from('profiles')
    .select('id, employment_type, slack_required')
    .eq('status', 'active');

  const { data: connectedSlack } = await admin
    .from('employee_integrations')
    .select('profile_id')
    .eq('provider', 'slack')
    .eq('status', 'connected');
  const connectedSlackIds = new Set((connectedSlack || []).map(i => i.profile_id));

  // 1. Enqueue today's status mirror for every active employee who needs one
  const profiles = (activeProfiles || []).filter(
    p => (p as { slack_required?: boolean }).slack_required || connectedSlackIds.has(p.id)
  );

  const ops: Array<{ provider: 'slack'; operation: string; orbit_kind: string; orbit_id: string; payload: Record<string, unknown>; idempotency_key: string; ordering_key: string }> = [];
  let leaveCount = 0;
  let remoteCount = 0;

  for (const profile of profiles as { id: string; employment_type: string }[]) {
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

  // 3. Outlook calendar mirroring (leave + remote events, next 60 days per settings).
  //    Independent of the Slack requirement — every active employee is mirrored.
  const outlookSummary = { ok: 0, skipped: 0, errors: [] as string[] };
  for (const profile of (activeProfiles || []) as { id: string }[]) {
    const r = await syncOutlookForProfile(admin, profile.id);
    const failing = !!r.skipped && r.skipped !== 'no_credentials' && r.skipped !== 'disabled';
    if (failing) outlookSummary.errors.push(`${profile.id}:${r.skipped}`);
    else if (r.ok) outlookSummary.ok += 1;
    else outlookSummary.skipped += 1;
    // Work-plan writes fail independently of the calendar pass (delegated consent, Graph shape
    // changes) — report them instead of letting them disappear.
    for (const e of r.workPlan?.errors || []) outlookSummary.errors.push(`${profile.id}:${e}`);
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
    profilesScanned: (activeProfiles || []).length,
    slackRequiredProfiles: profiles.length,
    leaveDaysToday: leaveCount,
    remoteDaysToday: remoteCount,
    enqueued,
    delivery: summary,
    outlook: outlookSummary,
    mydata,
  });
}
