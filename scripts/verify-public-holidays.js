/**
 * Runnable check for the public-holiday calendar (no test framework — ponytail rule).
 *
 *   node scripts/verify-public-holidays.js
 *
 * `public_holidays` is the single source of truth for working-day maths, and the 2024-2030 seed in
 * migration 0078 is hand-written — which is exactly how 2024 and 2025 went missing and 15 August
 * 2024 ended up charging a leave day to everybody. The movable Orthodox feasts are the part a human
 * gets wrong, so this script COMPUTES them (Meeus' Julian computus, independent of the file) and
 * compares against what the migration actually inserts.
 */
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '0078_public_holidays_2024_2030.sql'),
  'utf8',
);

// One tuple per line: ('2024-01-01', 'Πρωτοχρονιά', 'New Year''s Day', 'national'),
const TUPLE = /^\(\s*'(\d{4}-\d{2}-\d{2})',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'(national|thessaloniki)'\s*\)/;
const rows = [];
for (const line of sql.split('\n')) {
  const m = TUPLE.exec(line.trim().replace(/,$/, ''));
  if (m) rows.push({ date: m[1], name_el: m[2], name_en: m[3], scope: m[4], year: Number(m[1].slice(0, 4)) });
}

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (isoDate, days) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return iso(new Date(y, m - 1, d + days));
};

/**
 * Orthodox Easter (Gregorian date) via Meeus' Julian computus + the current 13-day offset.
 * Valid 1900-03-01 → 2100-02-28, which covers this calendar. Source: Meeus, "Astronomical
 * Algorithms", Easter in the Julian calendar; cross-checked against Wikipedia's List of dates for
 * Easter, which gives Julian Easter (Gregorian) for 2024-2030 as May 5, Apr 20, Apr 12, May 2,
 * Apr 16, Apr 8, Apr 28.
 */
function orthodoxEasterGregorian(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return shift(iso(new Date(year, month - 1, day)), 13);
}

check('parsed the 2024-2030 calendar from 0078', rows.length === 98, `parsed ${rows.length} rows`);

// --- 1. Every year present, complete, and free of duplicates --------------------------------
const YEARS = [2024, 2025, 2026, 2027, 2028, 2029, 2030];
const FIXED = ['01-01', '01-06', '03-25', '08-15', '10-28', '12-25', '12-26'];

const seen = new Set();
let duplicates = 0;
for (const r of rows) {
  const key = `${r.date}|${r.scope}`;
  if (seen.has(key)) duplicates++;
  seen.add(key);
  if (r.year !== Number(r.date.slice(0, 4))) failed++;
}
check('no duplicate (date, scope) — matches the DB unique constraint', duplicates === 0, `${duplicates} duplicate(s)`);

for (const year of YEARS) {
  const inYear = rows.filter((r) => r.year === year);
  check(`${year}: 14 holidays (13 national + 1 Thessaloniki)`, inYear.length === 14,
    `found ${inYear.length}: ${inYear.length ? '' : '(the whole year is missing — leave spend is overstated all year)'}`);
  check(`${year}: Thessaloniki local holiday present`, inYear.filter((r) => r.scope === 'thessaloniki').length === 1);
  for (const md of FIXED) {
    check(`${year}-${md} present`, inYear.some((r) => r.date === `${year}-${md}`));
  }
  check(`${year}: no holiday the DB would reject (both names set)`,
    inYear.every((r) => r.name_el.trim().length > 0 && r.name_en.trim().length > 0));
}

// --- 2. Movable feasts must follow that year's Orthodox Easter -------------------------------
for (const year of YEARS) {
  const easter = orthodoxEasterGregorian(year);
  const has = (d) => rows.some((r) => r.date === d && r.scope === 'national');
  check(`${year}: Orthodox Easter Sunday is ${easter}`, has(easter));
  check(`${year}: Clean Monday is Easter - 48 (${shift(easter, -48)})`, has(shift(easter, -48)));
  check(`${year}: Good Friday is Easter - 2 (${shift(easter, -2)})`, has(shift(easter, -2)));
  check(`${year}: Easter Monday is Easter + 1 (${shift(easter, 1)})`, has(shift(easter, 1)));
  check(`${year}: Whit Monday is Easter + 50 (${shift(easter, 50)})`, has(shift(easter, 50)));
}

// --- 3. Labour Day: exactly one per year, and on a working day -------------------------------
// Greek law transfers 1 May when it lands on a weekend / in Holy Week, which is what the
// per-year choices below encode (2024: Holy Wednesday -> Tue 7 May; 2027: Saturday -> Tue 4 May).
const LABOUR_DAY = {
  2024: '2024-05-07',
  2025: '2025-05-01',
  2026: '2026-05-01',
  2027: '2027-05-04',
  2028: '2028-05-01',
  2029: '2029-05-01',
  2030: '2030-05-01',
};
for (const year of YEARS) {
  const labour = rows.filter((r) => /Πρωτομαγιά/.test(r.name_el) && r.year === year);
  check(`${year}: exactly one Labour Day row`, labour.length === 1, `found ${labour.length}`);
  check(`${year}: Labour Day lands on ${LABOUR_DAY[year]}`, labour[0] && labour[0].date === LABOUR_DAY[year],
    `found ${labour[0] ? labour[0].date : 'nothing'}`);
  // A transferred holiday must not be left on its original date as well, or the year loses 2 days.
  check(`${year}: original 1 May not also booked`, !rows.some((r) => r.date === `${year}-05-01`) || LABOUR_DAY[year] === `${year}-05-01`);
}

// --- 4. The reported bug, pinned ------------------------------------------------------------
check('15 August 2024 is a holiday (the reported missing day)', rows.some((r) => r.date === '2024-08-15'));
check('2025 is not empty (Epiphany / Christmas 2025 were missing too)', rows.filter((r) => r.year === 2025).length === 14);
check('2027 Labour Day hole is filled', rows.some((r) => r.date === '2027-05-04'));

console.log(failed === 0 ? '\nAll public-holiday checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
