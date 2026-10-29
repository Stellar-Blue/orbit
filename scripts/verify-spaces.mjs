/**
 * Verification for the spaces/seat-booking rules.
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-spaces.mjs
 *
 * Capacity itself is a database trigger; these are the rules the screen renders from.
 */

import {
  BOOKING_MODE_LABELS,
  clockLabel,
  defaultSessionWindow,
  seatHolders,
  seatsLabel,
  sessionLabel,
  spaceDayState,
  validateSessionWindow,
} from '@/lib/spaces';

let passed = 0;
let failed = 0;

function assert(condition, name, details = '') {
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    if (details) console.log(`          └─ ${details}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${name}`);
    if (details) console.error(`          └─ ${details}`);
    failed++;
  }
}

console.log('================================================================');
console.log('🚀 ORBIT SPACES & SEAT BOOKING - VERIFICATION');
console.log('================================================================\n');

const space = { id: 'sp-1', capacity: 3 };
const deskType = { booking_mode: 'whole_day' };
const roomType = { booking_mode: 'time_range' };

const seat = (id, profileId, extra = {}) => ({
  id,
  space_id: 'sp-1',
  session_id: null,
  profile_id: profileId,
  booking_date: '2026-11-10',
  ...extra,
});

// --- Whole-day desks ---------------------------------------------------------
const deskEmpty = spaceDayState({
  space, type: deskType, date: '2026-11-10', sessions: [], bookings: [], profileId: 'me',
});
assert(
  deskEmpty.mode === 'whole_day' && deskEmpty.seatsTaken === 0 && deskEmpty.seatsFree === 3 &&
    !deskEmpty.full && !deskEmpty.needsSession && deskEmpty.action === 'book',
  'An empty desk area is bookable for the whole day',
  JSON.stringify({ seats: deskEmpty.seatsFree, action: deskEmpty.action })
);

const deskFull = spaceDayState({
  space, type: deskType, date: '2026-11-10', sessions: [],
  bookings: [seat('b1', 'a'), seat('b2', 'b'), seat('b3', 'c')], profileId: 'me',
});
assert(
  deskFull.full && deskFull.seatsFree === 0 && deskFull.action === 'full',
  'A desk area stops taking seats at its capacity',
  `${deskFull.seatsTaken}/${space.capacity}`
);

const deskMine = spaceDayState({
  space, type: deskType, date: '2026-11-10', sessions: [],
  bookings: [seat('b1', 'a'), seat('b2', 'me')], profileId: 'me',
});
assert(
  deskMine.myBooking?.id === 'b2' && deskMine.action === 'leave',
  'Holding a seat turns the button into "release my seat"',
  deskMine.myBooking?.id
);

const otherDay = spaceDayState({
  space, type: deskType, date: '2026-11-11', sessions: [],
  bookings: [seat('b1', 'a'), seat('b2', 'b'), seat('b3', 'c')], profileId: 'me',
});
assert(
  otherDay.seatsTaken === 0 && !otherDay.full,
  'Bookings on another date never count against today',
  `${otherDay.seatsTaken} seats on the empty day`
);

// --- Timed rooms and sessions ------------------------------------------------
const roomNoSession = spaceDayState({
  space, type: roomType, date: '2026-11-10', sessions: [], bookings: [], profileId: 'me',
});
assert(
  roomNoSession.needsSession && roomNoSession.action === 'book' && roomNoSession.session === undefined,
  'A timed room with no session asks the first booker to open one',
  `action ${roomNoSession.action}`
);

const session = {
  id: 'ses-1', space_id: 'sp-1', session_date: '2026-11-10',
  starts_at: '09:30:00', ends_at: '10:30:00', title: 'Sprint planning', created_at: '2026-11-01T09:00:00Z',
};
const roomJoining = spaceDayState({
  space, type: roomType, date: '2026-11-10', sessions: [session],
  bookings: [seat('b1', 'someone', { session_id: 'ses-1' })], profileId: 'me',
});
assert(
  roomJoining.session?.id === 'ses-1' && roomJoining.action === 'join' && !roomJoining.needsSession &&
    roomJoining.seatsFree === 2,
  'Once a session exists the button joins it instead of opening a new one',
  `${roomJoining.action} · ${roomJoining.seatsFree} seats left`
);

const roomFull = spaceDayState({
  space: { id: 'sp-1', capacity: 1 }, type: roomType, date: '2026-11-10', sessions: [session],
  bookings: [seat('b1', 'someone', { session_id: 'ses-1' })], profileId: 'me',
});
assert(
  roomFull.full && roomFull.action === 'full',
  'A session is full at the room capacity',
  `${roomFull.seatsTaken}/1`
);

const roomMine = spaceDayState({
  space, type: roomType, date: '2026-11-10', sessions: [session],
  bookings: [seat('b1', 'me', { session_id: 'ses-1' })], profileId: 'me',
});
assert(roomMine.action === 'leave', 'Joining a session can be undone from the same card');

const wrongDaySession = spaceDayState({
  space, type: roomType, date: '2026-11-12', sessions: [session], bookings: [], profileId: 'me',
});
assert(
  wrongDaySession.session === undefined && wrongDaySession.needsSession,
  'A session belongs to its own date only',
  String(wrongDaySession.session?.id)
);

// --- Formatting + validation -------------------------------------------------
assert(
  clockLabel('09:30:00') === '09:30' && clockLabel(null) === '',
  'Postgres times print without seconds'
);
assert(
  sessionLabel(session) === '09:30 – 10:30 · Sprint planning' &&
    sessionLabel({ starts_at: '14:00:00', ends_at: '15:00:00' }) === '14:00 – 15:00',
  'A session label carries the window and the title when there is one',
  sessionLabel(session)
);
assert(
  seatsLabel({ seatsTaken: 2, seatsFree: 6, full: false }, 8) === '2 / 8 seats' &&
    seatsLabel({ seatsTaken: 1, seatsFree: 0, full: true }, 1) === 'Full' &&
    seatsLabel({ seatsTaken: 0, seatsFree: 1, full: false }, 1) === '0 / 1 seat',
  'Seat labels pluralise and switch to "Full"'
);
assert(
  validateSessionWindow('09:00', '10:00') === null &&
    validateSessionWindow('', '10:00') !== null &&
    validateSessionWindow('10:00', '09:00') !== null &&
    validateSessionWindow('09:00', '09:10') !== null &&
    validateSessionWindow('09:00', '25:00') !== null,
  'Session windows must be ordered, at least 15 minutes and inside the day'
);
const window = defaultSessionWindow(new Date('2026-11-10T09:07:00'));
assert(
  window.startsAt === '09:15' && window.endsAt === '10:15',
  'The first booker gets a one-hour window from the next quarter hour',
  `${window.startsAt} – ${window.endsAt}`
);
assert(
  seatHolders([{ ...seat('b1', 'a'), profile: { first_name: 'Anthi', last_name: 'Papadopoulou' } }]).join(',') === 'Anthi',
  'The room card names the people holding seats'
);
assert(
  BOOKING_MODE_LABELS.whole_day.label === 'Whole day' && BOOKING_MODE_LABELS.time_range.label === 'Time range',
  'Both booking modes have labels for the admin screen'
);

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
