import { NextRequest, NextResponse } from 'next/server';
import { athensToday, getAdminClient, hasSlackBotToken, slackSendDirectMessage } from '@/lib/integrations/server';
import { cancelSessionCalendarInvite } from '@/lib/integrations/outlook';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { EMPLOYEE_INTEGRATION_COLUMNS, type EmployeeIntegration } from '@/lib/integrations/types';
import {
  bookInviteeSeat, calendarStateOf, loadSessionContext, OUTLOOK_MANAGED_ERROR,
  removeInvitee, sessionShareUrl, sessionWhen, syncSessionCalendar,
} from '@/lib/spaces-server';
import { normalizeInviteEmail } from '@/lib/spaces';
import type { SessionInviteStatus } from '@/lib/types';

/**
 * Inviting people to a conference-room session — and taking them off it again.
 *
 * An address that belongs to an Orbit colleague is invited on Slack — a direct message from the
 * Orbit bot. An address that is not an Orbit user can only be reached by email, so it is always
 * carried by the Outlook meeting invite. When the organiser ticks "include an Outlook invite", the
 * colleagues get one too, so the meeting lands in their calendar next to the Slack message.
 *
 * A session owns exactly one Outlook meeting: a second batch of invitees is added to it rather than
 * creating a second meeting, and removing the last attendee cancels it.
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
  /** `away` = leave/remote that day, `none` = external guest without an Orbit seat. */
  seat: 'booked' | 'already' | 'full' | 'away' | 'none' | 'failed';
  seat_error?: string;
  slack_status: SessionInviteStatus;
  outlook_status: SessionInviteStatus;
  slack_error?: string;
  outlook_error?: string;
}

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
  const context = await loadSessionContext(admin, sessionId, caller.profileId);
  if (!context) return NextResponse.json({ error: 'That session no longer exists.' }, { status: 404 });
  if (context.source === 'outlook') return NextResponse.json({ error: OUTLOOK_MANAGED_ERROR }, { status: 403 });

  if (!caller.isAdmin && context.createdBy !== caller.profileId) {
    return NextResponse.json(
      { error: 'Only the person who opened this session, or an administrator, can invite people.' },
      { status: 403 }
    );
  }

  // A session on a past day is history; same-day invitations stay possible right up to the window.
  if (context.sessionDate < athensToday()) {
    return NextResponse.json({ error: 'That session is already over.' }, { status: 400 });
  }

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

  const when = sessionWhen(context);
  const link = sessionShareUrl(sessionId);
  const agenda = context.description?.trim();
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

    const { seat, error: seatError } = await bookInviteeSeat(
      admin,
      { spaceId: context.spaceId, sessionId: context.id, sessionDate: context.sessionDate },
      profile.id,
      caller.profileId
    );

    const seatLine = seat === 'booked'
      ? 'A seat is reserved for you.'
      : seat === 'already'
        ? 'You already hold a seat in this session.'
        : seat === 'full'
          ? 'The room is full, so no seat could be reserved — ask the organiser.'
          : seat === 'away'
            ? 'You are away that day, so no seat was reserved for you.'
            : '';
    const text = [
      `:calendar: *${context.title?.trim() || 'Meeting'}* in *${context.roomName}*`,
      when,
      '',
      `${context.organizer?.name || 'An Orbit colleague'} invited you to a session booked in Orbit.`,
      agenda || '',
      seatLine,
      ...(link ? ['', `Join or review it: ${link}`] : []),
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
      ...(seatError ? { seat_error: seatError } : {}),
    });
  }

  // Every address gets the Outlook invite when the box is ticked; otherwise only the guests without
  // an Orbit account, whose only channel is email. The session's existing meeting is patched, so
  // people invited earlier stay on it.
  const outlookRecipients = emails.filter(email => includeOutlook || !byEmail.get(email));
  const calendar = await calendarStateOf(admin, sessionId);
  const wanted = Array.from(new Set([...calendar.attendees, ...outlookRecipients]));
  const synced = await syncSessionCalendar({
    admin, context, attendees: wanted, eventId: calendar.eventId,
  });
  const eventId = synced.ok ? synced.eventId || null : null;
  // A meeting deleted in Outlook is recreated under a new id; every earlier row still points at the
  // dead one, so they are re-pointed before this batch is written.
  if (eventId && calendar.eventId && eventId !== calendar.eventId) {
    await admin.from('space_session_invites')
      .update({ outlook_event_id: eventId })
      .eq('session_id', sessionId)
      .eq('outlook_event_id', calendar.eventId);
  }
  results.forEach(result => {
    if (!wanted.includes(result.email)) {
      result.outlook_status = 'skipped';
      return;
    }
    result.outlook_status = eventId ? 'sent' : 'failed';
    if (!eventId) result.outlook_error = synced.error || 'The calendar invite could not be created.';
  });

  const { error: writeError } = await admin.from('space_session_invites').upsert(
    results.map(result => ({
      session_id: sessionId,
      invited_by: caller.profileId,
      profile_id: result.profile_id,
      email: result.email,
      name: result.name,
      slack_status: result.slack_status,
      outlook_status: result.outlook_status,
      slack_error: result.slack_error || null,
      outlook_error: result.outlook_error || null,
      // Only an actual attendee belongs to the meeting; a Slack-only invitee must not look like one.
      outlook_event_id: result.outlook_status === 'sent' ? eventId : null,
    })),
    { onConflict: 'session_id,email' }
  );
  if (writeError) {
    console.error('space_session_invites upsert error:', writeError.message);
  }

  return NextResponse.json({
    ok: true,
    session_id: sessionId,
    invites: results,
    slack_configured: hasSlackBotToken(),
  });
}

/**
 * `?session_id=…&email=…` takes one person off the session: their invitation, their seat and their
 * place on the Outlook meeting. `?session_id=…` alone withdraws every meeting of the session — the
 * client calls that before deleting it, because the invite rows cascade away with the session and
 * the Graph events would otherwise stay in everyone's calendar.
 */
export async function DELETE(request: NextRequest) {
  const caller = await requireApiSession(request);
  if (isNextResponse(caller)) return caller;

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id') || '';
  const email = normalizeInviteEmail(url.searchParams.get('email') || '');
  if (!sessionId) return NextResponse.json({ error: 'session_id is required' }, { status: 400 });

  const admin = getAdminClient();
  const context = await loadSessionContext(admin, sessionId, caller.profileId);
  if (!context) return NextResponse.json({ ok: true, removed: 0, cancelled: 0 });
  if (context.source === 'outlook') return NextResponse.json({ error: OUTLOOK_MANAGED_ERROR }, { status: 403 });
  if (!caller.isAdmin && context.createdBy !== caller.profileId) {
    return NextResponse.json(
      { error: 'Only the person who opened this session, or an administrator, can change who is invited.' },
      { status: 403 }
    );
  }

  if (email) {
    const { removed, seatReleased } = await removeInvitee(admin, sessionId, email);
    if (!removed) return NextResponse.json({ ok: true, removed: 0 });

    // Recompute the meeting from what is left; an empty attendee list cancels it.
    const calendar = await calendarStateOf(admin, sessionId);
    const synced = await syncSessionCalendar({
      admin, context, attendees: calendar.attendees, eventId: calendar.eventId,
    });
    return NextResponse.json({
      ok: true,
      removed: 1,
      seat_released: seatReleased,
      calendar_error: synced.ok ? undefined : synced.error,
    });
  }

  const { data: invites } = await admin
    .from('space_session_invites')
    .select('invited_by, outlook_event_id')
    .eq('session_id', sessionId)
    .not('outlook_event_id', 'is', null);

  // One Graph event per session, on the mailbox of whoever sent it.
  const events = new Map<string, string>();
  (invites || []).forEach((row: { invited_by: string | null; outlook_event_id: string | null }) => {
    if (row.outlook_event_id && row.invited_by) events.set(row.outlook_event_id, row.invited_by);
  });

  // The meeting the session itself owns (it may exist with no invitee, just to book the room) sits
  // on the organiser's mailbox.
  if (context.outlookEventId && context.createdBy) events.set(context.outlookEventId, context.createdBy);

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
