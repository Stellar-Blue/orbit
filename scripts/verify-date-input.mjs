/**
 * Verification for the date field's parsing, formatting and calendar maths.
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-date-input.mjs
 *
 * Everything the DatePicker relies on to behave predictably lives in lib/date-input, so it can be
 * checked without a browser.
 */

import {
  clampMonthToRange,
  clampToRange,
  daysBetweenIso,
  formatDisplayDate,
  formatDisplayMonth,
  isoDaysBetween,
  isoFromDate,
  isSelectableIso,
  monthLabel,
  monthMatrix,
  monthOfIsoDate,
  parseDateText,
  parseMonthText,
  shiftIsoDate,
  shiftIsoMonth,
  shiftIsoYear,
  yearMonths,
} from '@/lib/date-input';

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

const today = new Date(2026, 9, 27); // Tue 27 Oct 2026, local time

console.log('================================================================');
console.log('🚀 ORBIT DATE FIELD - VERIFICATION');
console.log('================================================================\n');

// --- Typing dates -------------------------------------------------------------
const parsed = (raw) => parseDateText(raw, today);

assert(parsed('07/08/2026') === '2026-08-07', 'DD/MM/YYYY is understood', parsed('07/08/2026'));
assert(parsed('7/8/26') === '2026-08-07', 'Single digits and a two-digit year are understood');
assert(parsed('7-8-2026') === '2026-08-07' && parsed('7.8.2026') === '2026-08-07',
  'Hyphens and dots work as separators');
assert(parsed('2026-08-07') === '2026-08-07', 'An ISO date pasted back in is understood');
assert(parsed('2026/8/7') === '2026-08-07', 'Year-first with slashes is understood');
assert(parsed('07082026') === '2026-08-07', 'Eight digits are read as DDMMYYYY');
assert(parsed(' 10/12/2026 ') === '2026-12-10', 'Surrounding spaces are ignored');
assert(parsed('') === null && parsed('   ') === null, 'An empty field is not a date');
assert(parsed('31/02/2026') === null, 'Impossible calendar days are rejected');
assert(parsed('32/01/2026') === null && parsed('01/13/2026') === null, 'Out-of-range parts are rejected');
assert(parsed('hello') === null && parsed('07/08/2026x') === null, 'Garbage is rejected, never guessed');
assert(parsed('07/08/1800') === '1800-08-07', 'Old dates still parse (contracts can be historic)');

assert(parsed('today') === '2026-10-27', '"today" resolves to the local calendar day');
assert(parsed('today') === isoFromDate(today), 'Today never drifts by timezone');
assert(parsed('+7') === '2026-11-03', 'A relative +N jumps that many days ahead');
assert(parsed('-3d') === '2026-10-24', 'A relative -Nd jumps back');
assert(parsed('+1') === '2026-10-28', 'Relative shortcuts work across month ends');

// --- Typing months ------------------------------------------------------------
const parsedMonth = (raw) => parseMonthText(raw, today);
assert(parsedMonth('08/2026') === '2026-08', 'A month is typed as MM/YYYY', parsedMonth('08/2026'));
assert(parsedMonth('2026-8') === '2026-08', 'Year-first months are understood');
assert(parsedMonth('8/26') === '2026-08', 'A two-digit year is accepted for months');
assert(parsedMonth('today') === '2026-10', 'A month field understands "today"');
assert(parsedMonth('+2') === '2026-12', 'A month field understands relative months');
assert(parsedMonth('13/2026') === null && parsedMonth('00/2026') === null, 'Impossible months are rejected');
assert(parsedMonth('') === null, 'An empty month field is not a month');

// --- Display ------------------------------------------------------------------
assert(formatDisplayDate('2026-08-07') === '07/08/2026', 'Dates display as DD/MM/YYYY, Greek style');
assert(formatDisplayDate('') === '' && formatDisplayDate(null) === '', 'No value shows an empty field');
assert(formatDisplayDate('2026-02-30') === '', 'An invalid stored value never renders a wrong day');
assert(formatDisplayMonth('2026-08') === '08/2026', 'Months display as MM/YYYY');
assert(formatDisplayMonth('2026-08-07') === '' && formatDisplayMonth('') === '', 'Month display rejects non-months');

// --- Range --------------------------------------------------------------------
assert(clampToRange('2026-08-07', '2026-01-01', '2026-12-31') === '2026-08-07', 'A date inside the range passes');
assert(clampToRange('2026-08-07', '2026-09-01') === null, 'A date before the minimum is refused');
assert(clampToRange('2026-08-07', null, '2026-07-31') === null, 'A date after the maximum is refused');
assert(clampToRange('2026-08-07', '2026-08-07', '2026-08-07') === '2026-08-07', 'The bounds themselves are allowed');
assert(isSelectableIso('2026-08-07', '2026-01-01', '2026-12-31') === true, 'Selectable days answer yes');
assert(isSelectableIso('2025-12-31', '2026-01-01') === false, 'Days outside the range answer no');
assert(clampMonthToRange('2026-08', '2026-01', '2026-12') === '2026-08', 'Months honour their range');
assert(clampMonthToRange('2027-01', null, '2026-12') === null, 'A month past the maximum is refused');

// --- Moving around ------------------------------------------------------------
assert(shiftIsoDate('2026-10-27', 7) === '2026-11-03', 'Days shift across a month boundary');
assert(shiftIsoDate('2026-12-31', 1) === '2027-01-01', 'Days shift across a year boundary');
assert(shiftIsoDate('2026-10-27', 5, null, '2026-10-30') === null, 'A shift past the maximum is clamped away');
assert(shiftIsoMonth('2026-01', -1) === '2025-12', 'Months shift backwards across years');
assert(shiftIsoMonth('2026-12', 1) === '2027-01', 'Months shift forwards across years');
assert(shiftIsoYear('2026-08', -4) === '2022-08', 'Years shift');
assert(monthOfIsoDate('2026-08-07') === '2026-08', 'A date maps to its month');
assert(monthLabel('2026-08') === 'August 2026', 'Month labels read naturally', monthLabel('2026-08'));
assert(yearMonths(2026).length === 12 && yearMonths(2026)[0] === '2026-01' && yearMonths(2026)[11] === '2026-12',
  'A year lists twelve months');
assert(daysBetweenIso('2026-10-27', '2026-11-03') === 7, 'Day counts are exact');
assert(daysBetweenIso('2026-11-03', '2026-10-27') === -7, 'Day counts go negative backwards');
assert(isoDaysBetween('2026-10-30', '2026-11-02').join(',') === '2026-10-30,2026-10-31,2026-11-01,2026-11-02',
  'Day ranges are inclusive');

// --- Calendar grid ------------------------------------------------------------
const october = monthMatrix('2026-10');
assert(october.length === 42, 'The calendar is always six weeks tall', String(october.length));
assert(october[0] === '2026-09-28', 'The grid starts on the Monday on or before the 1st', october[0]);
assert(october.includes('2026-10-01') && october.includes('2026-10-31'), 'Every day of the month is present');
assert(october[41] === '2026-11-08', 'The grid ends on the Sunday after the last day', october[41]);
assert(new Set(october).size === 42, 'No day appears twice');

const february = monthMatrix('2028-02');
assert(february.includes('2028-02-29'), 'Leap days appear');
const march = monthMatrix('2026-03');
assert(march[0] === '2026-02-23' && march.includes('2026-03-01'), 'A month starting on Sunday still starts on Monday');
const feb2026 = monthMatrix('2026-02');
assert(feb2026.includes('2026-02-28') && !feb2026.includes('2026-02-29'), 'A short month has no phantom 29th');
assert(monthMatrix('not-a-month').length === 0, 'A bad month yields no grid');

assert(isoFromDate(new Date(2026, 0, 5)) === '2026-01-05', 'Local dates serialise without a UTC shift');

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
