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
} from '@/lib/revenue-schedule';
import {
  buildInvoiceCoverage,
  INVOICE_BOX_COLORS,
  invoiceAmountEur,
  invoiceCellStyle,
  invoiceCoveredMonths,
  invoiceMarkerColor,
  invoiceMarkerPosition,
  invoiceVarianceTone,
} from '@/lib/invoice-coverage';
import { buildInvoiceSuggestions, suggestionMonths } from '@/lib/invoice-suggestions';
import { buildDraftInvoicePayload, vatPercentFromRate, vatRateForTreatment } from '@/lib/billing-periods';
import { accountingInvoices, netInvoices } from '@/lib/invoice-netting';

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

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
