/**
 * Runnable check for the automatic leave carry-over maths (ponytail rule: no framework).
 *
 *   node scripts/verify-leave-carryover.js
 *
 * Covers the policy cap (uncapped / capped / none), the expiry date landing on the last day of
 * the Nth month in any year (leap Februaries included), the rule that a carry-over can only come
 * out of a year that has actually closed, the 3-month warning escalation, and the last-minute
 * automatic booking that saves an unused pot.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

/** Transpile a src/lib module, resolving its local imports (and letting date-fns through). */
const loadTs = (file, deps = {}) => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = { exports: {} };
  const localRequire = id => (deps[id] !== undefined ? deps[id] : require(id));
  new Function('exports', 'require', 'module', outputText)(mod.exports, localRequire, mod);
  return mod.exports;
};

const D = loadTs('leave-days.ts');
const C = loadTs('leave-carryover.ts', { './leave-days': D });

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};

const uncapped = C.DEFAULT_CARRYOVER_POLICY;
const policy = (maxCarryoverDays, expiryMonths = null) => ({ maxCarryoverDays, expiryMonths });

// --- what is left of a year -------------------------------------------------
check('remaining = grant + carried in − used', C.remainingOfYear({ entitlement: 22, carriedIn: 3, used: 10 }), 15);
check('overspent year goes negative', C.remainingOfYear({ entitlement: 22, carriedIn: 0, used: 25 }), -3);
check('half days survive', C.remainingOfYear({ entitlement: 22.5, carriedIn: 0.5, used: 10 }), 13);
check('garbage input → 0', C.remainingOfYear({ entitlement: NaN, carriedIn: 0, used: 0 }), 0);

// --- the cap ----------------------------------------------------------------
check('uncapped carries everything left', C.carryoverDays(15, uncapped), 15);
check('cap limits the carried days', C.carryoverDays(15, policy(5)), 5);
check('cap above the remainder changes nothing', C.carryoverDays(3, policy(5)), 3);
check('cap 0 forfeits everything', C.carryoverDays(15, policy(0)), 0);
check('cap 0 on leftovers → 0', C.carryoverDays(0.5, policy(0)), 0);
check('a fully used year carries nothing', C.carryoverDays(0, uncapped), 0);
check('an overspent year carries nothing (never a deficit)', C.carryoverDays(-3, uncapped), 0);
check('half days are capped, not rounded up', C.carryoverDays(3.5, policy(3)), 3);
check('float noise is cleaned up', C.carryoverDays(0.30000000000000004, uncapped), 0.3);

// --- expiry date ------------------------------------------------------------
check('3 months → 31 March', C.carryoverExpiryDate(2026, policy(null, 3)), '2026-03-31');
check('1 month → 31 January', C.carryoverExpiryDate(2026, policy(null, 1)), '2026-01-31');
check('12 months → 31 December', C.carryoverExpiryDate(2026, policy(null, 12)), '2026-12-31');
check('2 months → 28 Feb in a common year', C.carryoverExpiryDate(2026, policy(null, 2)), '2026-02-28');
check('2 months → 29 Feb in a leap year', C.carryoverExpiryDate(2028, policy(null, 2)), '2028-02-29');
check('no expiry configured → null', C.carryoverExpiryDate(2026, uncapped), null);
check('out-of-range months clamp into the year', [C.carryoverExpiryDate(2026, policy(null, 0)), C.carryoverExpiryDate(2026, policy(null, 99))], ['2026-01-31', '2026-12-31']);

// --- expiry check -----------------------------------------------------------
check('before the expiry date → still usable', C.carryoverExpired('2026-03-31', '2026-03-31'), false);
check('the day after → expired', C.carryoverExpired('2026-03-31', '2026-04-01'), true);
check('no expiry date → never expires', C.carryoverExpired(null, '2030-01-01'), false);
check('missing today → treated as not expired', C.carryoverExpired('2026-03-31', ''), false);

// --- "the previous year must have closed" -----------------------------------
check('carrying into 2026 uses 2025 (closed)', C.previousYearHasClosed(2026, '2026-09-30'), true);
check('carrying into the current year is allowed', C.previousYearHasClosed(2026, '2026-01-01'), true);
check('carrying into NEXT year is not (current year still running)', C.previousYearHasClosed(2027, '2026-09-30'), false);
check('two years ahead is not either', C.previousYearHasClosed(2028, '2026-09-30'), false);
check('unparseable today → refuse to carry', C.previousYearHasClosed(2026, ''), false);

// ---------------------------------------------------------------------------
// Due date: warning window
// ---------------------------------------------------------------------------
check('3 months before 31 Mar → 31 Dec', C.minusMonths('2026-03-31', 3), '2025-12-31');
check('1 month before 31 Mar clamps to 28 Feb', C.minusMonths('2026-03-31', 1), '2026-02-28');
check('1 month before 31 Mar 2028 clamps to 29 Feb', C.minusMonths('2028-03-31', 1), '2028-02-29');
check('months are subtracted across the year boundary', C.minusMonths('2026-01-15', 3), '2025-10-15');
check('same day is 0 days away', C.daysUntil('2026-03-31', '2026-03-31'), 0);
check('past dates go negative', C.daysUntil('2026-04-01', '2026-03-31'), -1);

check('no due date → never warn', C.carryoverWarningLevel(null, '2026-01-01'), 'none');
check('outside the warning window → quiet', C.carryoverWarningLevel('2026-03-31', '2025-12-01', 3), 'none');
check('window opens exactly 3 months out', C.carryoverWarningLevel('2026-03-31', '2025-12-31', 3), 'approaching');
check('inside the window → approaching', C.carryoverWarningLevel('2026-03-31', '2026-02-01', 3), 'approaching');
check('last two weeks → urgent', C.carryoverWarningLevel('2026-03-31', '2026-03-17', 3), 'urgent');
check('the day itself is still urgent, not expired', C.carryoverWarningLevel('2026-03-31', '2026-03-31', 3), 'urgent');
check('the day after → expired', C.carryoverWarningLevel('2026-03-31', '2026-04-01', 3), 'expired');
check('a 0-month window only ever warns in the last two weeks', C.carryoverWarningLevel('2026-03-31', '2026-02-01', 0), 'none');
check('a 6-month window warns earlier', C.carryoverWarningLevel('2026-03-31', '2025-10-01', 6), 'approaching');

// ---------------------------------------------------------------------------
// Booking the last business days
// ---------------------------------------------------------------------------
// Tue 31 Mar 2026 is the deadline; 1 Apr is also a working day but lies past it.
check('bookable days skip the weekend', C.bookableDays('2026-03-27', '2026-03-31', null, []), ['2026-03-27', '2026-03-30', '2026-03-31']);
check('bookable days skip holidays', C.bookableDays('2026-03-30', '2026-03-31', null, ['2026-03-30']), ['2026-03-31']);
check('bookable days respect a part-time schedule', C.bookableDays('2026-03-27', '2026-03-31', ['Mon', 'Wed', 'Fri'], []), ['2026-03-27', '2026-03-30']);

const plan = over => C.autoCarryoverBookingPlan({ remainingCarried: 3, dueOn: '2026-03-31', todayIso: '2026-03-27', ...over });
check('still room to take them voluntarily → do nothing', C.autoCarryoverBookingPlan({ remainingCarried: 2, dueOn: '2026-03-31', todayIso: '2026-03-27' }), []);
check('time has run out → book every remaining working day', plan({}), ['2026-03-27', '2026-03-30', '2026-03-31']);
check('more days left than fit → still books what fits', C.autoCarryoverBookingPlan({ remainingCarried: 9, dueOn: '2026-03-31', todayIso: '2026-03-27' }), ['2026-03-27', '2026-03-30', '2026-03-31']);
check('nothing left in the pot → do nothing', plan({ remainingCarried: 0 }), []);
check('deadline already passed → never invent leave', C.autoCarryoverBookingPlan({ remainingCarried: 5, dueOn: '2026-03-31', todayIso: '2026-04-02' }), []);
check('no due date → do nothing', C.autoCarryoverBookingPlan({ remainingCarried: 5, dueOn: null, todayIso: '2026-03-27' }), []);
check('days already booked are not re-booked', C.autoCarryoverBookingPlan({ remainingCarried: 4, dueOn: '2026-03-31', todayIso: '2026-03-30', excludedDates: ['2026-03-30', '2026-03-31'] }), []);
check('a holiday inside the window is skipped', plan({ excludedDates: ['2026-03-30'] }), ['2026-03-27', '2026-03-31']);

// Adjacent calendar days become one leave row; a gap (weekend, holiday, existing leave) splits.
check('adjacent days merge into one row', C.groupAdjacentDays(['2026-03-30', '2026-03-31']), [['2026-03-30', '2026-03-31']]);
check('a weekend gap splits the rows', C.groupAdjacentDays(['2026-03-27', '2026-03-30', '2026-03-31']), [['2026-03-27'], ['2026-03-30', '2026-03-31']]);
check('a single day is its own row', C.groupAdjacentDays(['2026-03-31']), [['2026-03-31']]);
check('nothing to book → no rows', C.groupAdjacentDays([]), []);

console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
