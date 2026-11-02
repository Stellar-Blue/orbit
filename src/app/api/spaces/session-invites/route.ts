import { NextRequest, NextResponse } from 'next/server';
import { athensToday, getAdminClient, hasSlackBotToken, slackSendDirectMessage } from '@/lib/integrations/server';
import { ATHENS_TIMEZONE } from '@/lib/integrations/types';
import { cancelSessionCalendarInvite, sendSessionCalendarInvite } from '@/lib/integrations/outlook';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { EMPLOYEE_INTEGRATION_COLUMNS, type EmployeeIntegration } from '@/lib/integrations/types';
import { normalizeInviteEmail } from '@/lib/spaces';
import type { SessionInviteStatus } from '@/lib/types';

/**
 * Inviting people to a conference-room session.
 *
 * An address that belongs to an active Orbit colleague is invited on Slack — a direct message from
 * the Orbit bot. An address that is not an Orbit user can only be reached by email, so it is always
 * carried by the Outlook meeting invite. When the organiser ticks "include an Outlook invite", the
 * colleagues get one too, so the meeting lands in their calendar next to the Slack message.
 *
 * Seats are booked for the Orbit invitees as part of the invite: the room's capacity trigger has the
 * final word, so a session that is already full reports "invited without a seat" instead of failing
 * the whole batch.
 */

/** A room of eight does not need a hundred addresses typed into one dialog. */
const MAX_INVITES = 50;

interface InviteRequest {
  session_id?: string;
  emails?: string[];
  include_outlook?: boolean;
}

interface RecipientResult {
  email: string;
  profile_id: string | null;
  name: string | null;
  /** `booked` | `already` | `full` | `none` for external guests | `failed`. */
  seat: 'booked' | 'already' | 'full' | 'none' | 'failed';
  slack_status: SessionInviteStatus;
  outlook_status: SessionInviteStatus;
  slack_error?: string;
  outlook_error?: string;
}

const clock = (value: string): string => String(value || '').slice(0, 5);

const longDate = (dateStr: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ATHENS_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${dateStr}T12:00:00Z`));

const personName = (
  profile?: { first_name?: string | null; last_name?: string | null; work_email?: string | null } | null
): string =>
  [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || profile?.work_email || 'An Orbit colleague';

export async function POST(request: NextRequest) {
  const caller = await requireApiSession(request);
  if (isNextResponse(caller)) return caller;

  const body = await request.json().catch(() => null) as InviteRequest | null;
  const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
  if (!sessionId) {
    return NextResponse.json({ error: 'Choose the session to invite people to.' }, { status: 400 });
  }

  const emails = Array.from(new Set(
    (Array.isArray(body?.emails) ? body!.emails : [])
      .map(value => normalizeInviteEmail(String(value)))
      .filter((email): email is string => Boolean(email))
  ));
  if (emails.length === 0) {
    return NextResponse.json({ error: 'Add at least one valid email address.' }, { status: 400 });
  }
  if (emails.length > MAX_INVITES) {
    return NextResponse.json({ error: `Invite at most ${MAX_INVITES} people at a time.` }, { status: 400 });
  }
  const includeOutlook = Boolean(body?.include_outlook);

  const admin = getAdminClient();

  const { data: sessionRow, error: sessionError } = await admin
    .from('space_sessions')
    .select('id, space_id, session_date, starts_at, ends_at, title, created_by')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
  if (!sessionRow) return NextResponse.json({ error: 'That session no longer exists.' }, { status: 404 });

  if (!caller.isAdmin && sessionRow.created_by !== caller.profileId) {
    return NextResponse.json(
      { error: 'Only the person who opened this session, or an administrator, can invite people.' },
      { status: 403 }
    );
  }

  // A session on a past day is history; same-day invitations stay possible right up to the window.
  if (sessionRow.session_date < athensToday()) {
    return NextResponse.json({ error: 'That session is already over.' }, { status: 400 });
  }

  const { data: spaceRow } = await admin
    .from('spaces')
    .select('id, name, location')
    .eq('id', sessionRow.space_id)
    .maybeSingle();
  const { data: organizerRow } = await admin
    .from('profiles')
    .select('id, first_name, last_name, work_email')
    .eq('id', sessionRow.created_by || caller.profileId)
    .maybeSingle();

  // One directory read, matched in JS: `work_email` casing in the database is not guaranteed, and an
  // address typed in capitals must still be recognised as the colleague it belongs to.
  const { data: directory } = await admin
    .from('profiles')
    .select('id, first_name, last_name, work_email, status');
  const byEmail = new Map(
    (directory || [])
      .filter(profile => profile.status !== 'departed' && profile.work_email)
      .map(profile => [String(profile.work_email).trim().toLowerCase(), profile] as const)
  );

  // The Slack identity of the colleagues being invited, so the bot does not have to look it up when
  // the connection already stored it.
  const orbitProfiles = emails
    .map(email => byEmail.get(email))
    .filter(Boolean) as { id: string; first_name?: string | null; last_name?: string | null; work_email: string }[];
  const slackIdentity = new Map<string, string>();
  if (orbitProfiles.length > 0) {
    const { data: integrations } = await admin
      .from('employee_integrations')
      .select(EMPLOYEE_INTEGRATION_COLUMNS)
      .eq('provider', 'slack')
      .in('profile_id', orbitProfiles.map(profile => profile.id));
    (integrations || []).forEach((row: EmployeeIntegration) => {
      if (row.external_user_id) slackIdentity.set(row.profile_id, row.external_user_id);
    });
  }

  const roomName = spaceRow?.name || 'the meeting room';
  const roomLocation = spaceRow?.location || null;
  const organizerName = personName(organizerRow);
  const organizerEmail = organizerRow?.work_email || '';
  const organizerProfileId = organizerRow?.id || caller.profileId;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  const when = `${longDate(sessionRow.session_date)} · ${clock(sessionRow.starts_at)} – ${clock(sessionRow.ends_at)}`;

  const results: RecipientResult[] = [];

  for (const email of emails) {
    const profile = byEmail.get(email);
    if (!profile) {
      // External guest: no Orbit profile, so there is no seat to book and no Slack to message. The
      // Outlook invite below is the only way to reach them.
      results.push({
        email, profile_id: null, name: null, seat: 'none',
        slack_status: 'skipped', outlook_status: 'skipped',
      });
      continue;
    }

    const { error: seatError } = await admin.from('space_bookings').insert([{
      space_id: sessionRow.space_id,
      session_id: sessionRow.id,
      profile_id: profile.id,
      booking_date: sessionRow.session_date,
      created_by: caller.profileId,
    }]);
    const seat: RecipientResult['seat'] = !seatError
      ? 'booked'
      : seatError.code === '23505'
        ? 'already'
        : /full|fully booked/i.test(seatError.message)
          ? 'full'
          : 'failed';

    const seatLine = seat === 'booked'
      ? 'A seat is reserved for you.'
      : seat === 'already'
        ? 'You already hold a seat in this session.'
        : seat === 'full'
          ? 'The room is full, so no seat could be reserved — ask the organiser.'
          : '';
    const text = [
      `:calendar: *${sessionRow.title?.trim() || 'Meeting'}* in *${roomName}*`,
      when,
      '',
      `${organizerName} invited you to a session booked in Orbit.`,
      seatLine,
      ...(appUrl ? ['', `Join or review it: ${appUrl}/spaces`] : []),
    ].filter(Boolean).join('\n');

    let slackStatus: SessionInviteStatus = 'failed';
    let slackError: string | undefined;
    if (!hasSlackBotToken()) {
      slackError = 'Slack bot token is not configured';
    } else {
      const sent = await slackSendDirectMessage({
        email,
        userId: slackIdentity.get(profile.id) || null,
        text,
      });
      slackStatus = sent.ok ? 'sent' : 'failed';
      slackError = sent.ok ? undefined : `Slack: ${sent.error || 'unknown error'}`;
    }

    results.push({
      email, profile_id: profile.id, name: personName(profile), seat,
      slack_status: slackStatus, outlook_status: 'skipped',
      ...(slackError ? { slack_error: slackError } : {}),
    });
  }

  // Every address gets the Outlook invite when the box is ticked; otherwise only the guests without
  // an Orbit account, whose only channel is email. One meeting carries them all.
  const outlookRecipients = emails.filter(email => includeOutlook || !byEmail.get(email));
  let outlookEventId: string | undefined;
  let outlookError: string | undefined;
  if (outlookRecipients.length > 0) {
    if (!organizerEmail) {
      outlookError = 'The organiser has no work email, so no calendar invite could be sent.';
    } else {
      const sent = await sendSessionCalendarInvite({
        admin,
        organizerProfileId,
        organizerEmail,
        details: {
          organizerName,
          roomName,
          roomLocation,
          sessionDate: sessionRow.session_date,
          startsAt: sessionRow.starts_at,
          endsAt: sessionRow.ends_at,
          title: sessionRow.title,
          attendees: outlookRecipients,
        },
      });
      if (sent.ok) outlookEventId = sent.eventId;
      else outlookError = sent.error || 'Graph refused the meeting invite.';
    }
  }
  results.forEach(result => {
    if (!outlookRecipients.includes(result.email)) {
      result.outlook_status = 'skipped';
      return;
    }
    result.outlook_status = outlookEventId ? 'sent' : 'failed';
    if (!outlookEventId) result.outlook_error = outlookError || 'The calendar invite could not be created.';
  });

  const { error: writeError } = await admin.from('space_session_invites').upsert(
    results.map(result => ({
      session_id: sessionRow.id,
      invited_by: caller.profileId,
      profile_id: result.profile_id,
      email: result.email,
      name: result.name,
      slack_status: result.slack_status,
      outlook_status: result.outlook_status,
      slack_error: result.slack_error || null,
      outlook_error: result.outlook_error || null,
      outlook_event_id: outlookEventId || null,
    })),
    { onConflict: 'session_id,email' }
  );
  if (writeError) {
    console.error('space_session_invites upsert error:', writeError.message);
  }

  return NextResponse.json({
    ok: true,
    session_id: sessionRow.id,
    invites: results,
    slack_configured: hasSlackBotToken(),
  });
}

/**
 * Withdraws the calendar invites of a session before it is deleted. The client calls this first
 * because deleting the session cascades its invite rows away, and the Graph event would otherwise
 * stay in everyone's calendar for a meeting that no longer exists.
 */
export async function DELETE(request: NextRequest) {
  const caller = await requireApiSession(request);
  if (isNextResponse(caller)) return caller;

  const sessionId = new URL(request.url).searchParams.get('session_id') || '';
  if (!sessionId) return NextResponse.json({ error: 'session_id is required' }, { status: 400 });

  const admin = getAdminClient();
  const { data: sessionRow } = await admin
    .from('space_sessions')
    .select('id, created_by')
    .eq('id', sessionId)
    .maybeSingle();
  if (!sessionRow) return NextResponse.json({ ok: true, cancelled: 0 });
  if (!caller.isAdmin && sessionRow.created_by !== caller.profileId) {
    return NextResponse.json(
      { error: 'Only the person who opened this session, or an administrator, can delete it.' },
      { status: 403 }
    );
  }

  const { data: invites } = await admin
    .from('space_session_invites')
    .select('invited_by, outlook_event_id')
    .eq('session_id', sessionId)
    .not('outlook_event_id', 'is', null);

  // One Graph event per invite batch, on the mailbox of whoever sent that batch.
  const events = new Map<string, string>();
  (invites || []).forEach((row: { invited_by: string | null; outlook_event_id: string | null }) => {
    if (row.outlook_event_id && row.invited_by) events.set(row.outlook_event_id, row.invited_by);
  });

  let cancelled = 0;
  for (const [eventId, inviterProfileId] of events) {
    const { data: inviter } = await admin
      .from('profiles')
      .select('id, work_email')
      .eq('id', inviterProfileId)
      .maybeSingle();
    if (!inviter?.work_email) continue;
    const ok = await cancelSessionCalendarInvite({
      admin,
      organizerProfileId: inviter.id,
      organizerEmail: inviter.work_email,
      eventId,
    });
    if (ok) cancelled += 1;
  }

  return NextResponse.json({ ok: true, cancelled });
}
