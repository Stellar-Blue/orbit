import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/integrations/api-helpers';
import { athensToday, getAdminClient, hasSlackBotToken, slackSendDirectMessage } from '@/lib/integrations/server';

/**
 * Daily nudge for the company advance-registration rule (remote_policies.registration_advance_days).
 * guard_remote_day_rules rejects non-admin remote days earlier than today + N, so today is the last
 * chance to declare `today + N` as remote. Every active employee with no office/remote entry for that
 * day gets a Slack DM with a button to the remote log.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const admin = getAdminClient();
  const { data: policy, error: policyError } = await admin
    .from('remote_policies')
    .select('registration_advance_days')
    .eq('scope_type', 'company')
    .limit(1)
    .maybeSingle();
  if (policyError) return NextResponse.json({ success: false, error: policyError.message }, { status: 500 });
  const advanceDays: number = policy?.registration_advance_days ?? 0;

  const today = athensToday();
  const [y, m, d] = today.split('-').map(Number);
  const targetDate = new Date(Date.UTC(y, m - 1, d + advanceDays));
  const target = targetDate.toISOString().slice(0, 10);
  const base = { job: 'cron/remote-registration-reminder', timestamp: new Date().toISOString(), today, target, advanceDays };

  if (advanceDays <= 0) return NextResponse.json({ success: true, ...base, skipped: 'rule_disabled' });
  if (targetDate.getUTCDay() === 0 || targetDate.getUTCDay() === 6) {
    return NextResponse.json({ success: true, ...base, skipped: 'weekend' });
  }
  if (!hasSlackBotToken()) {
    return NextResponse.json({ success: false, ...base, error: 'SLACK_BOT_TOKEN is not configured' }, { status: 500 });
  }

  // Same days the remote calendar refuses to take a declaration for.
  const [holidays, closures] = await Promise.all([
    admin.from('public_holidays').select('id').eq('date', target).limit(1),
    admin.from('mandatory_leaves').select('id').neq('status', 'cancelled').lte('start_date', target).gte('end_date', target).limit(1),
  ]);
  if (holidays.data?.length || closures.data?.length) {
    return NextResponse.json({ success: true, ...base, skipped: 'company_day_off' });
  }

  const [profiles, registered, leave, slack] = await Promise.all([
    admin.from('profiles').select('id, first_name, work_email').eq('status', 'active').neq('employment_type', 'contractor'),
    admin.from('remote_days').select('profile_id').eq('date', target),
    admin.from('leave_requests').select('profile_id').in('status', ['approved', 'in_progress', 'taken'])
      .lte('start_date', target).gte('end_date', target),
    admin.from('employee_integrations').select('profile_id, external_user_id').eq('provider', 'slack'),
  ]);
  // A failed lookup would read as "nobody registered" and DM the whole company — bail instead.
  const queryError = profiles.error || registered.error || leave.error || slack.error;
  if (queryError) return NextResponse.json({ success: false, ...base, error: queryError.message }, { status: 500 });

  const covered = new Set([...(registered.data || []), ...(leave.data || [])].map(r => r.profile_id as string));
  const slackIds = new Map((slack.data || []).filter(r => r.external_user_id).map(r => [r.profile_id as string, r.external_user_id as string]));
  const recipients = (profiles.data || []).filter(p => p.work_email && !covered.has(p.id)) as
    { id: string; first_name: string; work_email: string }[];

  const dayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(targetDate);
  const remoteUrl = `${(process.env.NEXT_PUBLIC_APP_URL || 'https://app.orbit.stellarblue.eu').replace(/\/+$/, '')}/remote`;
  const advanceLabel = `${advanceDays} day${advanceDays === 1 ? '' : 's'}`;

  // ponytail: sequential DMs, fine for a few dozen employees; batch if Slack starts rate limiting.
  let sent = 0;
  const failed: string[] = [];
  for (const profile of recipients) {
    const text = `Hi ${profile.first_name}, you haven't registered where you'll work on *${dayLabel}*. `
      + `Today is the last day to declare it as remote (remote days must be registered ${advanceLabel} in advance). `
      + 'Please log it as office or remote in Orbit.';
    const result = await slackSendDirectMessage({
      email: profile.work_email,
      userId: slackIds.get(profile.id) || null,
      text,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `:house_with_garden: ${text}` } },
        {
          type: 'actions',
          elements: [{
            type: 'button',
            action_id: 'open_remote_log',
            style: 'primary',
            text: { type: 'plain_text', text: 'Log work location' },
            url: remoteUrl,
          }],
        },
      ],
    });
    if (result.ok) sent += 1;
    else failed.push(`${profile.id}:${result.error || 'unknown'}`);
  }

  return NextResponse.json({ success: true, ...base, unregistered: recipients.length, sent, failed });
}
