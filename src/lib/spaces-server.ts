import type { SupabaseClient } from '@supabase/supabase-js';
import { ATHENS_TIMEZONE } from '@/lib/integrations/types';
import { syncSessionCalendarInvite } from '@/lib/integrations/outlook';
import { absenceOnDate, sessionSharePath, type DayAbsence } from '@/lib/spaces';

/**
 * Server-side session context shared by the invite and edit routes.
 *
 * Both routes need the same three things before they can talk to Slack or Graph: the session being
 * changed, the room it sits in, and the organiser whose calendar carries the meeting. Keeping that
 * lookup here means the same authorisation inputs and the same meeting payload are built one way.
 */

export interface SessionContext {
  id: string;
  spaceId: string;
  sessionDate: string;
  /** `HH:MM:SS` from Postgres. */
  startsAt: string;
  endsAt: string;
  title?: string | null;
  description?: string | null;
  createdBy?: string | null;
  roomName: string;
  roomLocation?: string | null;
  organizer: { profileId: string; email: string; name: string } | null;
  /** `outlook` sessions were imported from a room mailbox and are read-only in Orbit. */
  source: 'orbit' | 'outlook';
  /** The room's Outlook mailbox, when it has one; the session's meeting books it. */
  roomMailbox: string | null;
  outlookEventId: string | null;
  outlookIcalUid: string | null;
}

export const OUTLOOK_MANAGED_ERROR = 'This session is managed in Outlook — change it there.';

export const clock = (value: string): string => String(value || '').slice(0, 5);

export const longDate = (dateStr: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ATHENS_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${dateStr}T12:00:00Z`));

export const sessionWhen = (context: Pick<SessionContext, 'sessionDate' | 'startsAt' | 'endsAt'>): string =>
  `${longDate(context.sessionDate)} · ${clock(context.startsAt)} – ${clock(context.endsAt)}`;

/** The session's absolute link for Slack and Outlook, or null when the app URL is not configured. */
export function sessionShareUrl(sessionId: string): string | null {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  return appUrl ? `${appUrl}${sessionSharePath(sessionId)}` : null;
}

const personName = (profile?: { first_name?: string | null; last_name?: string | null; work_email?: string | null } | null): string =>
  [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || profile?.work_email || 'An Orbit colleague';

export async function loadSessionContext(
  admin: SupabaseClient,
  sessionId: string,
  fallbackProfileId: string
): Promise<SessionContext | null> {
  const { data: sessionRow } = await admin
    .from('space_sessions')
    .select('id, space_id, session_date, starts_at, ends_at, title, description, created_by, source, outlook_event_id, outlook_ical_uid')
    .eq('id', sessionId)
    .maybeSingle();
  if (!sessionRow) return null;

  const [{ data: spaceRow }, { data: organizerRow }] = await Promise.all([
    admin.from('spaces').select('id, name, location, outlook_email').eq('id', sessionRow.space_id).maybeSingle(),
    admin
      .from('profiles')
      .select('id, first_name, last_name, work_email')
      .eq('id', sessionRow.created_by || fallbackProfileId)
      .maybeSingle(),
  ]);

  return {
    id: sessionRow.id,
    spaceId: sessionRow.space_id,
    sessionDate: sessionRow.session_date,
    startsAt: sessionRow.starts_at,
    endsAt: sessionRow.ends_at,
    title: sessionRow.title,
    description: sessionRow.description,
    createdBy: sessionRow.created_by,
    roomName: spaceRow?.name || 'the meeting room',
    roomLocation: spaceRow?.location || null,
    organizer: organizerRow?.work_email
      ? { profileId: organizerRow.id, email: organizerRow.work_email, name: personName(organizerRow) }
      : null,
    source: sessionRow.source === 'outlook' ? 'outlook' : 'orbit',
    roomMailbox: spaceRow?.outlook_email || null,
    outlookEventId: sessionRow.outlook_event_id || null,
    outlookIcalUid: sessionRow.outlook_ical_uid || null,
  };
}

/**
 * The one Outlook meeting a session owns, and the addresses currently on it. The newest code path
 * patches that same event, so a session never accumulates a meeting per invite batch.
 */
export async function calendarStateOf(
  admin: SupabaseClient,
  sessionId: string
): Promise<{ eventId: string | null; attendees: string[] }> {
  const [{ data }, { data: session }] = await Promise.all([
    admin
      .from('space_session_invites')
      .select('email, outlook_event_id')
      .eq('session_id', sessionId)
      .eq('outlook_status', 'sent')
      .not('outlook_event_id', 'is', null)
      .order('created_at'),
    admin.from('space_sessions').select('outlook_event_id').eq('id', sessionId).maybeSingle(),
  ]);
  const rows = (data || []) as { email: string; outlook_event_id: string }[];
  const rowsEventId = rows[0]?.outlook_event_id || null;
  const attendees = Array.from(new Set(
    rows.filter(row => row.outlook_event_id === rowsEventId).map(row => row.email)
  ));
  return { eventId: session?.outlook_event_id || rowsEventId, attendees };
}

/**
 * Whether the person is away on a date, read straight from the tables that decide it. The booking
 * trigger refuses the insert either way; this lets the invite route say "on leave" or "remote"
 * instead of reporting a generic failure for a seat it should never have asked for.
 */
export async function absenceOf(
  admin: SupabaseClient,
  profileId: string,
  date: string
): Promise<DayAbsence | null> {
  const [{ data: leaves }, { data: days }, { data: patterns }] = await Promise.all([
    admin
      .from('leave_requests')
      .select('profile_id, start_date, end_date, status')
      .eq('profile_id', profileId)
      .lte('start_date', date)
      .gte('end_date', date),
    admin
      .from('remote_days')
      .select('profile_id, date, mode')
      .eq('profile_id', profileId)
      .eq('date', date),
    admin
      .from('remote_patterns')
      .select('profile_id, weekday, mode, valid_from, valid_to')
      .eq('profile_id', profileId),
  ]);
  return absenceOnDate({
    date,
    profileId,
    leaveRequests: leaves || [],
    remoteDays: days || [],
    remotePatterns: patterns || [],
  });
}

/**
 * Creates, patches or cancels the session's meeting so it always mirrors Orbit. The meeting also
 * books the room's mailbox, so a session in a room with a mailbox owns a meeting even with no guests.
 * Outlook-born sessions already live in Outlook and are never pushed back.
 */
export async function syncSessionCalendar(args: {
  admin: SupabaseClient;
  context: SessionContext;
  attendees: string[];
  eventId?: string | null;
}): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  if (args.context.source === 'outlook') return { ok: true };
  const details = {
    organizerName: args.context.organizer?.name || 'An Orbit colleague',
    roomName: args.context.roomName,
    roomLocation: args.context.roomLocation,
    roomMailbox: args.context.roomMailbox,
    sessionDate: args.context.sessionDate,
    startsAt: args.context.startsAt,
    endsAt: args.context.endsAt,
    title: args.context.title,
    description: args.context.description,
    link: sessionShareUrl(args.context.id),
    attendees: Array.from(new Set(args.attendees)),
  };
  if (!args.context.organizer?.email) {
    if (details.attendees.length === 0 && !details.roomMailbox) return { ok: true };
    return { ok: false, error: 'The organiser has no work email, so no calendar invite could be sent.' };
  }
  const result = await syncSessionCalendarInvite({
    admin: args.admin,
    organizerProfileId: args.context.organizer.profileId,
    organizerEmail: args.context.organizer.email,
    details,
    existingEventId: args.eventId || null,
  });
  if (!result.ok) return result;

  // Remember the meeting on the session so Outlook-side changes can be matched back to it. A value
  // Graph did not return (an empty PATCH body) never overwrites what is stored; both are cleared
  // only when the meeting was cancelled.
  const patch: { outlook_event_id?: string | null; outlook_ical_uid?: string | null } = {};
  if (result.eventId) {
    if (result.eventId !== args.context.outlookEventId) patch.outlook_event_id = result.eventId;
    if (result.icalUid && result.icalUid !== args.context.outlookIcalUid) patch.outlook_ical_uid = result.icalUid;
  } else if (args.context.outlookEventId || args.context.outlookIcalUid) {
    patch.outlook_event_id = null;
    patch.outlook_ical_uid = null;
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await args.admin.from('space_sessions').update(patch).eq('id', args.context.id);
    if (error) console.error('space_sessions outlook ids update error:', error.message);
  }
  return { ok: true, eventId: result.eventId };
}

/** The chairs of a room still free in a session, in a stable order (oldest drawn first). */
async function freeChairsFor(admin: SupabaseClient, spaceId: string, sessionId: string): Promise<string[]> {
  const [{ data: seats }, { data: taken }] = await Promise.all([
    admin.from('space_seats').select('id').eq('space_id', spaceId).eq('active', true).order('created_at'),
    admin.from('space_bookings').select('seat_id').eq('session_id', sessionId).not('seat_id', 'is', null),
  ]);
  const used = new Set((taken || []).map(row => row.seat_id as string));
  return (seats || []).map(seat => seat.id as string).filter(id => !used.has(id));
}

/**
 * Seats one Orbit colleague in a session: the absence check, a free chair, and the error mapping the
 * invite report relies on. `away` carries the readable reason as `error`.
 */
export async function bookInviteeSeat(
  admin: SupabaseClient,
  target: { spaceId: string; sessionId: string; sessionDate: string },
  profileId: string,
  createdBy: string | null
): Promise<{ seat: 'booked' | 'already' | 'full' | 'away' | 'failed'; error?: string }> {
  // The seat is only for a day at the office; the database refuses anything else (SQLSTATE
  // SB001), and this check lets the report say why instead of a generic failure.
  const away = await absenceOf(admin, profileId, target.sessionDate);
  if (away) return { seat: 'away', error: `invited, but ${away.label} that day so no seat was reserved` };

  // A seat needs a chair: the room draws people above the chair they took, so a booking with no
  // seat would be invisible in the 3D plan. Free chairs are tried in turn, like the booking
  // dialog does, and a room without drawn chairs still gets the booking.
  const chairs = await freeChairsFor(admin, target.spaceId, target.sessionId);
  let bookingError: { code?: string; message: string } | null = null;
  for (const chair of chairs.length > 0 ? chairs : [null]) {
    const attempt = await admin.from('space_bookings').insert([{
      space_id: target.spaceId,
      session_id: target.sessionId,
      profile_id: profileId,
      booking_date: target.sessionDate,
      seat_id: chair,
      created_by: createdBy,
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
  if (!bookingError) return { seat: 'booked' };
  const seat = /one_seat_session|one_seat_day/i.test(bookingError.message)
    ? 'already'
    : bookingError.code === 'SB001'
      ? 'away'
      : /full|fully booked/i.test(bookingError.message)
        ? 'full'
        : 'failed';
  return seat === 'already'
    ? { seat }
    : { seat, error: `invited, but the seat was not booked: ${bookingError.message}` };
}

/**
 * Takes one person off a session: their invitation and their seat. The caller recomputes the meeting
 * afterwards (an empty attendee list cancels it).
 *
 * `syncSeatOnly` is for the room sync: it books seats with no `created_by`, while every seat taken in
 * the app records who took it, so only a seat the sync booked is released and a seat the person took
 * themselves stays theirs.
 */
export async function removeInvitee(
  admin: SupabaseClient,
  sessionId: string,
  email: string,
  options: { syncSeatOnly?: boolean } = {}
): Promise<{ removed: boolean; seatReleased: boolean }> {
  const { data: invite } = await admin
    .from('space_session_invites')
    .select('id, profile_id')
    .eq('session_id', sessionId)
    .eq('email', email)
    .maybeSingle();
  if (!invite) return { removed: false, seatReleased: false };

  // Removing someone from the session frees their seat too — the room card and the capacity
  // trigger must agree with the invite list.
  let seatReleased = false;
  if (invite.profile_id) {
    let release = admin.from('space_bookings')
      .delete()
      .eq('session_id', sessionId)
      .eq('profile_id', invite.profile_id);
    if (options.syncSeatOnly) release = release.is('created_by', null);
    const { error: seatError } = await release;
    seatReleased = !seatError;
  }
  await admin.from('space_session_invites').delete().eq('id', invite.id);
  return { removed: true, seatReleased };
}
