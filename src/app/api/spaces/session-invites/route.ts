import { NextRequest, NextResponse } from 'next/server';
import { athensToday, getAdminClient, hasSlackBotToken, slackSendDirectMessage } from '@/lib/integrations/server';
import { cancelSessionCalendarInvite } from '@/lib/integrations/outlook';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { EMPLOYEE_INTEGRATION_COLUMNS, type EmployeeIntegration } from '@/lib/integrations/types';
import {
  absenceOf, calendarStateOf, loadSessionContext, sessionShareUrl, sessionWhen, syncSessionCalendar,
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

/** The chairs of a room still free in a session, in a stable order (oldest drawn first). */
async function freeChairsFor(
  admin: ReturnType<typeof getAdminClient>,
  spaceId: string,
  sessionId: string
): Promise<string[]> {
  const [{ data: seats }, { data: taken }] = await Promise.all([
    admin.from('space_seats').select('id').eq('space_id', spaceId).eq('active', true).order('created_at'),
    admin.from('space_bookings').select('seat_id').eq('session_id', sessionId).not('seat_id', 'is', null),
  ]);
  const used = new Set((taken || []).map(row => row.seat_id as string));
  return (seats || []).map(seat => seat.id as string).filter(id => !used.has(id));
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

    // The seat is only for a day at the office; the database refuses anything else (SQLSTATE
    // SB001), and this check lets the report say why instead of a generic failure.
    const away = await absenceOf(admin, profile.id, context.sessionDate);
    let seat: RecipientResult['seat'] = 'away';
    let seatError: string | undefined = away
      ? `invited, but ${away.label} that day so no seat was reserved`
      : undefined;
    if (!away) {
      // A seat needs a chair: the room draws people above the chair they took, so a booking with no
      // seat would be invisible in the 3D plan. Free chairs are tried in turn, like the booking
      // dialog does, and a room without drawn chairs still gets the booking.
      const chairs = await freeChairsFor(admin, context.spaceId, context.id);
      let bookingError: { code?: string; message: string } | null = null;
      for (const chair of chairs.length > 0 ? chairs : [null]) {
        const attempt = await admin.from('space_bookings').insert([{
          space_id: context.spaceId,
          session_id: context.id,
          profile_id: profile.id,
          booking_date: context.sessionDate,
          seat_id: chair,
          created_by: caller.profileId,
        }]);
        bookingError = attempt.error;
        const chairTaken = Boolean(
          bookingError
          && chair
          && (bookingError.code === '23505' || /seat has just been taken/i.test(bookingError.message))
          && !/one_seat_session|one_seat_day/i.test(bookingError.message)
        );
        if (!chairTaken) break;
      }
      seat = !bookingError
        ? 'booked'
        : /one_seat_session|one_seat_day/i.test(bookingError.message)
          ? 'already'
          : bookingError.code === 'SB001'
            ? 'away'
            : /full|fully booked/i.test(bookingError.message)
              ? 'full'
              : 'failed';
      if (bookingError && seat !== 'already') {
        seatError = `invited, but the seat was not booked: ${bookingError.message}`;
      }
    }

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
  if (!caller.isAdmin && context.createdBy !== caller.profileId) {
    return NextResponse.json(
      { error: 'Only the person who opened this session, or an administrator, can change who is invited.' },
      { status: 403 }
    );
  }

  if (email) {
    const { data: invite } = await admin
      .from('space_session_invites')
      .select('id, profile_id')
      .eq('session_id', sessionId)
      .eq('email', email)
      .maybeSingle();
    if (!invite) return NextResponse.json({ ok: true, removed: 0 });

    // Removing someone from the session frees their seat too — the room card and the capacity
    // trigger must agree with the invite list.
    let seatReleased = false;
    if (invite.profile_id) {
      const { error: seatError } = await admin.from('space_bookings')
        .delete()
        .eq('session_id', sessionId)
        .eq('profile_id', invite.profile_id);
      seatReleased = !seatError;
    }
    await admin.from('space_session_invites').delete().eq('id', invite.id);

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
