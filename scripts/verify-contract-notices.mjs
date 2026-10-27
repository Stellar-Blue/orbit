/**
 * Verification for the contract notice-window engine that feeds "Action Required" everywhere.
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-contract-notices.mjs
 */

import { getContractNoticeStatus, NOTICE_ALERT_WINDOW_DAYS } from '@/lib/pricing-engine';

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

/** ISO date `offset` days from today, taken at noon so a timezone can never shift the calendar day. */
const day = (offset) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

console.log('================================================================');
console.log('🚀 ORBIT CONTRACT NOTICE WINDOWS - VERIFICATION');
console.log('================================================================\n');

assert(NOTICE_ALERT_WINDOW_DAYS === 90, 'The alert horizon the KPI advertises is 90 days');

// Window opens inside the horizon (deadline 50 days out) — action required.
const upcoming = getContractNoticeStatus({ status: 'active', ends_on: day(80), notice_period_days: 30 });
assert(upcoming.isUrgent && upcoming.daysUntilNotice === 50, 'A window opening inside 90 days is action required', `deadline in ${upcoming.daysUntilNotice} days`);

// Missed deadline, contract still running — this is the regression: it used to drop out after -30 days.
const missed = getContractNoticeStatus({ status: 'active', ends_on: day(5), notice_period_days: 60 });
assert(missed.isUrgent && missed.daysUntilNotice === -55 && missed.daysUntilEnd === 5, 'A missed deadline stays action required while the contract runs', `deadline ${missed.daysUntilNotice} days ago, ends in ${missed.daysUntilEnd}`);

const dueToday = getContractNoticeStatus({ status: 'active', ends_on: day(30), notice_period_days: 30 });
assert(dueToday.isUrgent && dueToday.daysUntilNotice === 0, 'A deadline due today is action required');

// Contract already ended — nothing left to serve, even though the deadline is long past.
const ended = getContractNoticeStatus({ status: 'active', ends_on: day(-10), notice_period_days: 60 });
assert(!ended.isUrgent && ended.daysUntilEnd < 0, 'A contract that already ended is not action required', `ends in ${ended.daysUntilEnd} days`);

// Far horizon.
const far = getContractNoticeStatus({ status: 'active', ends_on: day(200), notice_period_days: 30 });
assert(!far.isUrgent, 'A window beyond the horizon is not action required', `deadline in ${far.daysUntilNotice} days`);

// Zero notice days means "notice falls on the end date", not the 30-day default.
const zeroNotice = getContractNoticeStatus({ status: 'active', ends_on: day(40), notice_period_days: 0 });
assert(
  zeroNotice.noticeDeadlineStr === day(40) && zeroNotice.daysUntilNotice === 40,
  'A zero-day notice window falls on the end date',
  zeroNotice.noticeDeadlineStr
);

// Terminated / expired contracts never raise the alert.
assert(
  !getContractNoticeStatus({ status: 'terminated', ends_on: day(10), notice_period_days: 60 }).isUrgent &&
    !getContractNoticeStatus({ status: 'expired', ends_on: day(10), notice_period_days: 60 }).isUrgent,
  'Only live contract statuses raise the alert'
);

// Open-ended contract with a stored deadline only.
const openEnded = getContractNoticeStatus({ status: 'active', ends_on: undefined, notice_deadline: day(20) });
assert(openEnded.isUrgent && openEnded.daysUntilNotice === 20, 'An open-ended contract falls back to its stored notice deadline');
assert(
  !getContractNoticeStatus({ status: 'active', ends_on: undefined, notice_deadline: undefined }).isUrgent,
  'Contracts without any notice data never raise the alert'
);

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
