/**
 * Verification for the Excel-style contract revenue schedule.
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-revenue-schedule.mjs
 *
 * Exercises the real helper the "Revenue Schedule & MRR" grid renders from.
 */

import {
  addMonths,
  buildRevenueSchedule,
  contractChargeMonths,
  contractEffectiveWindow,
  groupMonthsByYear,
  monthKeysBetween,
  toMonthKey,
  yearTotalOf,
} from '@/lib/revenue-schedule';

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

const contract = (overrides = {}) => ({
  id: 'cnt-1',
  counterparty_id: 'cp-1',
  direction: 'revenue',
  reference: 'SB-ATLAS-2025-01',
  type: 'saas_subscription',
  status: 'active',
  starts_on: '2025-01-01',
  ends_on: '2025-12-31',
  auto_renews: false,
  notice_period_days: 60,
  currency: 'EUR',
  billing_cadence: 'monthly',
  vat_treatment: 'domestic_24',
  counterparty: { id: 'cp-1', legal_name: 'DEPA Commercial S.A.' },
  lines: [],
  groups: [],
  schedule: [],
  ...overrides,
});

console.log('================================================================');
console.log('🚀 ORBIT CONTRACT REVENUE SCHEDULE - VERIFICATION');
console.log('================================================================\n');

// --- Month arithmetic ---------------------------------------------------------
assert(toMonthKey('2025-03-18') === '2025-03', 'Dates normalise to month keys');
assert(toMonthKey('2025-03') === '2025-03', 'Month keys stay month keys');
assert(toMonthKey('not-a-date') === null, 'Invalid dates are rejected');
assert(addMonths('2025-12', 1) === '2026-01', 'Month arithmetic crosses year boundaries');
assert(
  monthKeysBetween('2025-11', '2026-02').join(',') === '2025-11,2025-12,2026-01,2026-02',
  'Inclusive month ranges span years'
);

// --- Effective window --------------------------------------------------------
const window = contractEffectiveWindow(contract());
assert(
  window.startKey === '2025-01' && window.endKey === '2025-12',
  'Effective window uses service start through ends_on',
  `${window.startKey} → ${window.endKey}`
);
assert(
  contractEffectiveWindow(contract({ ends_on: undefined, term_years: 2, service_start_date: '2025-04-01' })).endKey === '2027-03',
  'Missing ends_on falls back to the term length'
);

// --- Monthly line schedule ---------------------------------------------------
const monthlyLine = {
  id: 'l1', contract_id: 'cnt-1', name: 'Atlas ETRM licence',
  unit_price: 1000, quantity: 1, unit_label: 'flat', frequency: 'monthly',
};
const charges = contractChargeMonths(contract({ lines: [monthlyLine] }));
assert(charges['2025-01'] === 1000, 'Monthly line charges every month', String(charges['2025-01']));
assert(Object.keys(charges).length === 12, 'Monthly line spans the 12-month term', Object.keys(charges).length);
assert(yearTotalOf(charges, 2025) === 12000, 'Year total sums the row', yearTotalOf(charges, 2025));

const discounted = contractChargeMonths(contract({ lines: [monthlyLine], discount_pct: 10 }));
assert(discounted['2025-06'] === 900, 'Contract discount applies', String(discounted['2025-06']));

// --- Stored schedule wins ----------------------------------------------------
const stored = contract({
  lines: [monthlyLine],
  schedule: [
    { id: 's1', contract_id: 'cnt-1', period: '2025-02', amount: 2500 },
    { id: 's2', contract_id: 'cnt-1', period: '2025-03', amount: 500 },
  ],
});
const storedCharges = contractChargeMonths(stored);
assert(
  storedCharges['2025-02'] === 2500 && Object.keys(storedCharges).length === 2,
  'A persisted contract_schedule is used instead of recomputing',
  JSON.stringify(storedCharges)
);

// --- Legacy fallback ---------------------------------------------------------
const legacy = contractChargeMonths(contract({ lines: [], value: 180000, billing_cadence: 'annual' }));
assert(legacy['2025-01'] === 15000 && yearTotalOf(legacy, 2025) === 180000,
  'Legacy annual value spreads to monthly MRR', `${legacy['2025-01']}/month`);

const oneOff = contractChargeMonths(contract({ lines: [], value: 50000, billing_cadence: 'one_off' }));
assert(
  oneOff['2025-01'] === 50000 && Object.keys(oneOff).length === 1,
  'One-off value lands in the first effective month'
);

// --- Projects as change requests --------------------------------------------
const projects = [
  {
    id: 'prj-1', contract_id: 'cnt-1', name: 'Intraday CR', status: 'in_progress',
    default_billable: true, budget_value: 12000, starts_on: '2025-03-01', ends_on: '2025-08-31',
  },
  {
    id: 'prj-2', contract_id: 'cnt-1', name: 'Archived CR', status: 'archived',
    default_billable: true, budget_value: 9999, starts_on: '2025-01-01', ends_on: '2025-12-31',
  },
  {
    id: 'prj-3', contract_id: 'cnt-2', name: 'Other contract', status: 'planned',
    default_billable: true, budget_value: 5000, starts_on: '2025-01-01', ends_on: '2025-12-31',
  },
];

const full = buildRevenueSchedule([contract({ lines: [monthlyLine] })], projects);
assert(full.rows.length === 2, 'A contract with one change request produces two rows', String(full.rows.length));
assert(full.rows[0].kind === 'contract' && full.rows[1].kind === 'project', 'Contract charges come before the change request rows');

const projectRow = full.rows[1];
assert(projectRow.project?.id === 'prj-1', 'Archived projects are excluded');
assert(projectRow.months['2025-03'] === 2000, 'Project value spreads evenly across its window', String(projectRow.months['2025-03']));
assert(yearTotalOf(projectRow.months, 2025) === 12000, 'Project row totals the project budget value', yearTotalOf(projectRow.months, 2025));

// A contract with no projects must not produce a change-request line at all.
const noProjects = buildRevenueSchedule([contract({ lines: [monthlyLine] })], []);
assert(noProjects.rows.length === 1, 'No projects → only the contract charges row', String(noProjects.rows.length));
assert(noProjects.rows[0].kind === 'contract', 'The lone row is the contract charges row');

// Each project is its own line: six CRs → one contract row plus six project rows.
const sixProjects = Array.from({ length: 6 }, (_, index) => ({
  id: `prj-${index + 1}`, contract_id: 'cnt-1', name: `CR ${index + 1}`, status: 'in_progress',
  default_billable: true, budget_value: 6000, starts_on: '2025-01-01', ends_on: '2025-06-30',
}));
const sixRows = buildRevenueSchedule([contract({ lines: [monthlyLine] })], sixProjects);
assert(sixRows.rows.length === 7, 'Six change requests produce six project lines', String(sixRows.rows.length));
assert(sixRows.rows.filter(r => r.kind === 'project').length === 6, 'Every project is a separate row');
assert(new Set(sixRows.rows.filter(r => r.kind === 'project').map(r => r.project?.id)).size === 6,
  'Each project row carries a distinct project');
assert(sixRows.rows.filter(r => r.kind === 'project').every(r => yearTotalOf(r.months, 2025) === 6000),
  'Each change-request row carries only its own budget value');

const unbudgeted = buildRevenueSchedule(
  [contract({ lines: [monthlyLine] })],
  [{ id: 'prj-z', contract_id: 'cnt-1', name: 'No budget CR', status: 'planned', default_billable: true, budget_value: null, starts_on: '2025-01-01', ends_on: '2025-12-31' }]
);
assert(unbudgeted.rows.length === 2 && unbudgeted.rows[1].kind === 'project',
  'A project without a budget value still gets a change-request line');
assert(Object.keys(unbudgeted.rows[1].months).length === 0, 'An unbudgeted project has no monthly amount');

const remainder = buildRevenueSchedule(
  [contract({ lines: [monthlyLine] })],
  [{ id: 'prj-r', contract_id: 'cnt-1', name: 'Odd value', status: 'done', default_billable: true, budget_value: 1000, starts_on: '2025-01-01', ends_on: '2025-03-31' }]
);
assert(
  yearTotalOf(remainder.rows[1].months, 2025) === 1000,
  'Rounding remainder is absorbed by the last project month',
  JSON.stringify(remainder.rows[1].months)
);

// --- Horizon & grouping ------------------------------------------------------
const twoContracts = buildRevenueSchedule(
  [
    contract({ id: 'a', reference: 'A', starts_on: '2024-05-01', ends_on: '2025-02-28' }),
    contract({ id: 'b', reference: 'B', starts_on: '2025-10-01', ends_on: '2026-03-31' }),
  ],
  []
);
assert(
  twoContracts.months[0] === '2024-05' && twoContracts.months[twoContracts.months.length - 1] === '2026-03',
  'Grid extends from the first effective month to the last effective date',
  `${twoContracts.startKey} → ${twoContracts.endKey}`
);
assert(twoContracts.rows.length === 2, 'Contracts without projects produce one row each');

const grouped = groupMonthsByYear(twoContracts.months);
assert(grouped.length === 3 && grouped[0].year === 2024 && grouped[2].months.length === 3,
  'Months group under their year headers',
  grouped.map(g => `${g.year}:${g.months.length}`).join(' '));

const totals = full.monthTotals;
assert(totals['2025-01'] === 1000, 'Month totals combine both streams', String(totals['2025-01']));
assert(totals['2025-03'] === 3000, 'Month totals add project revenue to contract charges', String(totals['2025-03']));

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
