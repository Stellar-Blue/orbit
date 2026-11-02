/**
 * Verification for the spaces/seat-booking rules.
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-spaces.mjs
 *
 * Capacity itself is a database trigger; these are the rules the screen renders from.
 */

import {
  BOOKING_MODE_LABELS,
  canDeleteSession,
  canEditSession,
  canInviteToSession,
  clockLabel,
  defaultSessionWindow,
  heldWholeDaySpace,
  normalizeInviteEmail,
  overlappingSession,
  parseInviteEmails,
  resolveInviteTargets,
  summarizeInviteDelivery,
  wholeDayHeldOn,
  seatHolders,
  seatsLabel,
  sessionEnded,
  sessionLabel,
  spaceDaySessions,
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
const DAY = '2026-11-10';
// A fixed clock keeps the "has this window already ended" rule deterministic.
const at = (hhmm) => new Date(`${DAY}T${hhmm}:00`);
const morning = at('09:00');

const roomNoSession = spaceDayState({
  space, type: roomType, date: DAY, sessions: [], bookings: [], profileId: 'me', now: morning,
});
assert(
  roomNoSession.needsSession && roomNoSession.action === 'book' && roomNoSession.session === undefined,
  'A timed room with no session asks the first booker to open one',
  `action ${roomNoSession.action}`
);

const session = {
  id: 'ses-1', space_id: 'sp-1', session_date: DAY,
  starts_at: '09:30:00', ends_at: '10:30:00', title: 'Sprint planning', created_at: '2026-11-01T09:00:00Z',
};
const afternoon = {
  id: 'ses-2', space_id: 'sp-1', session_date: DAY,
  starts_at: '14:00:00', ends_at: '15:00:00', title: 'Design review', created_at: '2026-11-01T09:05:00Z',
};

const roomJoining = spaceDayState({
  space, type: roomType, date: DAY, sessions: [session],
  bookings: [seat('b1', 'someone', { session_id: 'ses-1' })], profileId: 'me', now: morning,
});
assert(
  roomJoining.session?.id === 'ses-1' && roomJoining.action === 'join' && !roomJoining.needsSession &&
    roomJoining.seatsFree === 2,
  'Once a session exists the button joins it instead of opening a new one',
  `${roomJoining.action} · ${roomJoining.seatsFree} seats left`
);

const roomFull = spaceDayState({
  space: { id: 'sp-1', capacity: 1 }, type: roomType, date: DAY, sessions: [session],
  bookings: [seat('b1', 'someone', { session_id: 'ses-1' })], profileId: 'me', now: morning,
});
assert(
  roomFull.full && roomFull.action === 'full',
  'A session is full at the room capacity',
  `${roomFull.seatsTaken}/1`
);

const roomMine = spaceDayState({
  space, type: roomType, date: DAY, sessions: [session],
  bookings: [seat('b1', 'me', { session_id: 'ses-1' })], profileId: 'me', now: morning,
});
assert(roomMine.action === 'leave', 'Joining a session can be undone from the same card');

const wrongDaySession = spaceDayState({
  space, type: roomType, date: '2026-11-12', sessions: [session], bookings: [], profileId: 'me', now: morning,
});
assert(
  wrongDaySession.session === undefined && wrongDaySession.needsSession,
  'A session belongs to its own date only',
  String(wrongDaySession.session?.id)
);

// --- Several sessions in one day ---------------------------------------------
const twoSessions = [session, afternoon];
const bothSessions = spaceDayState({
  space, type: roomType, date: DAY, sessions: [afternoon, session], bookings: [], profileId: 'me', now: morning,
});
assert(
  bothSessions.sessions.length === 2 &&
    bothSessions.sessions[0].session.id === 'ses-1' &&
    bothSessions.sessions[1].session.id === 'ses-2',
  'A room lists every session of the day in start order',
  bothSessions.sessions.map(entry => clockLabel(entry.session.starts_at)).join(', ')
);

const perSession = spaceDaySessions({
  space, date: DAY,
  sessions: twoSessions,
  bookings: [
    seat('b1', 'a', { session_id: 'ses-1' }),
    seat('b2', 'b', { session_id: 'ses-1' }),
    seat('b3', 'c', { session_id: 'ses-2' }),
  ],
  profileId: 'me',
  now: morning,
});
assert(
  perSession[0].seatsTaken === 2 && perSession[0].seatsFree === 1 && perSession[0].action === 'join' &&
    perSession[1].seatsTaken === 1 && perSession[1].seatsFree === 2,
  'Each session counts only its own seats',
  `${perSession[0].seatsTaken}/${space.capacity} · ${perSession[1].seatsTaken}/${space.capacity}`
);

const afternoonFocus = spaceDayState({
  space, type: roomType, date: DAY, sessions: twoSessions, bookings: [], profileId: 'me', now: at('12:00'),
});
assert(
  afternoonFocus.session?.id === 'ses-2',
  'The card leads with the next session that has not started yet',
  sessionLabel(afternoonFocus.session || session)
);

const roomFullPerSession = spaceDaySessions({
  space: { id: 'sp-1', capacity: 1 },
  date: DAY,
  sessions: twoSessions,
  bookings: [seat('b1', 'someone', { session_id: 'ses-1' })],
  profileId: 'me',
  now: morning,
});
assert(
  roomFullPerSession[0].full && roomFullPerSession[0].action === 'full' && roomFullPerSession[1].action === 'join',
  'A full session leaves the other session of the day open',
  `${roomFullPerSession[0].action} / ${roomFullPerSession[1].action}`
);

const mineMorning = spaceDayState({
  space, type: roomType, date: DAY, sessions: twoSessions,
  bookings: [seat('b1', 'me', { session_id: 'ses-1' }), seat('b2', 'other', { session_id: 'ses-2' })],
  profileId: 'me', now: morning,
});
assert(
  mineMorning.session?.id === 'ses-1' && mineMorning.sessions[1].action === 'join',
  'Holding a seat in one session still lets you join the next one',
  `${mineMorning.sessions[0].action} / ${mineMorning.sessions[1].action}`
);

const endedMorning = spaceDaySessions({
  space, date: DAY, sessions: twoSessions, bookings: [], profileId: 'me', now: at('11:00'),
});
assert(
  endedMorning[0].ended && endedMorning[0].action === 'ended' && !endedMorning[1].ended,
  'A window that already ended cannot be joined',
  `${endedMorning[0].action} / ${endedMorning[1].action}`
);
assert(
  sessionEnded({ session_date: '2026-11-09', ends_at: '23:00:00' }, morning) &&
    !sessionEnded({ session_date: '2026-11-11', ends_at: '00:10:00' }, morning) &&
    !sessionEnded(session, at('10:29')) && sessionEnded(session, at('10:30')),
  'Ended means a past date, or today once the end time has gone by'
);

assert(
  Boolean(overlappingSession(twoSessions, { startsAt: '10:00', endsAt: '11:00' })) &&
    overlappingSession(twoSessions, { startsAt: '10:30', endsAt: '14:00' }) === undefined &&
    overlappingSession(twoSessions, { startsAt: '09:00', endsAt: '09:30' }) === undefined,
  'A new window may not overlap a session already in the room',
  sessionLabel(overlappingSession(twoSessions, { startsAt: '10:00', endsAt: '11:00' }) || session)
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

// --- One whole-day seat per date ---------------------------------------------
const deskState = (bookings) => spaceDayState({
  space, type: deskType, date: '2026-11-10', sessions: [], bookings, profileId: 'me',
});
const other = { id: 'sp-2', capacity: 2 };
const otherDeskState = (bookings) => spaceDayState({
  space: other, type: deskType, date: '2026-11-10', sessions: [], bookings, profileId: 'me',
});
const roomState = spaceDayState({
  space: { id: 'sp-3', capacity: 4 }, type: roomType, date: '2026-11-10',
  sessions: [{ id: 'ss-1', space_id: 'sp-3', session_date: '2026-11-10', starts_at: '10:00', ends_at: '11:00', title: 'Sync' }],
  bookings: [{ ...seat('b1', 'me'), space_id: 'sp-3', session_id: 'ss-1' }],
  profileId: 'me',
});

const mine = new Map([['sp-1', deskState([seat('b1', 'me')])]]);
assert(
  heldWholeDaySpace(mine) === 'sp-1',
  'The whole-day seat a person holds is found for the day',
  heldWholeDaySpace(mine)
);
const twoDesks = new Map([
  ['sp-1', deskState([seat('b1', 'me')])],
  ['sp-2', otherDeskState([{ ...seat('b2', 'me'), space_id: 'sp-2' }])],
]);
assert(
  heldWholeDaySpace(twoDesks) === 'sp-1',
  'A second whole-day seat is still the same person-day, so only the first counts',
  heldWholeDaySpace(twoDesks)
);
assert(
  heldWholeDaySpace(new Map([['sp-3', roomState]])) === null,
  'A seat in a meeting-room session is not a whole-day seat',
  String(heldWholeDaySpace(new Map([['sp-3', roomState]])))
);
assert(
  heldWholeDaySpace(new Map([['sp-1', deskState([seat('b1', 'a')])]])) === null,
  'Nobody else\'s desk counts as your whole-day seat'
);

// --- The rule every booking path shares: one whole-day seat per person per date ---------------
const deskBooking = { ...seat('b1', 'me'), space_id: 'sp-1' };
const otherBooking = { ...seat('b2', 'me'), space_id: 'sp-2' };
const sessionBooking = { ...seat('b3', 'me'), space_id: 'sp-1', session_id: 'ss-1' };
const colleagueBooking = { ...seat('b4', 'someone-else'), space_id: 'sp-2' };

assert(
  wholeDayHeldOn([deskBooking], 'me', '2026-11-10', 'sp-2')?.id === 'b1',
  'A whole-day seat in another workspace is found, so a second one is refused',
  'sp-1'
);
assert(
  wholeDayHeldOn([deskBooking], 'me', '2026-11-10', 'sp-1') === null,
  'The seat in the room being booked does not count against itself'
);
assert(
  wholeDayHeldOn([deskBooking], 'me', '2026-11-11') === null,
  'Yesterday\'s desk does not block today'
);
assert(
  wholeDayHeldOn([sessionBooking], 'me', '2026-11-10', 'sp-2') === null,
  'A meeting-room session is not a whole-day seat'
);
assert(
  wholeDayHeldOn([colleagueBooking], 'me', '2026-11-10', 'sp-1') === null,
  'A colleague\'s desk is not yours'
);
assert(
  wholeDayHeldOn([otherBooking, deskBooking], 'me', '2026-11-10', 'sp-3')?.id === 'b2',
  'Two whole-day seats are still one rule: the first one held is reported'
);

// --- Taking a session back ---------------------------------------------------
assert(
  canDeleteSession({ created_by: 'me' }, 'me', false),
  'The person who opened a session can delete it'
);
assert(
  canDeleteSession({ created_by: 'someone-else' }, 'me', true),
  'An administrator can delete any session'
);
assert(
  !canDeleteSession({ created_by: 'someone-else' }, 'me', false),
  'A colleague\'s session is out of reach',
  'only its creator or an admin may remove it'
);
assert(
  !canDeleteSession({ created_by: null }, null, false),
  'A session without an owner is left to administrators'
);

// --- Inviting people to a session -------------------------------------------
// Only the person who opened the session, or an admin, may invite to it.
assert(
  canInviteToSession({ created_by: 'me' }, 'me', false),
  'The person who opened a session can invite people to it'
);
assert(
  canInviteToSession({ created_by: 'someone-else' }, 'me', true),
  'An administrator can invite people to any session'
);
assert(
  !canInviteToSession({ created_by: 'someone-else' }, 'me', false),
  'A colleague\'s session cannot be used to message people'
);
assert(
  canEditSession({ created_by: 'me' }, 'me', false),
  'The person who opened a session can change its time, title and invitees'
);
assert(
  canEditSession({ created_by: 'someone-else' }, 'me', true),
  'An administrator can edit any session'
);
assert(
  !canEditSession({ created_by: 'someone-else' }, 'me', false),
  'A colleague\'s session is out of reach for edits too'
);

assert(
  normalizeInviteEmail('  MAILTO:Ana.Papadopoulou@Orbit.GR ') === 'ana.papadopoulou@orbit.gr',
  'An address is trimmed, un-prefixed and lowercased',
  normalizeInviteEmail('  MAILTO:Ana.Papadopoulou@Orbit.GR ')
);
assert(
  normalizeInviteEmail('not-an-address') === null && normalizeInviteEmail('ana@orbit') === null,
  'Addresses without a domain are refused'
);

const parsedEmails = parseInviteEmails(
  'ana@orbit.gr, kostas@orbit.gr; ana@orbit.gr\n\nguest@example.com  broken'
);
assert(
  JSON.stringify(parsedEmails) === JSON.stringify(['ana@orbit.gr', 'kostas@orbit.gr', 'guest@example.com']),
  'Pasted lists are split, deduped and stripped of typos',
  parsedEmails.join(', ')
);

const directory = [
  { id: 'p-ana', first_name: 'Ana', last_name: 'Papadopoulou', work_email: 'Ana@Orbit.gr', status: 'active' },
  { id: 'p-leave', first_name: 'Eleni', last_name: 'OnLeave', work_email: 'eleni@orbit.gr', status: 'on_leave' },
  { id: 'p-gone', first_name: 'Gone', last_name: 'Person', work_email: 'gone@orbit.gr', status: 'departed' },
];
const targets = resolveInviteTargets(
  ['ana@orbit.gr', 'eleni@orbit.gr', 'gone@orbit.gr', 'guest@example.com'],
  directory
);
assert(
  targets[0].profile?.id === 'p-ana',
  'An active colleague is matched case-insensitively and invited on Slack',
  targets[0].profile?.work_email
);
assert(
  targets[1].profile?.id === 'p-leave',
  'A colleague on leave is still an Orbit user with a Slack account'
);
assert(
  targets[2].profile === undefined,
  'A departed colleague has no Slack to message, so the address is treated as external'
);
assert(
  targets[3].profile === undefined,
  'An address outside the directory is an external guest'
);

const delivery = summarizeInviteDelivery([
  {
    id: 'i1', session_id: 'ses-1', email: 'ana@orbit.gr', name: 'Ana',
    slack_status: 'sent', outlook_status: 'sent', seat: 'booked',
  },
  {
    id: 'i2', session_id: 'ses-1', email: 'guest@example.com', name: null,
    slack_status: 'skipped', outlook_status: 'failed', outlook_error: 'Graph refused', seat: 'none',
  },
  {
    id: 'i3', session_id: 'ses-1', email: 'kostas@orbit.gr', name: 'Kostas',
    slack_status: 'failed', slack_error: 'Slack: users_not_found', outlook_status: 'skipped', seat: 'full',
  },
]);
assert(
  delivery.invited === 3 && delivery.slackSent === 1 && delivery.outlookSent === 1 && delivery.seatsBooked === 1,
  'The invite summary counts each channel and the seats actually reserved',
  JSON.stringify(delivery)
);
assert(
  delivery.problems.length === 3
    && delivery.problems.some(problem => problem.problem.includes('Graph refused'))
    && delivery.problems.some(problem => problem.problem.includes('users_not_found'))
    && delivery.problems.some(problem => problem.problem.includes('session is full')),
  'Every failed channel and every unseated invitee is reported against their name',
  delivery.problems.map(problem => `${problem.who}: ${problem.problem}`).join(' | ')
);

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
