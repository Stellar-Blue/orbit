/**
 * Runnable check for working-day counting (no test framework — ponytail rule).
 *
 *   node scripts/verify-working-days.js
 *
 * Regression guard for "Record Leave for Employee always shows 0 calculated working days":
 * the DB stores 3-letter weekday codes ('Mon') while the old modal compared full names ('Monday').
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'leave-days.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const mod = { exports: {} };
new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod);
const D = mod.exports;

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};

// 2026-08-10 (Mon) → 2026-08-14 (Fri): a full working week.
check('full Mon–Fri week counts 5', D.countWorkingDays('2026-08-10', '2026-08-14', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']), 5);
check('the reported bug: 3-letter schedule counts days (was 0)', D.countWorkingDays('2026-08-10', '2026-08-14', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) > 0, true);
check('legacy full-name schedule still counts', D.countWorkingDays('2026-08-10', '2026-08-14', ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']), 5);
check('case/whitespace tolerant', D.countWorkingDays('2026-08-10', '2026-08-14', [' mon ', 'TUE', 'Wed', 'thu', 'FRI']), 5);
check('missing schedule falls back to Mon–Fri', D.countWorkingDays('2026-08-10', '2026-08-14', null), 5);
check('empty schedule falls back to Mon–Fri', D.countWorkingDays('2026-08-10', '2026-08-14', []), 5);

// Weekends are off-schedule.
check('Mon–Sun week counts 5 (weekend excludes itself)', D.countWorkingDays('2026-08-10', '2026-08-16', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']), 5);
check('a single Saturday counts 0', D.countWorkingDays('2026-08-15', '2026-08-15', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']), 0);
check('part-time Mon/Wed/Fri counts 3', D.countWorkingDays('2026-08-10', '2026-08-14', ['Mon', 'Wed', 'Fri']), 3);

// Excluded dates: holidays + mandatory closures.
check('holiday inside the range is excluded', D.countWorkingDays('2026-08-10', '2026-08-14', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], ['2026-08-12']), 4);
check('holidayDates maps rows to ISO dates', D.holidayDates([{ date: '2026-03-25' }, { date: '2026-05-01' }]), ['2026-03-25', '2026-05-01']);
check('no holidays → nothing excluded', D.countWorkingDays('2026-08-10', '2026-08-14', undefined, D.holidayDates(null)), 5);

// Degenerate input.
check('reversed range counts 0', D.countWorkingDays('2026-08-14', '2026-08-10', undefined), 0);
check('empty start counts 0', D.countWorkingDays('', '2026-08-14', undefined), 0);
check('same-day single workday counts 1', D.countWorkingDays('2026-08-10', '2026-08-10', undefined), 1);

// Month/year boundaries and DST transitions (Greek DST: 2026-03-29, 2026-10-25).
check('March 2026 working days (with DST switch)', D.countWorkingDays('2026-03-01', '2026-03-31', undefined), 22);
check('October 2026 working days (with DST switch)', D.countWorkingDays('2026-10-01', '2026-10-31', undefined), 22);
check('year-boundary range is inclusive (Thu 31/12 + Fri 01/01)', D.countWorkingDays('2026-12-31', '2027-01-01', undefined), 2);

// Schedule resolver.
check('resolver keeps canonical codes', D.resolveWorkSchedule(['Mon', 'Wed']), ['Mon', 'Wed']);
check('resolver normalises full names', D.resolveWorkSchedule(['Monday', 'Friday']), ['Mon', 'Fri']);
check('resolver drops junk', D.resolveWorkSchedule(['Mon', 'nonsense']), ['Mon']);
check('resolver falls back on empty', D.resolveWorkSchedule([]), D.DEFAULT_WORK_SCHEDULE);

// ---------------------------------------------------------------------------
// Year-boundary attribution: a leave's total must be split by the year each
// deducted day falls in. Real case: the Christmas closure 31/12/2025→02/01/2026
// is 2 working days (Wed 31 Dec, Fri 2 Jan — Thu 1 Jan is a holiday) and used to
// land entirely in 2025.
// ---------------------------------------------------------------------------
const NY = '2026-01-01';
const closure = { start: '2025-12-31', end: '2026-01-02', workingDays: 2 };
const isHoliday = iso => iso === NY;

check('closure → 1 day in 2025', D.deductedDaysInYear({ ...closure, year: 2025, isExcludedDate: isHoliday }), 1);
check('closure → 1 day in 2026', D.deductedDaysInYear({ ...closure, year: 2026, isExcludedDate: isHoliday }), 1);
check(
  'closure → both years add up to the stored total',
  D.deductedDaysInYear({ ...closure, year: 2025, isExcludedDate: isHoliday }) +
  D.deductedDaysInYear({ ...closure, year: 2026, isExcludedDate: isHoliday }),
  2,
);
check('unrelated year gets nothing', D.deductedDaysInYear({ ...closure, year: 2027, isExcludedDate: isHoliday }), 0);

// The reported range (30/12/2025→02/01/2026) when the holiday is NOT excluded:
// 3 scheduled days (Tue 30, Wed 31, Fri 2) split 2 / 1.
check(
  'no exclusion → 30/12→02/01 splits 2 in 2025',
  D.deductedDaysInYear({ start: '2025-12-30', end: '2026-01-02', workingDays: 3, year: 2025 }),
  2,
);
check(
  'no exclusion → 30/12→02/01 splits 1 in 2026',
  D.deductedDaysInYear({ start: '2025-12-30', end: '2026-01-02', workingDays: 3, year: 2026 }),
  1,
);

// Personal leave: a company closure inside the range must not consume deducted slots.
const insideClosure = iso => iso >= '2025-12-31' && iso <= '2026-01-02';
check(
  'personal leave skips days swallowed by a closure',
  D.deductedDaysInYear({ start: '2025-12-29', end: '2026-01-05', workingDays: 3, year: 2026, isExcludedDate: insideClosure }),
  1,
);
check(
  'personal leave → same range, 2025 share',
  D.deductedDaysInYear({ start: '2025-12-29', end: '2026-01-05', workingDays: 3, year: 2025, isExcludedDate: insideClosure }),
  2,
);

// Unchanged behaviour for single-year ranges (fast path returns the stored total).
check('single-year range returns the stored total', D.deductedDaysInYear({ start: '2026-03-02', end: '2026-03-06', workingDays: 5, year: 2026 }), 5);
check('single-year range, admin-adjusted total kept', D.deductedDaysInYear({ start: '2026-01-02', end: '2026-01-07', workingDays: 1, year: 2026 }), 1);
check('zero-day leave contributes nothing', D.deductedDaysInYear({ start: '2025-12-31', end: '2026-01-02', workingDays: 0, year: 2025 }), 0);
check('reversed range contributes nothing', D.deductedDaysInYear({ start: '2026-01-02', end: '2025-12-31', workingDays: 2, year: 2026 }), 0);
// The same range splits differently by schedule, which is the point: the first N *scheduled*
// days are the deducted ones. Mon/Wed/Fri → Mon 29 + Wed 31 (both 2025); Mon–Fri → Wed 31 (2025)
// + Fri 2 Jan (2026).
check('part-time (Mon/Wed/Fri), 2 days → both in 2025', D.deductedDaysInYear({ start: '2025-12-29', end: '2026-01-02', workingDays: 2, year: 2025, schedule: ['Mon', 'Wed', 'Fri'] }), 2);
check('part-time (Mon/Wed/Fri), 2 days → none in 2026', D.deductedDaysInYear({ start: '2025-12-29', end: '2026-01-02', workingDays: 2, year: 2026, schedule: ['Mon', 'Wed', 'Fri'] }), 0);
// Mon–Fri: the first two deducted days are Mon 29 + Tue 30 Dec, so a 2-day total stays in 2025 …
check('full-time, 2 days → none in 2026', D.deductedDaysInYear({ start: '2025-12-29', end: '2026-01-02', workingDays: 2, year: 2026 }), 0);
// … while a 4-day total reaches Fri 2 Jan and therefore does cross into 2026.
check('full-time, 4 days → 3 in 2025', D.deductedDaysInYear({ start: '2025-12-29', end: '2026-01-02', workingDays: 4, year: 2025 }), 3);
check('full-time, 4 days → 1 in 2026', D.deductedDaysInYear({ start: '2025-12-29', end: '2026-01-02', workingDays: 4, year: 2026 }), 1);

console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
