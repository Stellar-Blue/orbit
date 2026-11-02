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
  contractChargeMonthsByTiming,
  contractEffectiveWindow,
  groupMonthsByYear,
  monthKeysBetween,
  resampleTimingToBillingMonths,
  resampleToBillingMonths,
  toMonthKey,
  yearTotalOf,
  explainScheduleCell,
} from '@/lib/revenue-schedule';
import {
  buildInvoiceCoverage,
  buildProjectInvoiceCoverage,
  coverageTotal,
  projectInvoiceCellKey,
  receiptCoveredMonths,
  INVOICE_BOX_COLORS,
  invoiceAmountEur,
  invoiceCellStyle,
  invoiceCoveredMonths,
  invoiceMarkerColor,
  invoiceMarkerPosition,
  invoiceVarianceTone,
} from '@/lib/invoice-coverage';
import { buildInvoiceSuggestions, suggestionMonths } from '@/lib/invoice-suggestions';
import {
  contractEndCustomerName,
  isSubcontract,
  netAfterPrimeFee,
  primeFeeAmount,
  primeFeeLabel,
  supplyRoleOf,
} from '@/lib/subcontracts';
import { scheduleExportTable } from '@/lib/revenue-schedule';
import { buildDraftInvoicePayload, vatPercentFromRate, vatRateForTreatment } from '@/lib/billing-periods';
import { accountingInvoices, netInvoices } from '@/lib/invoice-netting';
import {
  buildInvoiceLinks,
  invoiceContractIds,
  invoiceLinkedContractIds,
  invoiceLinksContract,
  invoiceProjectIds,
} from '@/lib/invoice-links';

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
// A stale projection must never win over the current price sheet: removing a line or moving the
// term has to be reflected in every month, including ones already in the past.
const stale = contract({
  lines: [monthlyLine],
  schedule: [
    { id: 's1', contract_id: 'cnt-1', period: '2025-02', amount: 2500 },
    { id: 's2', contract_id: 'cnt-1', period: '2026-06', amount: 2500 },
  ],
});
const staleCharges = contractChargeMonths(stale);
assert(
  staleCharges['2025-02'] === 1000 && !('2026-06' in staleCharges) && Object.keys(staleCharges).length === 12,
  'Current lines win over a stale persisted schedule',
  JSON.stringify(staleCharges).slice(0, 80)
);

// Same contract, shorter term: months outside the new window drop out entirely.
const shortened = contractChargeMonths(contract({ lines: [monthlyLine], ends_on: '2025-06-30' }));
assert(
  Object.keys(shortened).length === 6 && shortened['2025-06'] === 1000 && !('2025-07' in shortened),
  'Moving the end date removes the months beyond it',
  Object.keys(shortened).join(',')
);

// Moved start date: the schedule begins where the service begins.
const movedStart = contractChargeMonths(contract({ lines: [monthlyLine], service_start_date: '2025-04-01' }));
assert(
  movedStart['2025-04'] === 1000 && !('2025-03' in movedStart) && Object.keys(movedStart).length === 9,
  'Moving the start date removes the months before it',
  Object.keys(movedStart).join(',')
);

// A price sheet with every line removed bills nothing, even if the old projection had rows.
const emptied = contractChargeMonths(contract({ lines: [], value: 0, schedule: [] }));
assert(Object.keys(emptied).length === 0, 'Removing every line clears the charges');

// Line-less legacy agreements keep their saved projection — it is the only record of the deal.
const legacySchedule = contractChargeMonths(contract({
  lines: [],
  value: 0,
  schedule: [{ id: 's3', contract_id: 'cnt-1', period: '2025-02', amount: 2500 }],
}));
assert(
  legacySchedule['2025-02'] === 2500 && Object.keys(legacySchedule).length === 1,
  'A line-less contract still reads its persisted schedule',
  JSON.stringify(legacySchedule)
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
assert(full.rows[0].kind === 'contract' && full.rows[1].kind === 'project', 'Contract charges come before the change-request row');

const projectRow = full.rows[1];
assert(projectRow.projects?.map(p => p.id).join(',') === 'prj-1', 'Archived projects are excluded', JSON.stringify(projectRow.projects?.map(p => p.id)));
assert(projectRow.months['2025-03'] === 2000, 'Project value spreads evenly across its window', String(projectRow.months['2025-03']));
assert(yearTotalOf(projectRow.months, 2025) === 12000, 'Project row totals the project budget value', yearTotalOf(projectRow.months, 2025));

// Every cell says which project its money belongs to.
const marchShares = projectRow.projectMonths?.['2025-03'] ?? [];
assert(
  marchShares.length === 1 && marchShares[0].project.id === 'prj-1' && marchShares[0].amount === 2000,
  'A month with a single change request names that project',
  JSON.stringify(marchShares)
);
assert(!('2025-02' in projectRow.projectMonths), 'Months before the project starts carry no project share');

// Projects of the same contract share one row; the month shares keep them apart.
const overlapping = buildRevenueSchedule([contract({ lines: [monthlyLine] })], [
  { id: 'p-a', contract_id: 'cnt-1', name: 'Rollout', code: 'CR-A', status: 'active', budget_value: 6000, starts_on: '2025-01-01', ends_on: '2025-06-30' },
  { id: 'p-b', contract_id: 'cnt-1', name: 'Extras', code: 'CR-B', status: 'active', budget_value: 3000, starts_on: '2025-04-01', ends_on: '2025-06-30' },
]);
assert(overlapping.rows.length === 2, 'Two projects still take one change-request row', String(overlapping.rows.length));
const overlapRow = overlapping.rows[1];
assert(overlapRow.projects.map(project => project.code).join(',') === 'CR-A,CR-B', 'The row lists its projects in start-date order');
assert(
  overlapRow.months['2025-01'] === 1000 && overlapRow.months['2025-04'] === 2000,
  'A month shared by two projects sums both',
  JSON.stringify(overlapRow.months)
);
const aprilShares = overlapRow.projectMonths['2025-04'];
assert(
  aprilShares.length === 2 && aprilShares[0].project.id === 'p-a' && aprilShares[0].amount === 1000 &&
    aprilShares[1].project.id === 'p-b' && aprilShares[1].amount === 1000,
  'A shared month names every project and its amount',
  JSON.stringify(aprilShares)
);
assert(
  Object.entries(overlapRow.months).every(([month, total]) =>
    Math.abs((overlapRow.projectMonths[month] || []).reduce((sum, share) => sum + share.amount, 0) - total) < 0.005
  ),
  'The month shares always add up to the cell amount',
  JSON.stringify(overlapRow.projectMonths)
);
assert(yearTotalOf(overlapRow.months, 2025) === 9000, 'One row still carries every project value', yearTotalOf(overlapRow.months, 2025));

// A contract with no projects must not produce a change-request line at all.
const noProjects = buildRevenueSchedule([contract({ lines: [monthlyLine] })], []);
assert(noProjects.rows.length === 1, 'No projects → only the contract charges row', String(noProjects.rows.length));
assert(noProjects.rows[0].kind === 'contract', 'The lone row is the contract charges row');

// Many projects still take a single row.
const sixProjects = Array.from({ length: 6 }, (_, index) => ({
  id: `prj-${index + 1}`, contract_id: 'cnt-1', name: `CR ${index + 1}`, status: 'in_progress',
  default_billable: true, budget_value: 6000, starts_on: '2025-01-01', ends_on: '2025-06-30',
}));
const sixRows = buildRevenueSchedule([contract({ lines: [monthlyLine] })], sixProjects);
assert(sixRows.rows.length === 2, 'Six change requests produce one contract row and one change-request row', String(sixRows.rows.length));
assert(sixRows.rows[1].projects.length === 6, 'The change-request row carries all six projects');
assert(yearTotalOf(sixRows.rows[1].months, 2025) === 36000, 'The single row sums every change-request budget', yearTotalOf(sixRows.rows[1].months, 2025));
assert(sixRows.rows[1].projectMonths['2025-01'].length === 6, 'Each month names all six projects');

const unbudgeted = buildRevenueSchedule(
  [contract({ lines: [monthlyLine] })],
  [{ id: 'prj-z', contract_id: 'cnt-1', name: 'No budget CR', status: 'planned', default_billable: true, budget_value: null, starts_on: '2025-01-01', ends_on: '2025-12-31' }]
);
assert(
  unbudgeted.rows.length === 2 && unbudgeted.rows[1].kind === 'project' && unbudgeted.rows[1].projects.length === 1,
  'A project without a budget value still gets a change-request line',
  JSON.stringify(unbudgeted.rows.length)
);
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



// --- Cashflow basis ----------------------------------------------------------
const monthlyCharges = contractChargeMonths(contract({ lines: [monthlyLine] }));
const quarterlyAdvance = resampleToBillingMonths(
  contract({ lines: [monthlyLine], billing_cadence: 'quarterly', invoice_timing: 'start_of_period' }),
  monthlyCharges
);
assert(
  Object.keys(quarterlyAdvance).join(',') === '2025-01,2025-04,2025-07,2025-10' && quarterlyAdvance['2025-01'] === 3000,
  'A quarterly contract bills one value per quarter, at the period start',
  JSON.stringify(quarterlyAdvance)
);

const quarterlyArrears = resampleToBillingMonths(
  contract({ lines: [monthlyLine], billing_cadence: 'quarterly', invoice_timing: 'end_of_period' }),
  monthlyCharges
);
assert(
  Object.keys(quarterlyArrears).join(',') === '2025-03,2025-06,2025-09,2025-12' && quarterlyArrears['2025-12'] === 3000,
  'Billed in arrears, the same quarter lands on the period end',
  JSON.stringify(quarterlyArrears)
);

const annualAdvance = resampleToBillingMonths(
  contract({ lines: [monthlyLine], billing_cadence: 'annual', invoice_timing: 'start_of_period' }),
  monthlyCharges
);
assert(
  Object.keys(annualAdvance).join(',') === '2025-01' && annualAdvance['2025-01'] === 12000,
  'An annual contract bills the full year once',
  JSON.stringify(annualAdvance)
);

const monthlyBasis = resampleToBillingMonths(contract({ lines: [monthlyLine] }), monthlyCharges);
assert(
  Object.keys(monthlyBasis).length === 12 && monthlyBasis['2025-05'] === 1000,
  'A monthly contract looks identical in both views',
  Object.keys(monthlyBasis).length
);

const oneOffBasis = resampleToBillingMonths(
  contract({ billing_cadence: 'one_off' }),
  { '2025-03': 5000 }
);
assert(
  oneOffBasis['2025-03'] === 5000 && Object.keys(oneOffBasis).length === 1,
  'A one-off settlement stays in the month it lands',
  JSON.stringify(oneOffBasis)
);

// The whole grid honours the basis, project rows included.
const cashflowProjects = [{ id: 'p-cash', contract_id: 'cnt-1', name: 'Rollout', code: 'CR-9', status: 'active', starts_on: '2025-01-01', ends_on: '2025-12-31', budget_value: 12000 }];
const cashGrid = buildRevenueSchedule(
  [contract({ lines: [monthlyLine], billing_cadence: 'quarterly', invoice_timing: 'start_of_period' })],
  cashflowProjects,
  [],
  [],
  { basis: 'cashflow' }
);
const cashContractRow = cashGrid.rows.find(row => row.kind === 'contract');
const cashProjectRow = cashGrid.rows.find(row => row.kind === 'project');
assert(
  cashContractRow && Object.keys(cashContractRow.months).join(',') === '2025-01,2025-04,2025-07,2025-10',
  'The cashflow grid bills the contract per quarter',
  cashContractRow ? Object.keys(cashContractRow.months).join(',') : 'missing'
);
assert(
  cashProjectRow && Object.keys(cashProjectRow.months).join(',') === '2025-01,2025-04,2025-07,2025-10' &&
    yearTotalOf(cashProjectRow.months, 2025) === 12000,
  'Change-request rows follow the same billing cycles without changing their total',
  cashProjectRow ? JSON.stringify(cashProjectRow.months) : 'missing'
);
assert(
  cashProjectRow && Object.keys(cashProjectRow.projectMonths).join(',') === Object.keys(cashProjectRow.months).join(','),
  'Cashflow cells keep their project attribution',
  cashProjectRow ? JSON.stringify(cashProjectRow.projectMonths) : 'missing'
);
assert(
  cashGrid.monthTotals['2025-01'] === 6000 && cashGrid.monthTotals['2025-02'] === undefined,
  'Portfolio totals only count billed months in the cashflow view',
  JSON.stringify(cashGrid.monthTotals)
);

// --- Cashflow with mixed per-line invoicing timing ---------------------------
// A one-off invoiced at activation (in advance) plus a monthly fee billed with the
// contract's quarterly arrears cadence: the two must not merge into one quarter-end value.
const oneOffLine = {
  id: 'l-oneoff', contract_id: 'cnt-1', name: 'Onboarding', unit_price: 9000, quantity: 1,
  unit_label: 'project', frequency: 'one_time', invoice_timing: 'start_of_period',
};
const monthlyFeeLine = {
  id: 'l-fee', contract_id: 'cnt-1', name: 'Platform licence', unit_price: 1000, quantity: 1,
  unit_label: 'flat', frequency: 'monthly',
};
const mixedContract = contract({
  lines: [oneOffLine, monthlyFeeLine],
  billing_cadence: 'quarterly',
  invoice_timing: 'end_of_period',
});
const mixedSplit = contractChargeMonthsByTiming(mixedContract);
assert(
  mixedSplit && mixedSplit['2025-01'].advance === 9000 && mixedSplit['2025-01'].arrears === 1000,
  'The charge schedule splits each month by the line own invoicing timing',
  JSON.stringify(mixedSplit ? { jan: mixedSplit['2025-01'], feb: mixedSplit['2025-02'] } : null)
);
const mixedCash = resampleTimingToBillingMonths(mixedContract, mixedSplit);
assert(
  JSON.stringify(mixedCash) === JSON.stringify({ '2025-01': 9000, '2025-03': 3000, '2025-06': 3000, '2025-09': 3000, '2025-12': 3000 }),
  'Cashflow keeps the advance one-off at activation and the quarterly arrears fee at each quarter end',
  JSON.stringify(mixedCash)
);
assert(
  yearTotalOf(mixedCash, 2025) === yearTotalOf(contractChargeMonths(mixedContract), 2025),
  'The cashflow view never changes the year total',
  `${yearTotalOf(mixedCash, 2025)} vs ${yearTotalOf(contractChargeMonths(mixedContract), 2025)}`
);
const mixedGrid = buildRevenueSchedule([mixedContract], [], [], [], { basis: 'cashflow' });
const mixedGridRow = mixedGrid.rows.find(row => row.kind === 'contract');
assert(
  mixedGridRow && mixedGridRow.months['2025-01'] === 9000 && mixedGridRow.months['2025-03'] === 3000,
  'The cashflow grid shows the one-off and the quarterly fee in separate months',
  mixedGridRow ? JSON.stringify(mixedGridRow.months) : 'missing'
);

// --- Recognition of periodic charges billed in arrears -----------------------
// An annual / quarterly charge billed in arrears is invoiced at the end of its own cycle, so the
// revenue view must land it on that last service month instead of the cycle's opening month.
const annualArrearsLine = {
  id: 'l-annual', contract_id: 'cnt-1', name: 'Support retainer', unit_price: 12000, quantity: 1,
  unit_label: 'flat', frequency: 'annual', invoice_timing: 'end_of_period',
};
const annualContract = contract({
  lines: [annualArrearsLine],
  billing_cadence: 'annual',
  invoice_timing: 'end_of_period',
  starts_on: '2026-01-01',
  ends_on: '2027-12-31',
});
const annualRecognition = contractChargeMonths(annualContract);
assert(
  JSON.stringify(annualRecognition) === JSON.stringify({ '2026-12': 12000, '2027-12': 12000 }),
  'An annual charge billed in arrears is recognised at the end of its cycle',
  JSON.stringify(annualRecognition)
);
const annualRecognitionGrid = buildRevenueSchedule([annualContract], []);
assert(
  annualRecognitionGrid.rows[0].months['2026-12'] === 12000 && annualRecognitionGrid.rows[0].months['2026-01'] === undefined,
  'The revenue view shows the annual arrears charge in December',
  JSON.stringify(annualRecognitionGrid.rows[0].months)
);
const annualCashGrid = buildRevenueSchedule([annualContract], [], [], [], { basis: 'cashflow' });
assert(
  JSON.stringify(annualCashGrid.rows[0].months) === JSON.stringify(annualRecognition),
  'Cashflow and revenue agree on an annual cycle billed in arrears',
  JSON.stringify(annualCashGrid.rows[0].months)
);

// Paying up front keeps the charge at the start of the cycle.
const annualAdvanceRecognition = contractChargeMonths(contract({
  lines: [{ ...annualArrearsLine, invoice_timing: 'start_of_period' }],
  billing_cadence: 'annual',
  invoice_timing: 'start_of_period',
  starts_on: '2026-01-01',
  ends_on: '2027-12-31',
}));
assert(
  JSON.stringify(annualAdvanceRecognition) === JSON.stringify({ '2026-01': 12000, '2027-01': 12000 }),
  'An annual charge billed in advance stays at the start of its cycle',
  JSON.stringify(annualAdvanceRecognition)
);

// Quarterly in arrears behaves the same way, one quarter at a time.
const quarterlyArrearsRecognition = contractChargeMonths(contract({
  lines: [{ ...monthlyFeeLine, frequency: 'quarterly', unit_price: 3000, invoice_timing: 'end_of_period' }],
  billing_cadence: 'quarterly',
  invoice_timing: 'end_of_period',
}));
assert(
  Object.keys(quarterlyArrearsRecognition).join(',') === '2025-03,2025-06,2025-09,2025-12' &&
    yearTotalOf(quarterlyArrearsRecognition, 2025) === 12000,
  'A quarterly arrears fee is recognised in the quarter last month',
  JSON.stringify(quarterlyArrearsRecognition)
);

// A line that ends mid-cycle settles in its own last service month.
const shortAnnual = contractChargeMonths(contract({
  lines: [{ ...annualArrearsLine, starts_on: '2025-03-01', ends_on: '2025-12-31' }],
  billing_cadence: 'annual',
  invoice_timing: 'end_of_period',
}));
assert(
  JSON.stringify(shortAnnual) === JSON.stringify({ '2025-12': 12000 }),
  'An annual charge on a partial year settles in the line last month',
  JSON.stringify(shortAnnual)
);

// A line starting after the contract anchor keeps its own annual rhythm.
const lateAnnual = contractChargeMonths(contract({
  lines: [{ ...annualArrearsLine, starts_on: '2025-07-01' }],
  billing_cadence: 'annual',
  invoice_timing: 'end_of_period',
  ends_on: '2026-06-30',
}));
assert(
  JSON.stringify(lateAnnual) === JSON.stringify({ '2026-06': 12000 }),
  'A mid-term annual line is recognised twelve months after it starts',
  JSON.stringify(lateAnnual)
);

// The move is placement only: every month still adds up to the contract value.
const movedTotals = contractChargeMonths(contract({
  lines: [monthlyFeeLine, annualArrearsLine],
  billing_cadence: 'monthly',
  invoice_timing: 'start_of_period',
}));
assert(
  yearTotalOf(movedTotals, 2025) === 12000 + 12000,
  'Recognising arrears at cycle end keeps the year total',
  String(yearTotalOf(movedTotals, 2025))
);

// --- Invoice overlay ---------------------------------------------------------
const invoice = (overrides = {}) => ({
  id: 'inv-1',
  direction: 'outgoing',
  counterparty_id: 'cp-1',
  contract_id: null,
  type: 'invoice',
  invoice_number: 'INV-001',
  issue_date: '2025-02-15',
  due_date: '2025-03-15',
  period_from: '2025-01-01',
  period_to: '2025-03-31',
  currency: 'EUR',
  fx_rate: 1,
  net: 3000,
  vat_amount: 720,
  vat_rate: '24',
  gross: 3720,
  gross_eur: 3720,
  status: 'sent_received',
  ...overrides,
});

const baseContract = contract({ lines: [monthlyLine] });
assert(
  invoiceCoveredMonths(invoice()).join(',') === '2025-01,2025-02,2025-03',
  'Invoice coverage spans period_from → period_to'
);
assert(
  invoiceCoveredMonths(invoice({ period_from: null, period_to: null, issue_date: '2025-06-04' })).join(',') === '2025-06',
  'Invoices without a billed period fall back to the issue month'
);
assert(
  invoiceMarkerPosition('2025-01', '2025-01', '2025-03') === 'start' &&
    invoiceMarkerPosition('2025-02', '2025-01', '2025-03') === 'middle' &&
    invoiceMarkerPosition('2025-03', '2025-01', '2025-03') === 'end',
  'Asterisk position follows the issue month inside the box'
);

const unpaidCoverage = buildInvoiceCoverage([invoice()], [baseContract]);
const january = unpaidCoverage.get('cnt-1:2025-01');
assert(
  unpaidCoverage.size === 3 && january?.firstMonth === '2025-01' && january.lastMonth === '2025-03',
  'An outgoing invoice overlays every month it bills on the contract charges row',
  `${unpaidCoverage.size} cells`
);
assert(
  january?.paid === false && january.markerMonth === '2025-02' && january.markerPosition === 'middle',
  'Unpaid invoices keep the light tint and mark the issue month',
  JSON.stringify(january)
);

assert(
  january?.invoiceTotal === 3000 && january.contractTotal === 3000 &&
    january.variance === 0 && invoiceVarianceTone(january) === 'match',
  'The box compares the invoice net against the contract charges for the same months',
  `invoice ${january?.invoiceTotal} · contract ${january?.contractTotal}`
);

// --- Draft invoices in the schedule -----------------------------------------
const draftOnly = buildInvoiceCoverage([invoice({ status: 'draft', invoice_number: 'DRAFT-1' })], [baseContract]);
const draftCell = draftOnly.get('cnt-1:2025-01');
assert(
  draftOnly.size === 3 && draftCell?.draft === true && draftCell.paid === false,
  'A draft invoice already reserves its months on the schedule',
  `${draftOnly.size} cells · draft ${draftCell?.draft}`
);
assert(
  draftCell?.invoiceTotal === 3000 && invoiceVarianceTone(draftCell) === 'match',
  'A draft is compared against the contract like any other invoice',
  `invoice ${draftCell?.invoiceTotal}`
);
// Unpaid boxes are magenta, paid boxes green — the two states must never look alike.
const unpaidStyle = invoiceCellStyle(january, '2025-01');
assert(
  unpaidStyle.backgroundColor === INVOICE_BOX_COLORS.issued.fill &&
    unpaidStyle.boxShadow.includes(INVOICE_BOX_COLORS.issued.line),
  'An invoiced-but-unpaid box uses the issued palette',
  unpaidStyle.backgroundColor
);
assert(
  INVOICE_BOX_COLORS.issued.fill !== INVOICE_BOX_COLORS.paid.fill &&
    INVOICE_BOX_COLORS.issued.line !== INVOICE_BOX_COLORS.paid.line,
  'The unpaid palette is distinct from the paid one'
);
assert(
  invoiceMarkerColor(january) === INVOICE_BOX_COLORS.issued.marker &&
    invoiceMarkerColor(january) !== invoiceMarkerColor({ ...january, paid: true }) &&
    invoiceMarkerColor({ ...january, draft: true }) === INVOICE_BOX_COLORS.draft.marker,
  'The issue-month marker follows the box state'
);

const draftStyle = invoiceCellStyle(draftCell, '2025-01');
assert(
  draftStyle.backgroundColor === INVOICE_BOX_COLORS.draft.fill &&
    draftStyle.boxShadow.includes(INVOICE_BOX_COLORS.draft.line) &&
    draftStyle.boxShadow !== invoiceCellStyle(january, '2025-01').boxShadow,
  'The draft box is painted in its own tone, not the issued or paid green',
  draftStyle.backgroundColor
);

const mixedDraft = buildInvoiceCoverage(
  [invoice({ status: 'draft', id: 'inv-draft' }), invoice({ id: 'inv-issued' })],
  [baseContract]
).get('cnt-1:2025-01');
assert(
  mixedDraft?.draft === false && mixedDraft.paid === false,
  'Once a real invoice exists the box is no longer a draft',
  JSON.stringify({ draft: mixedDraft?.draft, paid: mixedDraft?.paid })
);
const paidPlusDraft = buildInvoiceCoverage(
  [invoice({ status: 'draft', id: 'inv-draft' }), invoice({ id: 'inv-paid', status: 'paid' })],
  [baseContract]
).get('cnt-1:2025-01');
assert(
  paidPlusDraft?.draft === false && paidPlusDraft.paid === false,
  'A paid invoice next to a draft is not shown as fully paid'
);

assert(
  buildInvoiceCoverage([invoice({ status: 'cancelled' })], [baseContract]).size === 0,
  'Cancelled drafts and invoices still paint nothing'
);
assert(
  buildInvoiceCoverage([invoice({ status: 'draft', type: 'credit_note' })], [baseContract]).size === 0,
  'A draft credit note never paints a box'
);

const shortfall = buildInvoiceCoverage([invoice({ net: 2500 })], [baseContract]).get('cnt-1:2025-01');
assert(
  shortfall?.variance === -500 && invoiceVarianceTone(shortfall) === 'under',
  'An invoice below the schedule reports a negative variance',
  String(shortfall?.variance)
);

const overBilled = buildInvoiceCoverage([invoice({ net: 3500 })], [baseContract]).get('cnt-1:2025-01');
assert(
  overBilled?.variance === 500 && invoiceVarianceTone(overBilled) === 'over',
  'An invoice above the schedule reports a positive variance',
  String(overBilled?.variance)
);

assert(
  invoiceAmountEur(invoice({ currency: 'USD', fx_rate: 0.9, net: 1000 })) === 900,
  'Foreign-currency invoices convert to EUR before the comparison',
  String(invoiceAmountEur(invoice({ currency: 'USD', fx_rate: 0.9, net: 1000 })))
);

const paidCoverage = buildInvoiceCoverage([invoice({ status: 'paid' })], [baseContract]);
const paidStyle = invoiceCellStyle(paidCoverage.get('cnt-1:2025-02'), '2025-02');
assert(
  paidCoverage.get('cnt-1:2025-02')?.paid === true &&
    paidStyle.backgroundColor === INVOICE_BOX_COLORS.paid.fill &&
    invoiceCellStyle(january, '2025-02').backgroundColor === INVOICE_BOX_COLORS.issued.fill,
  'Paid invoices get the bolder green, unpaid ones the magenta wash',
  `${paidStyle.backgroundColor} vs ${invoiceCellStyle(january, '2025-02').backgroundColor}`
);
assert(
  invoiceCellStyle(january, '2025-01').boxShadow.includes('inset 2px 0 0') &&
    !invoiceCellStyle(january, '2025-02').boxShadow.includes('inset 2px 0 0') &&
    invoiceCellStyle(january, '2025-03').boxShadow.includes('inset -2px 0 0'),
  'Only the box edges draw vertical borders so contiguous cells read as one box'
);

const otherContract = contract({
  id: 'cnt-2',
  reference: 'SB-EMS-2025-07',
  lines: [{ ...monthlyLine, contract_id: 'cnt-2', unit_price: 5000 }],
});
const twoSameCounterparty = [baseContract, otherContract];
const referenced = buildInvoiceCoverage(
  [invoice({ notes: 'Billed under SB-EMS-2025-07' })],
  twoSameCounterparty
);
assert(
  !referenced.has('cnt-1:2025-01') && referenced.has('cnt-2:2025-01'),
  'An unlinked invoice is matched by the contract reference printed on it'
);

const closest = buildInvoiceCoverage([invoice({ net: 15000 })], twoSameCounterparty);
assert(
  !closest.has('cnt-1:2025-01') && closest.has('cnt-2:2025-01'),
  'Without a reference, the counterparty contract whose charges match the invoice net wins'
);

const linked = buildInvoiceCoverage(
  [invoice({ contract_id: 'cnt-2', net: 3000 })],
  twoSameCounterparty
);
assert(
  linked.has('cnt-2:2025-01') && !linked.has('cnt-1:2025-01'),
  'A linked invoice stays on its own contract even when another contract matches the amount'
);

assert(
  buildInvoiceCoverage([invoice({ status: 'cancelled' })], [baseContract]).size === 0 &&
    buildInvoiceCoverage([invoice({ direction: 'incoming' })], [baseContract]).size === 0,
  'Cancelled and incoming invoices never overlay the revenue schedule'
);

const mergedInvoice = buildInvoiceCoverage(
  [
    invoice({ id: 'paid', invoice_number: 'INV-PAID', status: 'paid', period_from: '2025-01-01', period_to: '2025-02-28' }),
    invoice({ id: 'unpaid', invoice_number: 'INV-OPEN', period_from: '2025-02-01', period_to: '2025-03-31' }),
  ],
  [baseContract]
);
const february = mergedInvoice.get('cnt-1:2025-02');
assert(
  february?.paid === false && february.firstMonth === '2025-01' && february.lastMonth === '2025-03' &&
    february.invoices.length === 2,
  'Overlapping invoices merge into one box and an unpaid invoice keeps it light',
  JSON.stringify(february)
);
assert(
  february?.invoiceTotal === 6000 && february.contractTotal === 3000 && february.variance === 3000,
  'A merged box adds both invoice nets against the merged contract range',
  `invoice ${february?.invoiceTotal} · contract ${february?.contractTotal}`
);

const lateInvoice = buildInvoiceCoverage([invoice({ issue_date: '2025-05-10' })], [baseContract]);
const march = lateInvoice.get('cnt-1:2025-03');
assert(
  march?.markerMonth === '2025-03' && march.markerPosition === 'end',
  'An invoice issued after the billed period marks the end of the box'
);


// --- Invoices that bill several agreements and projects ----------------------
const crAlpha = { id: 'prj-alpha', contract_id: 'cnt-1', name: 'Alpha roll-out', status: 'active', budget_value: 6000 };
const crBeta = { id: 'prj-beta', contract_id: 'cnt-2', name: 'Beta add-on', status: 'active', budget_value: 3000 };

const builtLinks = buildInvoiceLinks({
  contractIds: ['cnt-9'],
  projectIds: ['prj-alpha', 'prj-beta', 'prj-alpha'],
  projects: [crAlpha, crBeta],
});
assert(
  JSON.stringify(builtLinks) === JSON.stringify({
    contractIds: ['cnt-9', 'cnt-1', 'cnt-2'],
    projectIds: ['prj-alpha', 'prj-beta'],
    primaryContractId: 'cnt-9',
  }),
  'A project link brings its parent agreement along, first pick stays primary',
  JSON.stringify(builtLinks)
);

assert(
  invoiceContractIds({ contract_id: 'cnt-1', contract_ids: [] }).join(',') === 'cnt-1',
  'Rows without link arrays fall back to the legacy single contract'
);
assert(
  invoiceContractIds({ contract_id: 'cnt-1', contract_ids: ['cnt-2', 'cnt-1'] }).join(',') === 'cnt-2,cnt-1',
  'The link array wins over the legacy column'
);
assert(
  invoiceContractIds({ contract_id: null, contract_ids: null }).length === 0 &&
    invoiceProjectIds({ contract_id: null, contract_ids: [], project_ids: ['prj-alpha', ' '] }).join(',') === 'prj-alpha',
  'An unlinked invoice resolves to no links, and blank ids are dropped'
);
assert(
  invoiceLinkedContractIds({ contract_id: null, contract_ids: [], project_ids: ['prj-alpha'] }, [crAlpha]).join(',') === 'cnt-1' &&
    invoiceLinksContract({ contract_id: null, contract_ids: [], project_ids: ['prj-alpha'] }, 'cnt-1', [crAlpha]) &&
    !invoiceLinksContract({ contract_id: null, contract_ids: [], project_ids: ['prj-alpha'] }, 'cnt-2', [crAlpha]),
  'A project-only link resolves to its own agreement and no other'
);

const multiContractInvoice = invoice({ id: 'inv-multi', invoice_number: 'INV-MULTI', contract_ids: ['cnt-1', 'cnt-2'], net: 8000 });
const multiCoverage = buildInvoiceCoverage([multiContractInvoice], twoSameCounterparty);
assert(
  multiCoverage.has('cnt-1:2025-01') && multiCoverage.has('cnt-2:2025-01') &&
    multiCoverage.get('cnt-1:2025-01')?.invoices.join(',') === 'INV-MULTI',
  'One invoice paints a box on every agreement it bills',
  [...multiCoverage.keys()].join(' ')
);

const projectOnlyInvoice = invoice({
  id: 'inv-project', invoice_number: 'INV-PROJECT', contract_id: null, contract_ids: [], project_ids: ['prj-alpha'],
});
const projectCoverage = buildInvoiceCoverage([projectOnlyInvoice], twoSameCounterparty, [], [], [crAlpha, crBeta]);
assert(
  projectCoverage.size === 0,
  'A project-linked invoice paints no agreement row — the change-request row owns it',
  [...projectCoverage.keys()].join(' ')
);

// The link picker saves the parent agreement alongside a project; the schedule must not show the
// same invoice on both rows.
const contractAndProjectInvoice = invoice({
  id: 'inv-both', invoice_number: 'Α-22', status: 'paid',
  contract_id: 'cnt-1', contract_ids: ['cnt-1'], project_ids: ['prj-alpha'], net: 4500,
});
const bothCoverage = buildInvoiceCoverage([contractAndProjectInvoice], twoSameCounterparty, [], [], [crAlpha, crBeta]);
const bothProjectCoverage = buildProjectInvoiceCoverage([contractAndProjectInvoice], [crAlpha, crBeta]);
assert(
  bothCoverage.size === 0 &&
    bothProjectCoverage.get(projectInvoiceCellKey('prj-alpha', '2025-01'))?.invoices.join(',') === 'Α-22',
  'An invoice linked to an agreement and its project is counted once, on the change-request row',
  `contract cells ${bothCoverage.size} · project cells ${bothProjectCoverage.size}`
);
assert(
  buildInvoiceCoverage([invoice({ id: 'inv-elsewhere', contract_ids: ['cnt-2'], project_ids: ['prj-alpha'] })], twoSameCounterparty, [], [], [crAlpha, crBeta])
    .has('cnt-2:2025-01'),
  'A contract linked next to another agreement’s project still paints that agreement',
  'cnt-2 keeps its box'
);

// Change-request rows show the invoices their projects are billed by.
const crInvoice = invoice({
  id: 'inv-cr',
  invoice_number: 'Α-13',
  status: 'paid',
  contract_id: 'cnt-1',
  contract_ids: ['cnt-1'],
  project_ids: ['prj-alpha'],
  net: 6000,
});
const projectBoxes = buildProjectInvoiceCoverage([crInvoice], [crAlpha, crBeta]);
assert(
  projectBoxes.get(projectInvoiceCellKey('prj-alpha', '2025-01'))?.invoices.join(',') === 'Α-13' &&
    projectBoxes.get(projectInvoiceCellKey('prj-alpha', '2025-03'))?.paid === true &&
    !projectBoxes.has(projectInvoiceCellKey('prj-beta', '2025-01')),
  'A project-linked invoice paints that change request and no other',
  [...projectBoxes.keys()].join(' ')
);
const unlinkedForProjects = buildProjectInvoiceCoverage([invoice({ project_ids: [] })], [crAlpha]);
assert(unlinkedForProjects.size === 0, 'An invoice without project links paints no change-request cell');

// --- Receipts: money paid without a tax invoice -------------------------------
const receipt = (overrides = {}) => ({
  id: 'rcp-1',
  counterparty_id: 'cp-1',
  direction: 'incoming',
  amount: 5000,
  currency: 'EUR',
  fx_rate: 1,
  amount_eur: 5000,
  received_on: '2025-02-10',
  period_from: '2025-01-01',
  period_to: '2025-02-28',
  method: 'intercompany',
  bank_reference: 'GCS mass transfer 02/2025',
  note: null,
  contract_ids: ['cnt-1'],
  project_ids: [],
  invoice_id: null,
  ...overrides,
});

assert(
  receiptCoveredMonths(receipt()).join(',') === '2025-01,2025-02' &&
    receiptCoveredMonths(receipt({ period_from: null, period_to: null })).join(',') === '2025-02',
  'A receipt covers its stated period, else the month the money landed',
  receiptCoveredMonths(receipt()).join(',')
);

const receiptCoverage = buildInvoiceCoverage([], [baseContract], [], [], [], [receipt()]);
const receiptCell = receiptCoverage.get('cnt-1:2025-01');
assert(
  receiptCoverage.size === 2 && receiptCell?.paid === true && receiptCell.receiptTotal === 5000,
  'A receipt paints the months it covers as paid',
  `${receiptCoverage.size} cells · paid ${receiptCell?.paid} · ${receiptCell?.receiptTotal}`
);
assert(
  receiptCell?.invoiceTotal === 0 && coverageTotal(receiptCell) === 5000 &&
    receiptCell.invoices.length === 0 && receiptCell.receipts[0] === 'GCS mass transfer 02/2025',
  'Receipt money is tracked apart from invoiced money so the tooltip can name the transfer',
  JSON.stringify({ invoiceTotal: receiptCell?.invoiceTotal, receipts: receiptCell?.receipts })
);
assert(
  receiptCell?.contractTotal === 2000 && receiptCell.variance === 3000 && invoiceVarianceTone(receiptCell) === 'over',
  'Receipts are compared against the contract charges they settle',
  `contract ${receiptCell?.contractTotal} · variance ${receiptCell?.variance}`
);
const receiptStyle = invoiceCellStyle(receiptCell, '2025-01');
assert(
  receiptStyle.backgroundColor === INVOICE_BOX_COLORS.paid.fill &&
    receiptStyle.boxShadow.includes(INVOICE_BOX_COLORS.paid.line) &&
    invoiceMarkerColor(receiptCell) === INVOICE_BOX_COLORS.paid.marker,
  'A receipt box uses the paid palette, not the issued one',
  receiptStyle.backgroundColor
);

const receiptOnProject = buildInvoiceCoverage(
  [], [baseContract], [], [], [crAlpha],
  [receipt({ contract_ids: ['cnt-1'], project_ids: ['prj-alpha'] })]
);
assert(
  receiptOnProject.size === 0,
  'A receipt linked to a change request does not also paint its agreement row',
  [...receiptOnProject.keys()].join(' ')
);
assert(
  buildInvoiceCoverage([], [baseContract], [], [], [], [receipt({ contract_ids: [], project_ids: [] })]).size === 0,
  'An unlinked receipt paints nothing on the schedule'
);
assert(
  buildInvoiceCoverage([], [baseContract], [], [], [], [receipt({ direction: 'outgoing' })]).size === 0,
  'Money paid out never marks revenue as received'
);

const receiptWithInvoice = buildInvoiceCoverage(
  [invoice({ status: 'sent_received', net: 3000, invoice_number: 'INV-001' })],
  [baseContract],
  [],
  [],
  [],
  [receipt({ amount: 3000, amount_eur: 3000, period_from: '2025-01-01', period_to: '2025-03-31' })]
);
const mergedCell = receiptWithInvoice.get('cnt-1:2025-02');
assert(
  mergedCell?.invoiceTotal === 3000 && mergedCell.receiptTotal === 3000 && coverageTotal(mergedCell) === 6000 &&
    mergedCell.invoices.join(',') === 'INV-001' && mergedCell.receipts.length === 1,
  'A receipt and an invoice covering the same month merge into one box',
  JSON.stringify({ invoiceTotal: mergedCell?.invoiceTotal, receiptTotal: mergedCell?.receiptTotal })
);
assert(
  mergedCell?.paid === true && mergedCell.variance === 3000,
  'Received money flips the box to paid and counts towards the coverage total',
  `paid ${mergedCell?.paid} · variance ${mergedCell?.variance}`
);

const receiptOverDraft = buildInvoiceCoverage([invoice({ status: 'draft' })], [baseContract], [], [], [], [receipt()]);
const draftPlusReceipt = receiptOverDraft.get('cnt-1:2025-01');
assert(
  draftPlusReceipt?.draft === false && draftPlusReceipt.paid === true,
  'A receipt over a draft invoice settles the box instead of leaving it grey',
  `draft ${draftPlusReceipt?.draft} · paid ${draftPlusReceipt?.paid}`
);

const projectReceiptBoxes = buildProjectInvoiceCoverage([], [crAlpha], [receipt({ contract_ids: [], project_ids: ['prj-alpha'] })]);
assert(
  projectReceiptBoxes.get(projectInvoiceCellKey('prj-alpha', '2025-01'))?.paid === true &&
    !projectReceiptBoxes.has(projectInvoiceCellKey('prj-beta', '2025-01')),
  'A receipt linked to a change request paints only that row',
  [...projectReceiptBoxes.keys()].join(' ')
);

// --- Invoice suggestions -----------------------------------------------------
const today = new Date('2025-03-15T00:00:00');
const billable = contract({ lines: [monthlyLine], invoice_timing: 'start_of_period', billing_cadence: 'monthly' });
const advanceSuggestions = buildInvoiceSuggestions([billable], { today });
assert(
  advanceSuggestions.length === 3 && advanceSuggestions.every(s => s.months.length === 1),
  'A monthly contract billed in advance suggests every started period',
  advanceSuggestions.map(s => s.period.key).join(', ')
);
assert(
  advanceSuggestions[0]?.months[0] === '2025-01' && advanceSuggestions[0].invoiceDate === '2025-01-01' &&
    advanceSuggestions[0].amount > 0 && advanceSuggestions[0].actionMonth === '2025-01',
  'A suggestion carries its months, invoice date and expected amount',
  JSON.stringify({ months: advanceSuggestions[0]?.months, date: advanceSuggestions[0]?.invoiceDate, amount: advanceSuggestions[0]?.amount })
);

const arrears = buildInvoiceSuggestions([contract({ lines: [monthlyLine], invoice_timing: 'end_of_period' })], { today });
assert(
  arrears.length === 2 && arrears.every(s => s.timing === 'end_of_period') && arrears[0].invoiceDate === '2025-01-31',
  'Arrears billing waits for the period end before suggesting the invoice',
  arrears.map(s => `${s.period.key}@${s.invoiceDate}`).join(' ')
);

const quarterly = buildInvoiceSuggestions(
  [contract({ lines: [{ ...monthlyLine, unit_price: 3000 }], billing_cadence: 'quarterly', invoice_timing: 'end_of_period' })],
  { today: new Date('2025-06-30T00:00:00') }
);
assert(
  quarterly.length === 2 && suggestionMonths(quarterly[0].period).join(',') === '2025-01,2025-02,2025-03',
  'A quarterly cycle covers three months in one suggestion box',
  suggestionMonths(quarterly[0]?.period).join(',')
);

const linkedInvoice = {
  id: 'inv-jan', direction: 'outgoing', counterparty_id: 'cp-1', contract_id: 'cnt-1', type: 'invoice',
  invoice_number: 'INV-JAN', issue_date: '2025-01-01', due_date: '2025-01-15',
  period_from: '2025-01-01', period_to: '2025-01-31', currency: 'EUR', fx_rate: 1, net: 806.45,
  vat_amount: 193.55, vat_rate: '24', gross: 1000, gross_eur: 1000, status: 'sent_received',
};
assert(
  buildInvoiceSuggestions([billable], { today, invoices: [linkedInvoice] }).every(s => s.period.key !== '2025-01-01'),
  'A period whose invoice already exists is no longer suggested'
);
const siblingContract = contract({
  id: 'cnt-2',
  reference: 'SB-EMS-2025-07',
  lines: [{ ...monthlyLine, contract_id: 'cnt-2', unit_price: 5000 }],
});
const linkedToFirstOnly = buildInvoiceSuggestions([billable, siblingContract], {
  today,
  invoices: [{ ...linkedInvoice, contract_ids: ['cnt-1'] }],
});
assert(
  !linkedToFirstOnly.some(s => s.contractId === 'cnt-1' && s.period.key === '2025-01-01') &&
    linkedToFirstOnly.some(s => s.contractId === 'cnt-2' && s.period.key === '2025-01-01'),
  'An invoice linked to one agreement leaves the sibling agreement billable',
  linkedToFirstOnly.map(s => `${s.contract.reference}@${s.period.key}`).join(' ')
);
assert(
  buildInvoiceSuggestions([billable], { today, draftInvoiceIds: { 'cnt-1::2025-02-01': 'draft-1' } })
    .every(s => s.period.key !== '2025-02-01'),
  'An optimistically created draft hides its suggestion immediately'
);

const draftSuggestion = buildInvoiceSuggestions([billable], {
  today,
  invoices: [invoice({ status: 'draft', contract_id: 'cnt-1' })],
});
assert(
  draftSuggestion.every(s => s.period.key !== '2025-01-01'),
  'A drafted period is not suggested again while the draft exists'
);

// --- Split cycles: one invoice must not hide the other half's suggestion ------
const oneOffInvoice = {
  id: 'inv-oneoff', direction: 'outgoing', counterparty_id: 'cp-1', contract_id: 'cnt-1', type: 'invoice',
  invoice_number: 'INV-ONBOARD', issue_date: '2025-01-01', due_date: '2025-01-15',
  period_from: '2025-01-01', period_to: '2025-01-01', currency: 'EUR', fx_rate: 1, net: 7258.06,
  vat_amount: 1741.94, vat_rate: '24', gross: 9000, gross_eur: 9000, status: 'paid',
};
const splitToday = new Date('2025-03-31T00:00:00');
const splitSuggestions = buildInvoiceSuggestions([mixedContract], { today: splitToday, invoices: [oneOffInvoice] });
assert(
  splitSuggestions.length === 1 && splitSuggestions[0].period.timing === 'end_of_period' &&
    splitSuggestions[0].amount === 3000,
  'A paid one-off invoice does not hide the quarterly fee suggestion',
  splitSuggestions.map(s => `${s.period.key}:${s.amount}`).join(', ') || 'no suggestions'
);

const quarterInvoice = {
  ...oneOffInvoice,
  id: 'inv-q1', invoice_number: 'INV-Q1', issue_date: '2025-03-31', due_date: '2025-04-15',
  period_from: '2025-01-01', period_to: '2025-03-31', status: 'sent_received',
  net: 2419.35, vat_amount: 580.65, gross: 3000, gross_eur: 3000,
};
const advanceLeft = buildInvoiceSuggestions([mixedContract], { today: splitToday, invoices: [quarterInvoice] });
assert(
  advanceLeft.length === 1 && advanceLeft[0].period.timing === 'start_of_period' && advanceLeft[0].amount === 9000,
  'A quarter-end invoice leaves the advance one-off suggested',
  advanceLeft.map(s => `${s.period.key}:${s.amount}`).join(', ') || 'no suggestions'
);

const bothInvoices = buildInvoiceSuggestions([mixedContract], {
  today: splitToday,
  invoices: [oneOffInvoice, quarterInvoice],
});
assert(
  bothInvoices.length === 0,
  'Once both halves are invoiced the cycle stops being suggested',
  bothInvoices.map(s => s.period.key).join(', ')
);

// The suggestion queue follows the same split: the one-off opens the term, the fees close each quarter.
const splitQueue = buildInvoiceSuggestions([mixedContract], { today: new Date('2025-12-31T00:00:00') });
const advanceRow = splitQueue.find(s => s.period.timing === 'start_of_period');
const arrearsRows = splitQueue.filter(s => s.period.timing === 'end_of_period');
assert(
  advanceRow && advanceRow.amount === 9000 && advanceRow.invoiceDate === '2025-01-01' &&
    advanceRow.months.join(',') === '2025-01,2025-02,2025-03',
  'The advance one-off is suggested on the activation date',
  advanceRow ? `${advanceRow.period.key} ${advanceRow.amount} ${advanceRow.invoiceDate}` : 'missing'
);
assert(
  arrearsRows.length === 4 && arrearsRows.every(s => s.amount === 3000) &&
    arrearsRows[0].invoiceDate === '2025-03-31' && arrearsRows[3].invoiceDate === '2025-12-31',
  'Recurring fees are suggested once per quarter, dated on the quarter end',
  arrearsRows.map(s => `${s.invoiceDate}:${s.amount}`).join(' ')
);

// --- Credit notes cancel invoices instead of paying them ---------------------
// myDATA cancels by credit note: the pair must not count as revenue, and an unmatched credit still
// reduces it.
const creditInvoice = (overrides = {}) => ({
  id: 'inv-orig', direction: 'outgoing', counterparty_id: 'cp-1', contract_id: 'cnt-1', type: 'invoice',
  invoice_number: 'B-15', issue_date: '2026-07-08', due_date: '2026-08-07',
  period_from: '2025-10-01', period_to: '2026-03-31', net: 11304.3, vat_amount: 0,
  gross: 11304.3, gross_eur: 11304.3, status: 'paid', ...overrides,
});
const creditNote = (overrides = {}) => creditInvoice({
  id: 'inv-credit', type: 'credit_note', invoice_number: 'D-3', ...overrides,
});
const earlierInvoice = creditInvoice({ id: 'inv-kept', invoice_number: 'B-11', issue_date: '2026-05-05', due_date: '2026-06-04' });
const credited = netInvoices([earlierInvoice, creditInvoice(), creditNote()]);
assert(
  credited.active.length === 1 && credited.active[0].id === 'inv-kept' &&
    credited.reversed.length === 1 && credited.reversed[0].id === 'inv-orig' &&
    credited.appliedCredits.length === 1 && credited.appliedCredits[0].id === 'inv-credit',
  'A credit note reverses the invoice it cancels, and neither counts as revenue',
  `active ${credited.active.map(i => i.invoice_number)} · reversed ${credited.reversed.map(i => i.invoice_number)}`
);
assert(
  credited.reversedOf.get('inv-credit') === 'inv-orig' && credited.openCredits.length === 0,
  'The credit is paired with the latest matching invoice, not the older one'
);

const linkedCredit = netInvoices([
  creditInvoice(),
  creditNote({ credits_invoice_id: 'inv-orig' }),
]);
assert(
  linkedCredit.active.length === 0 && linkedCredit.reversedOf.get('inv-credit') === 'inv-orig',
  'An explicit credits_invoice_id link wins over amount matching'
);

const partialCredit = netInvoices([creditInvoice(), creditNote({ id: 'inv-partial', gross: 1000, gross_eur: 1000, net: 1000 })]);
assert(
  partialCredit.active.length === 1 && partialCredit.openCredits.length === 1 &&
    partialCredit.openCredits[0].id === 'inv-partial',
  'A credit note that does not match an invoice stays open and reduces revenue',
  partialCredit.openCredits.map(i => i.invoice_number).join(', ')
);
assert(
  accountingInvoices([creditInvoice(), creditNote({ id: 'inv-partial', gross: 1000, gross_eur: 1000, net: 1000 })])
    .reduce((sum, invoice) => sum + invoice.gross_eur, 0) === 10304.3,
  'The accounting set nets an unmatched credit instead of dropping it'
);

const otherEntityCredit = netInvoices([
  creditInvoice(),
  creditNote({ counterparty_id: 'cp-2' }),
]);
assert(
  otherEntityCredit.active.length === 1 && otherEntityCredit.openCredits.length === 1,
  'A credit note from another counterparty never reverses this invoice'
);

assert(
  accountingInvoices([creditInvoice(), creditNote()]).length === 0,
  'A cancelled pair leaves nothing in the accounting set'
);
assert(
  netInvoices([creditInvoice({ status: 'cancelled' })]).active.length === 0,
  'Cancelled documents never count'
);

// The schedule never paints a box for a credited invoice, and the surviving one still does.
const creditedCoverage = buildInvoiceCoverage(
  [creditInvoice(), creditNote()],
  [contract({ lines: [monthlyLine], invoice_timing: 'start_of_period' })]
);
assert(
  creditedCoverage.size === 0,
  'A credited invoice paints no coverage box',
  String(creditedCoverage.size)
);
const liveInvoice = creditInvoice({ id: 'inv-live', invoice_number: 'B-11', issue_date: '2026-05-05', period_from: '2025-10-01', period_to: '2026-03-31' });
const liveCoverage = buildInvoiceCoverage([liveInvoice, creditNote({ id: 'inv-credit-2', credits_invoice_id: 'inv-gone' })], [contract({ lines: [monthlyLine], invoice_timing: 'start_of_period' })]);
assert(
  liveCoverage.get('cnt-1:2025-10')?.invoices.includes('B-11') === true,
  'The invoice that was not credited keeps its coverage box',
  JSON.stringify(liveCoverage.get('cnt-1:2025-10')?.invoices || [])
);

// A credit note must not mark the period it mentions as already invoiced.
const creditedSuggestions = buildInvoiceSuggestions([billable], {
  today,
  invoices: [
    { ...linkedInvoice, id: 'inv-cn', type: 'credit_note', invoice_number: 'D-3' },
  ],
});
assert(
  creditedSuggestions.some(s => s.period.key === '2025-01-01'),
  'A credit note does not hide the suggestion of the period it refers to'
);
const reversedSuggestions = buildInvoiceSuggestions([billable], {
  today,
  invoices: [
    { ...linkedInvoice, id: 'inv-a', invoice_number: 'B-15' },
    { ...linkedInvoice, id: 'inv-b', type: 'credit_note', invoice_number: 'D-3' },
  ],
});
assert(
  reversedSuggestions.some(s => s.period.key === '2025-01-01'),
  'An invoice cancelled by a credit note becomes billable again'
);

// --- Draft invoices created from a suggestion ---------------------------------
// The contract amount for the period is the invoice's NET: VAT is added on top of it.
const draft = buildDraftInvoicePayload({
  period: { key: '2026-04-01@end', label: '01/04/2026 - 30/06/2026', from: '2026-04-01', to: '2026-06-30' },
  contractId: 'cnt-1',
  counterpartyId: 'cp-1',
  direction: 'revenue',
  currency: 'EUR',
  netAmount: 3000,
  vatRate: vatRateForTreatment('domestic_24'),
  reference: 'DEPA-2026-FOSE',
  timing: 'end_of_period',
  invoiceNumber: 'INV-2026-0001',
  issueDate: '2026-07-01',
  dueDate: '2026-07-15',
});
assert(
  draft.net === 3000 && draft.vat_amount === 720 && draft.gross === 3720,
  'The contract amount lands in the net amount and VAT is added on top',
  `net ${draft.net} / vat ${draft.vat_amount} / gross ${draft.gross}`
);
assert(draft.vat_rate === '24%' && draft.gross_eur === 3720, 'The draft stores the register VAT rate and the EUR gross');
assert(draft.period_from === '2026-04-01' && draft.period_to === '2026-06-30', 'The draft keeps the billed window');

// Zero-rated contracts (EU reverse charge / non-EU) bill the contract amount without VAT.
const zeroRated = buildDraftInvoicePayload({
  period: { key: '2026-05-01', label: 'May 2026', from: '2026-05-01', to: '2026-05-31' },
  contractId: 'cnt-2',
  counterpartyId: 'cp-2',
  direction: 'cost',
  netAmount: 1250.5,
  vatRate: vatRateForTreatment('intra_eu_reverse_charge'),
  invoiceNumber: 'INV-2026-0002',
  issueDate: '2026-05-01',
  dueDate: '2026-05-31',
});
assert(
  zeroRated.net === 1250.5 && zeroRated.vat_amount === 0 && zeroRated.gross === 1250.5 && zeroRated.direction === 'incoming',
  'A reverse-charge contract drafts the amount without VAT',
  `net ${zeroRated.net} / vat ${zeroRated.vat_amount} / gross ${zeroRated.gross}`
);

// A foreign-currency draft converts the gross for reporting at the supplied rate.
const converted = buildDraftInvoicePayload({
  period: { key: '2026-06-01', label: 'June 2026', from: '2026-06-01', to: '2026-06-30' },
  contractId: 'cnt-3',
  counterpartyId: 'cp-3',
  direction: 'revenue',
  currency: 'USD',
  fxRate: 1.1,
  netAmount: 1000,
  vatRate: '6%',
  invoiceNumber: 'INV-2026-0003',
  issueDate: '2026-06-01',
  dueDate: '2026-06-30',
});
assert(
  converted.net === 1000 && converted.vat_amount === 60 && converted.gross === 1060 && converted.gross_eur === 1166,
  'The draft VAT follows the stored rate and gross_eur converts it',
  `net ${converted.net} / vat ${converted.vat_amount} / gross ${converted.gross} / eur ${converted.gross_eur}`
);

// The suggestion's amount is exactly what the draft puts in the net.
const suggestion = buildInvoiceSuggestions([billable], { today })[0];
assert(
  suggestion && buildDraftInvoicePayload({
    period: suggestion.period,
    contractId: suggestion.contractId,
    counterpartyId: 'cp-1',
    direction: 'revenue',
    netAmount: suggestion.amount,
    invoiceNumber: 'INV-2026-0004',
    issueDate: '2025-01-01',
    dueDate: '2025-01-15',
  }).net === suggestion.amount,
  'Creating a draft from a suggestion books the suggested amount as net',
  suggestion ? String(suggestion.amount) : 'no suggestion'
);

assert(
  vatRateForTreatment('domestic_24') === '24%' && vatRateForTreatment('non_eu') === '0%' &&
    vatRateForTreatment(undefined) === '24%' && vatPercentFromRate('0% (reverse charge)') === 0 &&
    vatPercentFromRate('24') === 24,
  'VAT treatment and stored rate strings normalise to a percentage'
);

// --- Subcontracts ------------------------------------------------------------
// We deliver under another company's contract: the payer stays the counterparty, the client the work
// really serves is the end customer, and the prime keeps a fee.
const primeContract = contract({ id: 'cnt-prime', reference: 'SB-DIRECT-2025', counterparty_id: 'cp-veb' });
const subContract = contract({
  id: 'cnt-sub',
  reference: 'UNISYSTEMS-VEB-ATLAS-2024',
  counterparty_id: 'cp-uni',
  counterparty: { id: 'cp-uni', legal_name: 'Uni Systems' },
  supply_role: 'subcontractor',
  end_customer_id: 'cp-veb',
  end_customer: { id: 'cp-veb', legal_name: 'VEB' },
  prime_contract_ref: 'UNS-2024-778',
  prime_fee_pct: 10,
  lines: [monthlyLine],
});

assert(
  supplyRoleOf(primeContract) === 'prime' && !isSubcontract(primeContract) &&
    supplyRoleOf(subContract) === 'subcontractor' && isSubcontract(subContract),
  'A contract without a supply role reads as prime; a subcontract says so',
  `${supplyRoleOf(primeContract)} / ${supplyRoleOf(subContract)}`
);
assert(
  contractEndCustomerName(subContract) === 'VEB' && contractEndCustomerName(primeContract) === 'DEPA Commercial S.A.',
  'The end customer is the real client for a subcontract and the counterparty for a direct deal',
  `${contractEndCustomerName(subContract)} / ${contractEndCustomerName(primeContract)}`
);
assert(
  primeFeeAmount(subContract, 1000) === 100 && netAfterPrimeFee(subContract, 1000) === 900 &&
    primeFeeLabel(subContract) === '10%',
  'The prime fee is a share of what we bill, and the net is what reaches us',
  `${primeFeeAmount(subContract, 1000)} / ${netAfterPrimeFee(subContract, 1000)}`
);
assert(
  primeFeeAmount(primeContract, 1000) === 0 && netAfterPrimeFee(primeContract, 1000) === 1000 &&
    primeFeeAmount({ ...subContract, prime_fee_pct: 140 }, 1000) === 1000,
  'Direct deals pay no fee, and a fee above 100% is clamped'
);

const subSchedule = buildRevenueSchedule([subContract, primeContract], []);
const subRows = subSchedule.rows.filter(row => row.contractId === 'cnt-sub');
const primeRows = subSchedule.rows.filter(row => row.contractId === 'cnt-prime');
assert(
  subRows.length === 1 && subRows[0].supply === 'subcontractor' && subRows[0].counterparty === 'Uni Systems' &&
    subRows[0].endCustomer === 'VEB',
  'A subcontract row carries both the payer and the client the work serves',
  JSON.stringify({ supply: subRows[0]?.supply, counterparty: subRows[0]?.counterparty, endCustomer: subRows[0]?.endCustomer })
);
assert(
  primeRows[0]?.supply === 'prime' && primeRows[0].endCustomer === 'DEPA Commercial S.A.',
  'A direct deal groups under its own counterparty',
  `${primeRows[0]?.supply} · ${primeRows[0]?.endCustomer}`
);

const subExport = scheduleExportTable(buildRevenueSchedule(
  [contract({
    supply_role: 'subcontractor',
    end_customer: { id: 'cp-veb', legal_name: 'VEB' },
    counterparty: { id: 'cp-uni', legal_name: 'Uni Systems' },
    lines: [monthlyLine],
    starts_on: '2025-11-01',
    ends_on: '2025-12-31',
    service_start_date: '2025-11-01',
  })],
  []
));
assert(
  subExport.rows[0].identity[0] === 'Uni Systems (for VEB)',
  'A subcontract exports under its payer plus the client it serves',
  subExport.rows[0].identity[0]
);

// --- Excel export ------------------------------------------------------------
// The workbook mirrors the grid: a line per stream, one column per month, a total per year.
const exportProjects = [{ id: 'prj-x', contract_id: 'cnt-1', name: 'Rollout', code: 'CR-7', status: 'active', budget_value: 2400, starts_on: '2025-11-01', ends_on: '2026-02-28' }];
const exportSchedule = buildRevenueSchedule(
  [contract({ lines: [monthlyLine], starts_on: '2025-11-01', ends_on: '2026-02-28', service_start_date: '2025-11-01' })],
  exportProjects
);
const exportTable = scheduleExportTable(exportSchedule);
assert(
  exportTable.years.map(group => group.year).join(',') === '2025,2026' &&
    exportTable.years[0].months.join(',') === '2025-11,2025-12' &&
    exportTable.years[1].months.join(',') === '2026-01,2026-02',
  'The export groups the month columns by calendar year',
  JSON.stringify(exportTable.years)
);
const contractExportRow = exportTable.rows[0];
assert(
  contractExportRow.identity[0] === 'DEPA Commercial S.A.' && contractExportRow.identity[1] === 'SB-ATLAS-2025-01' &&
    contractExportRow.identity[2] === 'Contract charges' && contractExportRow.identity[3] === 'saas_subscription',
  'A contract line carries counterparty, agreement, stream and product',
  JSON.stringify(contractExportRow.identity)
);
assert(
  contractExportRow.yearTotals[2025] === 2000 && contractExportRow.yearTotals[2026] === 2000 &&
    contractExportRow.months['2025-11'] === 1000,
  'Each exported line totals its own months per year',
  JSON.stringify(contractExportRow.yearTotals)
);
const changeRequestExportRow = exportTable.rows[1];
assert(
  changeRequestExportRow.identity[2] === 'Change request' && changeRequestExportRow.identity[3] === 'CR-7 · Rollout' &&
    changeRequestExportRow.yearTotals[2025] === 1200,
  'Change requests export with their project codes',
  JSON.stringify(changeRequestExportRow.identity)
);
assert(
  exportTable.totals.identity[0] === 'Portfolio total' &&
    exportTable.totals.months['2025-11'] === exportSchedule.monthTotals['2025-11'] &&
    exportTable.totals.yearTotals[2026] === yearTotalOf(exportSchedule.monthTotals, 2026),
  'The last exported row is the portfolio total',
  JSON.stringify(exportTable.totals.yearTotals)
);

// --- Cell explanations (right-click "How is this calculated?") ----------------
// Every cell's explanation must add up to the value the grid shows, on both views, whatever mix of
// frequencies, timings, minimums, floors, discounts and legacy paths produced it.
const explainContracts = [
  contract({
    id: 'cnt-x1', reference: 'SB-X1', discount_pct: 10, billing_cadence: 'quarterly', invoice_timing: 'end_of_period',
    starts_on: '2025-02-01', ends_on: '2026-07-31',
    groups: [{ id: 'g1', contract_id: 'cnt-x1', name: 'Core', min_monthly_charge: 2500 }],
    lines: [
      { id: 'x-a', contract_id: 'cnt-x1', name: 'Licence', unit_price: 1000, quantity: 1, unit_label: 'flat', frequency: 'monthly', group_id: 'g1' },
      { id: 'x-b', contract_id: 'cnt-x1', name: 'Forecast', unit_price: 40, quantity: 10, unit_label: 'MW', frequency: 'monthly', min_monthly_charge: 600, monthly_quantities: { '2025-06': 25 } },
      { id: 'x-c', contract_id: 'cnt-x1', name: 'Support', unit_price: 3000, quantity: 1, unit_label: 'flat', frequency: 'quarterly', invoice_timing: 'end_of_period', apply_discount: false },
      { id: 'x-d', contract_id: 'cnt-x1', name: 'Hosting', unit_price: 6000, quantity: 1, unit_label: 'flat', frequency: 'annual', invoice_timing: 'start_of_period', starts_on: '2025-04-01' },
      { id: 'x-e', contract_id: 'cnt-x1', name: 'Onboarding', unit_price: 9000, quantity: 1, unit_label: 'project', frequency: 'one_time', invoice_timing: 'start_of_period' },
    ],
  }),
  contract({ id: 'cnt-x2', reference: 'SB-X2', value: 24000, billing_cadence: 'annual', discount_pct: 5, invoice_timing: 'start_of_period' }),
  contract({ id: 'cnt-x3', reference: 'SB-X3', schedule: [{ period: '2025-03', amount: 700 }, { period: '2025-09', amount: 1300 }], billing_cadence: 'quarterly', invoice_timing: 'end_of_period' }),
  contract({ id: 'cnt-x4', reference: 'SB-X4', value: 5000, billing_cadence: 'one_off' }),
];
const explainProjects = [
  { id: 'xp-1', contract_id: 'cnt-x1', name: 'Rollout', code: 'CR-1', status: 'active', budget_value: 10000, starts_on: '2025-03-01', ends_on: '2025-05-31' },
  { id: 'xp-2', contract_id: 'cnt-x1', name: 'Extras', status: 'active', budget_value: 1000, starts_on: '2025-04-01', ends_on: '2025-04-30' },
];
['recognition', 'cashflow'].forEach(basis => {
  const grid = buildRevenueSchedule(explainContracts, explainProjects, [], [], { basis });
  const mismatches = [];
  grid.rows.forEach(row => grid.months.forEach(month => {
    const explanation = explainScheduleCell(row, month, basis);
    const sum = Math.round(explanation.items.reduce((total, item) => total + item.amount, 0) * 100) / 100;
    const expected = Math.round((row.months[month] || 0) * 100) / 100;
    if (Math.abs(sum - expected) > 0.011 || explanation.total !== expected) mismatches.push(`${row.id} ${month}: ${sum} vs ${expected}`);
  }));
  assert(mismatches.length === 0, `Every ${basis} cell explanation adds up to the grid value`, mismatches.slice(0, 5).join(' | '));
});
const recognitionGrid = buildRevenueSchedule(explainContracts, explainProjects);
const juneExplanation = explainScheduleCell(recognitionGrid.rows.find(row => row.id === 'cnt-x1::contract'), '2025-06', 'recognition');
const forecastItem = juneExplanation.items.find(item => item.label === 'Forecast');
assert(
  forecastItem && forecastItem.steps.some(step => step.startsWith('25 MW × €40.00 = €1,000.00')) &&
    forecastItem.steps.some(step => step.includes('10% contract discount → €900.00')),
  'A line explanation walks quantity × unit price through the discount',
  JSON.stringify(forecastItem)
);
const coreGroup = juneExplanation.items.find(item => item.label === 'Pricing group "Core"');
const licenceItem = coreGroup?.children?.find(item => item.label === 'Licence');
assert(
  coreGroup && licenceItem && coreGroup.amount === licenceItem.amount &&
    coreGroup.steps.some(step => step.startsWith('Floor €2,500.00 per month')) &&
    coreGroup.steps.some(step => step.includes('€1,000.00/month, below the floor → raised to €2,500.00')) &&
    licenceItem.steps.some(step => step.includes('"Core" floor uplift → €2,500.00')),
  'Grouped lines sit under their pricing group, which shows the floor it raised them to',
  JSON.stringify(coreGroup)
);
// A floor the lines already clear is still shown, so a reader can see why nothing was added.
const clearedFloor = contract({
  id: 'cnt-x5', reference: 'SB-X5',
  groups: [{ id: 'g5', contract_id: 'cnt-x5', name: 'Bundle', min_monthly_charge: 1000 }],
  lines: [
    { id: 'x5-a', contract_id: 'cnt-x5', name: 'Module A', unit_price: 700, quantity: 1, unit_label: 'flat', frequency: 'monthly', group_id: 'g5' },
    { id: 'x5-b', contract_id: 'cnt-x5', name: 'Module B', unit_price: 1500, quantity: 1, unit_label: 'flat', frequency: 'quarterly', group_id: 'g5' },
  ],
});
const clearedRow = buildRevenueSchedule([clearedFloor], []).rows[0];
const bundle = explainScheduleCell(clearedRow, '2025-01', 'recognition').items[0];
assert(
  bundle?.label === 'Pricing group "Bundle"' && bundle.children?.length === 2 && bundle.amount === clearedRow.months['2025-01'] &&
    bundle.steps.some(step => step.startsWith('Floor €1,000.00 per month')) &&
    bundle.steps.some(step => step.includes('€1,200.00/month, at or above the floor → no uplift')) &&
    bundle.steps.some(step => step.includes('monthly equivalent')),
  'A floor the group already clears is shown as not applied',
  JSON.stringify(bundle)
);
const crExplanation = explainScheduleCell(recognitionGrid.rows.find(row => row.id === 'cnt-x1::projects'), '2025-05', 'recognition');
assert(
  crExplanation.items.length === 1 && crExplanation.items[0].label === 'CR-1 · Rollout' &&
    crExplanation.items[0].steps.some(step => step.includes('rounding remainder')),
  'A change-request cell names its project and the rounding remainder',
  JSON.stringify(crExplanation.items)
);

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
