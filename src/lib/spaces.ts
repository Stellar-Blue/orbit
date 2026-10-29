import type { Space, SpaceBooking, SpaceBookingMode, SpaceSession, SpaceType } from '@/lib/types';

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
