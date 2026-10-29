import type { Space, SpaceBooking, SpaceBookingMode, SpaceSession, SpaceType } from '@/lib/types';

/**
 * Seat-booking rules shared by the booking screen, the admin settings and the tests.
 *
 * A space type decides the shape of a day:
 *   • `whole_day`  — a booking covers the date; up to `capacity` people share the space.
 *   • `time_range` — the first booking of the day opens a session (start, end, title) and everyone
 *                    else joins it; `capacity` caps the seats in that session.
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
    hint: 'The first booker opens a session with a start and end time; the rest join it until it is full.',
  },
};

export type SpaceDayAction = 'book' | 'join' | 'leave' | 'full';

export interface SpaceDayState {
  mode: SpaceBookingMode;
  /** The session for that space and date, when the type is timed and someone already opened one. */
  session?: SpaceSession;
  /** Every booking for that space and date, oldest first. */
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

/** Bookings and sessions are already fetched per slice; this narrows them to one space and date. */
export function spaceDayState(args: {
  space: Pick<Space, 'id' | 'capacity'>;
  type: Pick<SpaceType, 'booking_mode'>;
  date: string;
  sessions: SpaceSession[];
  bookings: SpaceBooking[];
  profileId?: string | null;
}): SpaceDayState {
  const { space, type, date, sessions, bookings, profileId } = args;
  const session = sessions
    .filter(entry => entry.space_id === space.id && entry.session_date === date)
    .sort(byCreatedAt)[0];
  const dayBookings = bookings
    .filter(entry => entry.space_id === space.id && entry.booking_date === date)
    .sort(byCreatedAt);

  const seatsTaken = dayBookings.length;
  const capacity = Math.max(Number(space.capacity) || 0, 1);
  const full = seatsTaken >= capacity;
  const myBooking = profileId ? dayBookings.find(entry => entry.profile_id === profileId) : undefined;
  const needsSession = type.booking_mode === 'time_range' && !session;

  const action: SpaceDayAction = myBooking
    ? 'leave'
    : full
      ? 'full'
      : type.booking_mode === 'time_range' && session
        ? 'join'
        : 'book';

  return {
    mode: type.booking_mode,
    session,
    bookings: dayBookings,
    seatsTaken,
    seatsFree: Math.max(capacity - seatsTaken, 0),
    full,
    myBooking,
    needsSession,
    action,
  };
}

/** `09:30:00` → `09:30` — Postgres hands back seconds we never show. */
export const clockLabel = (value?: string | null): string => String(value || '').slice(0, 5);

/** `09:30 – 10:30 · Sprint planning` */
export function sessionLabel(session: Pick<SpaceSession, 'starts_at' | 'ends_at' | 'title'>): string {
  const window = `${clockLabel(session.starts_at)} – ${clockLabel(session.ends_at)}`;
  return session.title ? `${window} · ${session.title}` : window;
}

const MINUTES_IN_DAY = 24 * 60;

const minutesOf = (value?: string | null): number => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return NaN;
  return hours * 60 + minutes;
};

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
