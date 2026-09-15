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

console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
