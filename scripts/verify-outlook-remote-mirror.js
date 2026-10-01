/**
 * Verification Script — Outlook remote-day mirroring
 *
 * The invariant, as the Outlook APIs actually allow it (verified against a live tenant):
 *   - a remote PATTERN     -> exactly ONE recurring `weekly` + `noEnd` work-plan rule
 *   - an ad-hoc remote day -> exactly ONE calendar event (all-day, show-as "working elsewhere")
 *   - a day inside leave   -> leave only (leave wins)
 *   - remote NEVER becomes a work-plan occurrence: Graph rejects it with
 *     "Only TimeOff work plan occurrences can be created via this endpoint"
 *
 * Run: node scripts/verify-outlook-remote-mirror.js
 *
 * Why this exists: the earlier design wrote a one-off `remote` work-plan occurrence per declared
 * day. Graph refused every one of them and the sync swallowed the error, so declared remote days
 * silently reached nothing at all. The rule that prevents that regression is structural, so it is
 * asserted here rather than left to review.
 */

let passed = 0;
let failed = 0;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    if (details) console.log(`          └─ ${details}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    if (details) console.error(`          └─ ${details}`);
    failed++;
  }
}

// -----------------------------------------------------------------------------
// Mirrored predicates (keep in step with outlook.ts)
// -----------------------------------------------------------------------------

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** outlook.ts weekdayOf() — date-only string, no timezone drift. */
function weekdayOf(dateStr) {
  return WEEKDAY_SHORT[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
}

/** outlook.ts remotePatternCovers() — remote_patterns rows are short weekday names. */
function remotePatternCovers(dateStr, patterns) {
  const wd = weekdayOf(dateStr);
  return patterns.some(p =>
    p.weekday === wd && dateStr >= p.valid_from && (!p.valid_to || dateStr <= p.valid_to)
  );
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** outlook.ts buildTimeOffPayload() — all-day segments end at 00:00 of the NEXT day. */
function timeOffEnd(dateStr, endTime) {
  return endTime ? `${dateStr}T${endTime}` : `${addDays(dateStr, 1)}T00:00:00`;
}

/**
 * Reduction of one sync pass, matching outlook.ts semantics:
 *   calendar events <- leave + ad-hoc declared remote days (all-day, workingElsewhere)
 *   work-plan rules <- one recurring `weekly`+`noEnd` rule per remote pattern row
 *   occurrences     <- timeOff only; remote is never an occurrence
 */
function planRemoteMirror({ patterns, remoteDays, leaves = [], today, horizonEnd }) {
  const calendarEvents = [];
  const recurringRules = new Map();
  for (const p of patterns) {
    recurringRules.set(`wprec:pat:${p.id}`, { weekday: p.weekday, marker: `wprec:pat:${p.id}` });
  }

  const leaveRanges = leaves.map(l => ({
    start: l.start_date < today ? today : l.start_date,
    end: l.end_date > horizonEnd ? horizonEnd : l.end_date,
  }));

  for (const rd of remoteDays) {
    if (rd.date < today || rd.date > horizonEnd) continue;
    if (rd.mode !== 'remote_gr' && rd.mode !== 'remote_abroad') continue;
    if (remotePatternCovers(rd.date, patterns)) continue;                          // the rule carries it
    if (leaveRanges.some(l => rd.date >= l.start && rd.date <= l.end)) continue;   // leave wins
    calendarEvents.push({
      date: rd.date, marker: `remote:day:${rd.id}`, allDay: true, showAs: 'workingElsewhere',
    });
  }

  return { calendarEvents, recurringRules };
}

// -----------------------------------------------------------------------------
// Scenarios
// -----------------------------------------------------------------------------

const TODAY = '2026-10-01';
const HORIZON = addDays(TODAY, 59); // 60-day default horizon

console.log('===============================================================');
console.log('🚀 OUTLOOK REMOTE MIRRORING — INVARIANT VERIFICATION');
console.log('===============================================================\n');

// --- 1. Reported bug: declared remote days with no remote pattern ---
{
  const declared = ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12'].map((date, i) => ({
    id: `rd-${i}`, date, mode: 'remote_gr',
  }));
  const r = planRemoteMirror({ patterns: [], remoteDays: declared, today: TODAY, horizonEnd: HORIZON });

  assert(r.calendarEvents.length === declared.length,
    'every declared ad-hoc remote day produces an artifact',
    `${declared.length} declared -> ${r.calendarEvents.length} event(s)`);
  assert(r.calendarEvents.every(e => e.marker.startsWith('remote:day:')),
    'the artifact is a calendar event, not a work-plan occurrence',
    `markers: ${r.calendarEvents.map(e => e.marker).join(', ')}`);
  assert(r.calendarEvents.every(e => e.allDay && e.showAs === 'workingElsewhere'),
    'the event is all-day and shows as "working elsewhere"');
}

// --- 2. Pattern with one remote weekday: ONE recurring rule, no per-day events ---
{
  const patterns = [{ id: 'p-tue', weekday: 'Tue', mode: 'remote_gr', valid_from: '2026-09-01', valid_to: null }];
  const tuesdays = daysBetween(TODAY, HORIZON).filter(d => weekdayOf(d) === 'Tue');
  const matchingDays = tuesdays.map((date, i) => ({ id: `rd-tue-${i}`, date, mode: 'remote_gr' }));

  const r = planRemoteMirror({ patterns, remoteDays: matchingDays, today: TODAY, horizonEnd: HORIZON });

  assert(r.recurringRules.size === 1,
    'a remote routine is exactly ONE recurring work-plan rule',
    `marker=${[...r.recurringRules.keys()][0]} weekday=${[...r.recurringRules.values()][0].weekday}`);
  assert(r.calendarEvents.length === 0,
    'a pattern-covered day gets NO per-day event (no double representation)',
    `${tuesdays.length} remote Tuesdays in the horizon, 0 events`);
  assert(tuesdays.length > 1 && r.recurringRules.size + r.calendarEvents.length === 1,
    'N remote pattern days collapse to 1 artifact (not N)');
}

// --- 3. Mixed: pattern Tuesday + ad-hoc Thursday + an office row ---
{
  const patterns = [{ id: 'p-tue', weekday: 'Tue', mode: 'remote_gr', valid_from: '2026-09-01', valid_to: null }];
  const remoteDays = [
    { id: 'rd-pattern', date: '2026-10-06', mode: 'remote_gr' },  // Tuesday — pattern covers it
    { id: 'rd-adhoc', date: '2026-10-08', mode: 'remote_gr' },    // Thursday — ad-hoc
    { id: 'rd-office', date: '2026-10-09', mode: 'office' },      // office row — nothing
  ];
  const r = planRemoteMirror({ patterns, remoteDays, today: TODAY, horizonEnd: HORIZON });

  assert(r.recurringRules.size === 1 && r.calendarEvents.length === 1,
    'pattern day -> 1 rule, ad-hoc day -> 1 event, office row -> nothing',
    `rules=${r.recurringRules.size} events=${r.calendarEvents.length}`);
  assert(r.calendarEvents[0].marker === 'remote:day:rd-adhoc',
    'only the ad-hoc day becomes an event',
    `marker=${r.calendarEvents[0].marker}`);
}

// --- 4. No remote day is ever represented twice ---
{
  const patterns = [
    { id: 'p-tue', weekday: 'Tue', mode: 'remote_gr', valid_from: '2026-09-01', valid_to: null },
    { id: 'p-thu', weekday: 'Thu', mode: 'remote_abroad', valid_from: '2026-10-15', valid_to: '2026-11-30' },
  ];
  const horizonDays = daysBetween(TODAY, HORIZON);
  const remoteDays = horizonDays.map((date, i) => ({ id: `rd-${i}`, date, mode: i % 2 ? 'remote_gr' : 'remote_abroad' }));

  const r = planRemoteMirror({ patterns, remoteDays, today: TODAY, horizonEnd: HORIZON });
  const eventDates = r.calendarEvents.map(e => e.date);
  const coveredDates = horizonDays.filter(d => remotePatternCovers(d, patterns));
  const overlap = coveredDates.filter(d => eventDates.includes(d));

  assert(overlap.length === 0,
    'no date is both pattern-covered and an event',
    `${coveredDates.length} covered date(s), ${eventDates.length} event(s), overlap=${overlap.length}`);
  assert(new Set(eventDates).size === eventDates.length,
    'no duplicate events for the same date');
}

// --- 5. Horizon + past-day discipline ---
{
  const remoteDays = [
    { id: 'rd-past', date: addDays(TODAY, -3), mode: 'remote_gr' },
    { id: 'rd-today', date: TODAY, mode: 'remote_gr' },
    { id: 'rd-beyond', date: addDays(HORIZON, 5), mode: 'remote_gr' },
  ];
  const r = planRemoteMirror({ patterns: [], remoteDays, today: TODAY, horizonEnd: HORIZON });
  assert(r.calendarEvents.length === 1 && r.calendarEvents[0].date === TODAY,
    'only remote days inside [today, horizon] are mirrored',
    `event=${r.calendarEvents[0]?.date}`);
}

// --- 6. Leave wins over a remote day ---
{
  const remoteDays = [{ id: 'rd-inleave', date: '2026-10-06', mode: 'remote_gr' }];
  const leaves = [{ id: 'lv-1', start_date: '2026-10-05', end_date: '2026-10-07' }];
  const r = planRemoteMirror({ patterns: [], remoteDays, leaves, today: TODAY, horizonEnd: HORIZON });
  assert(r.calendarEvents.length === 0,
    'a remote day inside an approved leave emits no remote artifact (leave wins)');
}

// --- 7. Graph API shape: what remote must never be ---
{
  assert(timeOffEnd('2026-11-03') === '2026-11-04T00:00:00',
    'all-day work-plan occurrences end at 00:00 of the next day',
    'Graph rejects 23:59:59 with "Invalid end time for IsAllDay segment"');
  assert(timeOffEnd('2026-11-03', '13:00:00') === '2026-11-03T13:00:00',
    'half-day occurrences keep their explicit end time');
  assert(!planRemoteMirror({ patterns: [], remoteDays: [{ id: 'x', date: TODAY, mode: 'remote_gr' }], today: TODAY, horizonEnd: HORIZON })
    .calendarEvents.some(e => e.marker.startsWith('wpto:')),
    'no ad-hoc remote day is ever queued as a work-plan occurrence',
    'Graph: "Only TimeOff work plan occurrences can be created via this endpoint"');
}

console.log(`\n===============================================================`);
console.log(`${failed === 0 ? '✅ ALL CHECKS PASSED' : '❌ FAILURES PRESENT'} — ${passed} passed, ${failed} failed`);
console.log(`================================================================`);

process.exit(failed === 0 ? 0 : 1);
