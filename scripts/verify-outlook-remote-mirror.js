/**
 * Verification Script — Outlook remote-day mirroring (the "one remote day = one work-plan artifact" rule)
 *
 * Mirrors the two pure predicates in src/lib/integrations/outlook.ts:
 *   - syncWorkPlan        → which remote days get a work-plan rule vs. a one-off occurrence
 *   - computeDesiredEvents → which artifacts become calendar events (remote: none, ever)
 *
 * Run: node scripts/verify-outlook-remote-mirror.js
 *
 * Why this exists: per-day "Working remotely" calendar events were created by the event pass while the
 * work-plan pass deleted them as legacy, so the two fought and calendars filled up. The invariant that
 * prevents the regression is structural, so it is asserted here rather than left to review.
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

/** outlook.ts coveredByRemotePattern() — remote_patterns rows are short weekday names. */
function coveredByRemotePattern(dateStr, patterns) {
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

/**
 * Reduction of one sync pass, matching outlook.ts semantics:
 *   calendar events  <- leave only (remote produces none)
 *   work-plan rules  <- one recurring rule per remote pattern row
 *   occurrences      <- one per ad-hoc remote day not covered by a pattern
 */
function planRemoteMirror({ patterns, remoteDays, today, horizonEnd }) {
  const calendarEvents = [];
  const recurringRules = new Map();
  for (const p of patterns) {
    recurringRules.set(`wprec:pat:${p.id}`, { weekday: p.weekday, marker: `wprec:pat:${p.id}` });
  }

  const occurrences = [];
  for (const rd of remoteDays) {
    if (rd.date < today || rd.date > horizonEnd) continue;
    if (rd.mode !== 'remote_gr' && rd.mode !== 'remote_abroad') continue;
    if (coveredByRemotePattern(rd.date, patterns)) continue; // the recurring rule already carries it
    occurrences.push({ date: rd.date, marker: `wpto:rd:${rd.id}` });
  }

  return { calendarEvents, recurringRules, occurrences };
}

// -----------------------------------------------------------------------------
// Scenarios
// -----------------------------------------------------------------------------

const TODAY = '2026-09-28';
const HORIZON = addDays(TODAY, 59); // 60-day default horizon

console.log('===============================================================');
console.log('🚀 OUTLOOK REMOTE MIRRORING — INVARIANT VERIFICATION');
console.log('===============================================================\n');

// --- 1. Reported bug: office-only pattern, but leftover remote_days rows in the horizon ---
{
  const leftover = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'].map((date, i) => ({
    id: `rd-office-${i}`, date, mode: 'remote_gr',
  }));
  const r = planRemoteMirror({ patterns: [], remoteDays: leftover, today: TODAY, horizonEnd: HORIZON });

  assert(r.calendarEvents.length === 0,
    'office-only pattern creates ZERO remote calendar events',
    `calendarEvents=${JSON.stringify(r.calendarEvents)}`);
  assert(r.recurringRules.size === 0,
    'office-only pattern creates no recurring remote work-plan rule');
  assert(r.occurrences.length === leftover.length,
    'leftover declared remote days stay declared, as one-off work-plan entries',
    `${r.occurrences.length} occurrence(s), each marker-distinct: ${new Set(r.occurrences.map(o => o.marker)).size} unique`);
}

// --- 2. Pattern with one remote weekday: ONE recurring rule, no per-day events ---
{
  const patterns = [{ id: 'p-tue', weekday: 'Tue', mode: 'remote_gr', valid_from: '2026-09-01', valid_to: null }];
  const tuesdays = daysBetween(TODAY, HORIZON).filter(d => weekdayOf(d) === 'Tue');
  const matchingDays = tuesdays.map((date, i) => ({ id: `rd-tue-${i}`, date, mode: 'remote_gr' }));

  const r = planRemoteMirror({ patterns, remoteDays: matchingDays, today: TODAY, horizonEnd: HORIZON });

  assert(r.calendarEvents.length === 0,
    'a remote routine never becomes per-day calendar events',
    `${tuesdays.length} remote Tuesdays in the horizon, 0 events`);
  assert(r.recurringRules.size === 1,
    'a remote routine is exactly ONE recurring work-plan rule',
    `marker=${[...r.recurringRules.keys()][0]} weekday=${[...r.recurringRules.values()][0].weekday}`);
  assert(r.occurrences.length === 0,
    'pattern-covered days get NO extra occurrence (no double representation)',
    `skipped ${matchingDays.length} pattern-covered day(s)`);
  assert(tuesdays.length > 1 && r.calendarEvents.length + r.recurringRules.size === 1,
    'N remote days in the horizon collapse to 1 artifact (not N)');
}

// --- 3. Mixed: pattern Tuesday + ad-hoc Thursday ---
{
  const patterns = [{ id: 'p-tue', weekday: 'Tue', mode: 'remote_gr', valid_from: '2026-09-01', valid_to: null }];
  const remoteDays = [
    { id: 'rd-pattern', date: '2026-10-06', mode: 'remote_gr' },  // Tuesday — pattern covers it
    { id: 'rd-adhoc', date: '2026-10-08', mode: 'remote_gr' },    // Thursday — ad-hoc
    { id: 'rd-office', date: '2026-10-09', mode: 'office' },      // office row — nothing
  ];
  const r = planRemoteMirror({ patterns, remoteDays, today: TODAY, horizonEnd: HORIZON });

  assert(r.recurringRules.size === 1 && r.occurrences.length === 1 && r.calendarEvents.length === 0,
    'pattern day -> 1 rule, ad-hoc day -> 1 occurrence, office row -> nothing',
    `rules=${r.recurringRules.size} occurrences=${r.occurrences.length} events=${r.calendarEvents.length}`);
  assert(r.occurrences[0].marker === 'wpto:rd:rd-adhoc',
    'only the ad-hoc day becomes an occurrence');
}

// --- 4. No remote day is ever represented twice, and never as a calendar event ---
{
  const patterns = [
    { id: 'p-tue', weekday: 'Tue', mode: 'remote_gr', valid_from: '2026-09-01', valid_to: null },
    { id: 'p-thu', weekday: 'Thu', mode: 'remote_abroad', valid_from: '2026-10-15', valid_to: '2026-11-30' },
  ];
  const horizonDays = daysBetween(TODAY, HORIZON);
  const remoteDays = horizonDays.map((date, i) => ({ id: `rd-${i}`, date, mode: i % 2 ? 'remote_gr' : 'remote_abroad' }));

  const r = planRemoteMirror({ patterns, remoteDays, today: TODAY, horizonEnd: HORIZON });
  const occurrenceDates = r.occurrences.map(o => o.date);
  const coveredDates = horizonDays.filter(d => coveredByRemotePattern(d, patterns));

  const overlap = coveredDates.filter(d => occurrenceDates.includes(d));
  assert(overlap.length === 0,
    'no date is both pattern-covered and an occurrence',
    `${coveredDates.length} covered date(s), ${occurrenceDates.length} occurrence(s), overlap=${overlap.length}`);
  assert(new Set(occurrenceDates).size === occurrenceDates.length,
    'no duplicate occurrences for the same date');
  assert(r.calendarEvents.every(e => !e.marker.startsWith('remote:')),
    'rule: a calendar event marker is never a remote marker',
    'remote:day:* / remote:pat:* are legacy-only and produced by nothing');
}

// --- 5. Horizon + past-day discipline ---
{
  const patterns = [];
  const remoteDays = [
    { id: 'rd-past', date: addDays(TODAY, -3), mode: 'remote_gr' },
    { id: 'rd-today', date: TODAY, mode: 'remote_gr' },
    { id: 'rd-beyond', date: addDays(HORIZON, 5), mode: 'remote_gr' },
  ];
  const r = planRemoteMirror({ patterns, remoteDays, today: TODAY, horizonEnd: HORIZON });
  assert(r.occurrences.length === 1 && r.occurrences[0].date === TODAY,
    'only remote days inside [today, horizon] are mirrored',
    `occurrence=${r.occurrences[0]?.date}`);
}

console.log(`\n===============================================================`);
console.log(`${failed === 0 ? '✅ ALL CHECKS PASSED' : '❌ FAILURES PRESENT'} — ${passed} passed, ${failed} failed`);
console.log(`================================================================`);

process.exit(failed === 0 ? 0 : 1);
