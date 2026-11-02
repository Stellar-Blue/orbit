import type {
  LeaveStatus, Profile, RemoteDay, RemotePattern, Space, SpaceBooking, SpaceBookingMode, SpaceSession,
  SpaceSessionInvite, SessionInviteOutcome, SpaceType,
} from '@/lib/types';

/**
 * Seat-booking rules shared by the booking screen, the admin settings and the tests.
 *
 * A space type decides the shape of a day:
 *   • `whole_day`  — a booking covers the date; up to `capacity` people share the space.
 *   • `time_range` — the room runs one or more sessions that day, each with its own window and its
 *                    own `capacity` of seats. A person may hold a seat in several of them.
 *
 * Capacity itself is enforced by a database trigger (`enforce_space_booking`), so the UI can only
 * ever be optimistic by a few milliseconds — these helpers decide what to *show*.
 */

export const BOOKING_MODE_LABELS: Record<SpaceBookingMode, { label: string; hint: string }> = {
  whole_day: {
    label: 'Whole day',
    hint: 'One seat for the full date — desks and workstations. Capacity is how many people share the space.',
  },
  time_range: {
    label: 'Time range',
    hint: 'The room runs sessions (start, end, title) and every session takes its own seats; the rest of the team joins one.',
  },
};

export type SpaceDayAction = 'book' | 'join' | 'leave' | 'full' | 'ended';

/** One session of a timed room on the chosen day, with the seats it holds. */
export interface SpaceSessionState {
  session: SpaceSession;
  bookings: SpaceBooking[];
  seatsTaken: number;
  seatsFree: number;
  full: boolean;
  myBooking?: SpaceBooking;
  /** The window is behind us: it can be reviewed but no longer joined. */
  ended: boolean;
  action: Exclude<SpaceDayAction, 'book'>;
}

export interface SpaceDayState {
  mode: SpaceBookingMode;
  /** The session the card leads with: yours if you hold one, otherwise the next one to start. */
  session?: SpaceSession;
  /** Every session of that space and date, in start order. Empty for whole-day spaces. */
  sessions: SpaceSessionState[];
  /** The bookings behind the numbers below — the focus session's, or the whole day's. */
  bookings: SpaceBooking[];
  seatsTaken: number;
  seatsFree: number;
  full: boolean;
  /** The signed-in person's seat, if they hold one. */
  myBooking?: SpaceBooking;
  /** A timed space with no session yet: the next booker defines the window. */
  needsSession: boolean;
  /** What the primary button should do. */
  action: SpaceDayAction;
}

const byCreatedAt = (a: { created_at?: string; id: string }, b: { created_at?: string; id: string }) =>
  String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id);

const byStart = (a: SpaceSession, b: SpaceSession) =>
  String(a.starts_at).localeCompare(String(b.starts_at)) || byCreatedAt(a, b);

const MINUTES_IN_DAY = 24 * 60;

const minutesOf = (value?: string | null): number => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return NaN;
  return hours * 60 + minutes;
};

/** `2026-11-10` for the local calendar day of `now`. */
const dayKey = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** A past date, or today once the end time has gone by. */
export function sessionEnded(
  session: Pick<SpaceSession, 'session_date' | 'ends_at'>,
  now: Date = new Date()
): boolean {
  const today = dayKey(now);
  if (session.session_date < today) return true;
  if (session.session_date > today) return false;
  return minutesOf(session.ends_at) <= now.getHours() * 60 + now.getMinutes();
}

/** A session that has already begun: an earlier date, or a window that started earlier today. */
export function sessionStarted(
  session: Pick<SpaceSession, 'session_date' | 'starts_at'>,
  now: Date = new Date()
): boolean {
  const today = dayKey(now);
  if (session.session_date < today) return true;
  if (session.session_date > today) return false;
  return minutesOf(session.starts_at) <= now.getHours() * 60 + now.getMinutes();
}

/**
 * The session a meeting room shows before anyone picks one: the meeting running right now, otherwise
 * the next one to start, otherwise the last of the day. This is what the 3D board opens on.
 */
export function defaultPlanSession(
  states: SpaceSessionState[],
  now: Date = new Date()
): SpaceSessionState | undefined {
  // Times are evaluated against `now`, not the `ended` flag baked into the state when it was built:
  // a screen left open across a session boundary must still open on the meeting that is coming.
  return states.find(entry => sessionStarted(entry.session, now) && !sessionEnded(entry.session, now))
    ?? states.find(entry => !sessionEnded(entry.session, now))
    ?? states[states.length - 1];
}

/** Every session of one space on one date, in start order, each with the seats it holds. */
export function spaceDaySessions(args: {
  space: Pick<Space, 'id' | 'capacity'>;
  date: string;
  sessions: SpaceSession[];
  bookings: SpaceBooking[];
  profileId?: string | null;
  now?: Date;
}): SpaceSessionState[] {
  const { space, date, sessions, bookings, profileId, now } = args;
  const capacity = Math.max(Number(space.capacity) || 0, 1);
  const dayBookings = bookings.filter(
    entry => entry.space_id === space.id && entry.booking_date === date
  );

  return sessions
    .filter(entry => entry.space_id === space.id && entry.session_date === date)
    .sort(byStart)
    .map(session => {
      const held = dayBookings
        .filter(entry => entry.session_id === session.id)
        .sort(byCreatedAt);
      const myBooking = profileId ? held.find(entry => entry.profile_id === profileId) : undefined;
      const seatsTaken = held.length;
      const full = seatsTaken >= capacity;
      const ended = sessionEnded(session, now);
      return {
        session,
        bookings: held,
        seatsTaken,
        seatsFree: Math.max(capacity - seatsTaken, 0),
        full,
        myBooking,
        ended,
        action: myBooking ? 'leave' as const : full ? 'full' as const : ended ? 'ended' as const : 'join' as const,
      };
    });
}

/** The card leads with your own session, otherwise the next one still to come. */
function focusOf(states: SpaceSessionState[]): SpaceSessionState | undefined {
  return states.find(entry => entry.myBooking)
    ?? states.find(entry => !entry.ended)
    ?? states[states.length - 1];
}

/** Bookings and sessions are already fetched per slice; this narrows them to one space and date. */
export function spaceDayState(args: {
  space: Pick<Space, 'id' | 'capacity'>;
  type: Pick<SpaceType, 'booking_mode'>;
  date: string;
  sessions: SpaceSession[];
  bookings: SpaceBooking[];
  profileId?: string | null;
  now?: Date;
}): SpaceDayState {
  const { space, type, date, sessions, bookings, profileId, now } = args;
  const capacity = Math.max(Number(space.capacity) || 0, 1);
  const dayBookings = bookings
    .filter(entry => entry.space_id === space.id && entry.booking_date === date)
    .sort(byCreatedAt);

  if (type.booking_mode === 'whole_day') {
    const seatsTaken = dayBookings.length;
    const full = seatsTaken >= capacity;
    const myBooking = profileId ? dayBookings.find(entry => entry.profile_id === profileId) : undefined;
    return {
      mode: 'whole_day',
      sessions: [],
      bookings: dayBookings,
      seatsTaken,
      seatsFree: Math.max(capacity - seatsTaken, 0),
      full,
      myBooking,
      needsSession: false,
      action: myBooking ? 'leave' : full ? 'full' : 'book',
    };
  }

  const sessionStates = spaceDaySessions({ space, date, sessions, bookings, profileId, now });
  const focus = focusOf(sessionStates);
  const myBooking = focus?.myBooking
    || sessionStates.map(entry => entry.myBooking).find(Boolean);

  return {
    mode: 'time_range',
    session: focus?.session,
    sessions: sessionStates,
    bookings: focus?.bookings ?? [],
    seatsTaken: focus?.seatsTaken ?? 0,
    seatsFree: focus?.seatsFree ?? capacity,
    full: focus?.full ?? false,
    myBooking,
    needsSession: !focus,
    action: focus ? focus.action : 'book',
  };
}

/**
 * The session whose window collides with the one being typed. Two sessions of the same room may not
 * overlap — the database refuses it, this warns before the round trip.
 */
export function overlappingSession(
  sessions: Pick<SpaceSession, 'id' | 'starts_at' | 'ends_at'>[],
  window: { startsAt: string; endsAt: string; ignoreId?: string | null }
): (Pick<SpaceSession, 'id' | 'starts_at' | 'ends_at'>) | undefined {
  const start = minutesOf(window.startsAt);
  const end = minutesOf(window.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  return sessions.find(entry => (
    entry.id !== window.ignoreId &&
    minutesOf(entry.starts_at) < end &&
    minutesOf(entry.ends_at) > start
  ));
}

/** `09:30:00` → `09:30` — Postgres hands back seconds we never show. */
export const clockLabel = (value?: string | null): string => String(value || '').slice(0, 5);

/** `09:30 – 10:30 · Sprint planning` */
export function sessionLabel(session: Pick<SpaceSession, 'starts_at' | 'ends_at' | 'title'>): string {
  const window = `${clockLabel(session.starts_at)} – ${clockLabel(session.ends_at)}`;
  return session.title ? `${window} · ${session.title}` : window;
}

/**
 * Validates the window the first booker types. Returns an error message, or null when usable —
 * the DB rejects `ends_at <= starts_at` as well, this just fails fast and readably.
 */
export function validateSessionWindow(startsAt: string, endsAt: string): string | null {
  const start = minutesOf(startsAt);
  const end = minutesOf(endsAt);
  if (!startsAt || !endsAt) return 'Set both a start and an end time.';
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Those times are not valid.';
  if (start < 0 || end > MINUTES_IN_DAY) return 'The window must stay inside the day.';
  if (end <= start) return 'The end time must be after the start time.';
  if (end - start < 15) return 'A session needs at least 15 minutes.';
  return null;
}

/**
 * The first free hour for a new session: the next quarter hour that none of the room's sessions
 * covers, so the dialog opens on a window that can be submitted straight away.
 */
export function nextFreeSessionWindow(
  sessions: Pick<SpaceSession, 'id' | 'starts_at' | 'ends_at'>[],
  now: Date = new Date(),
  lengthMinutes = 60
): { startsAt: string; endsAt: string } {
  const pad = (value: number) => String(value).padStart(2, '0');
  const label = (total: number) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  const latestStart = MINUTES_IN_DAY - lengthMinutes;
  let start = Math.min(Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15, latestStart);
  for (let step = 0; step < 96; step += 1) {
    const candidate = { startsAt: label(start), endsAt: label(start + lengthMinutes) };
    if (!overlappingSession(sessions, candidate)) return candidate;
    start = Math.min(start + 15, latestStart);
  }
  return { startsAt: label(latestStart), endsAt: label(MINUTES_IN_DAY) };
}

/** Sensible prefill for the first booking of a timed space: the next quarter hour, one hour long. */
export function defaultSessionWindow(now: Date = new Date()): { startsAt: string; endsAt: string } {
  const start = new Date(now);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  const label = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return { startsAt: label(start), endsAt: label(end) };
}

/** Per-seat header text: `3 / 8 seats` or `Full`. */
export function seatsLabel(state: Pick<SpaceDayState, 'seatsTaken' | 'seatsFree' | 'full'>, capacity: number): string {
  if (state.full) return 'Full';
  return `${state.seatsTaken} / ${capacity} seat${capacity === 1 ? '' : 's'}`;
}

/** First names of the people holding a seat, for the room card. */
export function seatHolders(bookings: SpaceBooking[]): string[] {
  return bookings.map(entry => {
    const profile = entry.profile;
    if (!profile) return 'Colleague';
    return profile.first_name || profile.work_email || 'Colleague';
  });
}

/**
 * Who may take a session back: the person who opened it, or an administrator. The database says the
 * same with its delete policy, so the button and the rule cannot disagree.
 */
export function canDeleteSession(
  session: Pick<SpaceSession, 'created_by'>,
  profileId: string | null | undefined,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true;
  return Boolean(profileId) && session.created_by === profileId;
}

/**
 * Who may invite people to a session: whoever opened it, or an administrator. The API route checks
 * the same rule before it reaches Slack or Graph.
 */
export function canInviteToSession(
  session: Pick<SpaceSession, 'created_by'>,
  profileId: string | null | undefined,
  isAdmin: boolean
): boolean {
  return canDeleteSession(session, profileId, isAdmin);
}

/**
 * Who may change a session — its window, title, description and the people invited to it. The same
 * rule as taking it back, so the pencil and the trash can never disagree with the database.
 */
export function canEditSession(
  session: Pick<SpaceSession, 'created_by'>,
  profileId: string | null | undefined,
  isAdmin: boolean
): boolean {
  return canDeleteSession(session, profileId, isAdmin);
}

/** A dialect of the HTML5 address rule that also accepts the `+tag` addresses the team uses. */
const INVITE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** One usable address (trimmed, `mailto:` dropped, lowercased), or null when it is not an email. */
export function normalizeInviteEmail(value: string): string | null {
  const email = String(value || '').trim().replace(/^mailto:/i, '').toLowerCase();
  return INVITE_EMAIL_RE.test(email) ? email : null;
}

/**
 * Whatever was typed or pasted — commas, semicolons, spaces, newlines — as unique addresses, in the
 * order they were entered. Invalid fragments are dropped so one typo never blocks the whole batch.
 */
export function parseInviteEmails(value: string): string[] {
  const seen = new Set<string>();
  return String(value || '')
    .split(/[\s,;]+/)
    .map(normalizeInviteEmail)
    .filter((email): email is string => Boolean(email))
    .filter(email => (seen.has(email) ? false : (seen.add(email), true)));
}

/**
 * Leave states that mean the person is away from the office. A rejected or cancelled request does
 * not count; a pending one does, because the day is already declared.
 */
export const AWAY_LEAVE_STATUSES: readonly LeaveStatus[] = [
  'pending', 'approved', 'in_progress', 'taken', 'cancellation_requested',
];

export type AbsenceKind = 'leave' | 'remote';

export interface DayAbsence {
  kind: AbsenceKind;
  /** Ready to drop into a sentence: `on annual leave`, `working remotely`. */
  label: string;
}

/** `Mon` for a date, in UTC so the weekday never shifts with the browser's timezone. */
const shortWeekday = (date: string): string =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

/**
 * Why a person cannot take a seat on a date: they declared leave, or they are remote — either an
 * explicit day or a recurring pattern. An explicit `office` day overrides a pattern, which is how
 * the remote screen lets someone come in on a pattern day.
 *
 * The database enforces the same rule (`enforce_seat_at_office`), so this is what explains it.
 */
export function absenceOnDate(args: {
  date: string;
  profileId: string;
  leaveRequests: {
    profile_id: string;
    start_date: string;
    end_date: string;
    status: LeaveStatus;
    leave_type?: { name_en?: string | null; name_el?: string | null } | null;
  }[];
  remoteDays: Pick<RemoteDay, 'profile_id' | 'date' | 'mode'>[];
  remotePatterns: Pick<RemotePattern, 'profile_id' | 'weekday' | 'mode' | 'valid_from' | 'valid_to'>[];
}): DayAbsence | null {
  const { date, profileId, leaveRequests, remoteDays, remotePatterns } = args;

  const leave = leaveRequests.find(request =>
    request.profile_id === profileId
    && AWAY_LEAVE_STATUSES.includes(request.status)
    && request.start_date <= date
    && request.end_date >= date
  );
  if (leave) {
    const name = leave.leave_type?.name_en || leave.leave_type?.name_el || null;
    return { kind: 'leave', label: name ? `on ${name}` : 'on leave' };
  }

  const declared = remoteDays.find(day => day.profile_id === profileId && day.date === date);
  if (declared) {
    if (declared.mode === 'office') return null;
    return { kind: 'remote', label: declared.mode === 'remote_abroad' ? 'working from abroad' : 'working remotely' };
  }

  const weekday = shortWeekday(date);
  const pattern = remotePatterns.find(rule =>
    rule.profile_id === profileId
    && rule.mode !== 'office'
    && rule.weekday === weekday
    && rule.valid_from <= date
    && (!rule.valid_to || rule.valid_to >= date)
  );
  if (pattern) {
    return { kind: 'remote', label: pattern.mode === 'remote_abroad' ? 'working from abroad' : 'working remotely' };
  }
  return null;
}

/** One person in a session, whether they hold a seat, were invited, or both. */
export interface SessionAttendee {
  /** Identity used to merge a seat with its invitation: the profile, or the guest's address. */
  key: string;
  name: string;
  email: string;
  /** Holds a seat in this session. */
  seat: boolean;
  /** The invitation behind the row, when the organiser sent one — that is what can be withdrawn. */
  invite?: SpaceSessionInvite;
}

const inviteNameOf = (invite: SpaceSessionInvite): string =>
  invite.name
  || [invite.profile?.first_name, invite.profile?.last_name].filter(Boolean).join(' ').trim()
  || invite.email;

const profileName = (profile?: Profile | null): string =>
  [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || profile?.work_email || '';

/**
 * Everyone in a session, seats and invitations merged into one row per person. An invitee who also
 * took a seat is the same person twice in the data, and showing them twice is exactly the confusion
 * the organiser is trying to resolve.
 */
export function sessionAttendees(args: {
  bookings: Pick<SpaceBooking, 'profile_id' | 'profile'>[];
  invites: SpaceSessionInvite[];
}): SessionAttendee[] {
  const rows = new Map<string, SessionAttendee>();

  args.bookings.forEach(booking => {
    const key = booking.profile_id;
    const existing = rows.get(key);
    rows.set(key, {
      key,
      name: profileName(booking.profile) || existing?.name || 'Colleague',
      email: booking.profile?.work_email || existing?.email || '',
      seat: true,
      invite: existing?.invite,
    });
  });

  args.invites.forEach(invite => {
    const key = invite.profile_id || invite.email.toLowerCase();
    const existing = rows.get(key);
    rows.set(key, {
      key,
      name: existing?.name || inviteNameOf(invite) || invite.email,
      email: existing?.email || invite.email,
      seat: Boolean(existing?.seat),
      invite,
    });
  });

  return Array.from(rows.values()).sort((a, b) =>
    Number(b.seat) - Number(a.seat) || a.name.localeCompare(b.name)
  );
}

export interface SessionInviteTarget {
  email: string;
  /** The Orbit user behind the address — those are invited on Slack. External guests are not. */
  profile?: Pick<Profile, 'id' | 'first_name' | 'last_name' | 'work_email' | 'status'>;
}

/**
 * Maps the addresses being invited onto the directory. A match must still be with Orbit: a departed
 * colleague has no Slack to message, so their address is treated like any other external guest.
 */
export function resolveInviteTargets(
  emails: string[],
  profiles: Pick<Profile, 'id' | 'first_name' | 'last_name' | 'work_email' | 'status'>[]
): SessionInviteTarget[] {
  const byEmail = new Map(
    profiles
      .filter(profile => profile.status !== 'departed' && profile.work_email)
      .map(profile => [profile.work_email.trim().toLowerCase(), profile])
  );
  return emails.map(email => ({ email, profile: byEmail.get(email) }));
}

export interface InviteDeliveryProblem {
  /** Name or address of the person the problem belongs to. */
  who: string;
  problem: string;
}

export interface InviteDeliverySummary {
  invited: number;
  slackSent: number;
  outlookSent: number;
  seatsBooked: number;
  /** One entry per recipient something went wrong for. Empty when everything landed. */
  problems: InviteDeliveryProblem[];
}

/** Turns the API's per-recipient result into the sentence the dialog shows afterwards. */
export function summarizeInviteDelivery(invites: SessionInviteOutcome[]): InviteDeliverySummary {
  const problems: InviteDeliveryProblem[] = [];
  let slackSent = 0;
  let outlookSent = 0;
  let seatsBooked = 0;

  invites.forEach(invite => {
    const who = invite.name || invite.email;
    if (invite.slack_status === 'sent') slackSent += 1;
    if (invite.outlook_status === 'sent') outlookSent += 1;
    if (invite.seat === 'booked') seatsBooked += 1;
    if (invite.slack_status === 'failed') {
      problems.push({ who, problem: invite.slack_error || 'the Slack message failed' });
    }
    if (invite.outlook_status === 'failed') {
      problems.push({ who, problem: invite.outlook_error || 'the calendar invite failed' });
    }
    if (invite.seat === 'full') {
      problems.push({ who, problem: 'invited, but the session is full so no seat was reserved' });
    }
    if (invite.seat === 'away') {
      problems.push({ who, problem: invite.seat_error || 'invited, but away that day so no seat was reserved' });
    }
    if (invite.seat === 'failed') {
      problems.push({ who, problem: 'invited, but the seat could not be booked' });
    }
  });

  return { invited: invites.length, slackSent, outlookSent, seatsBooked, problems };
}

/**
 * The whole-day booking a person already holds on a date, outside one room. A whole-day space fills
 * the person's whole day, so this is the rule every booking path shares: the screen explains it and
 * the database enforces it with a unique index.
 */
export function wholeDayHeldOn(
  bookings: SpaceBooking[],
  profileId: string,
  date: string,
  exceptSpaceId?: string
): SpaceBooking | null {
  return bookings.find(booking =>
    booking.profile_id === profileId
    && booking.booking_date === date
    && booking.session_id === null
    && booking.space_id !== exceptSpaceId
  ) ?? null;
}

/**
 * The whole-day seat a person already holds on the day, if any. A whole-day space fills the whole
 * day, so once one is held no other whole-day space can take a second — the database says the same
 * with a unique index, this is what the screen explains the rule with.
 */
export function heldWholeDaySpace(states: Map<string, SpaceDayState>): string | null {
  for (const [spaceId, state] of states) {
    if (state.mode === 'whole_day' && state.myBooking) return spaceId;
  }
  return null;
}
