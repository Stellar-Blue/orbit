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
import {
  buildInvoiceCoverage,
  invoiceAmountEur,
  invoiceCellStyle,
  invoiceCoveredMonths,
  invoiceMarkerPosition,
  invoiceVarianceTone,
} from '@/lib/invoice-coverage';
import { buildInvoiceSuggestions, suggestionMonths } from '@/lib/invoice-suggestions';

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
    paidStyle.backgroundColor === 'rgba(22, 163, 74, 0.28)' &&
    invoiceCellStyle(january, '2025-02').backgroundColor === 'rgba(34, 197, 94, 0.13)',
  'Paid invoices get the bolder green',
  paidStyle.backgroundColor
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
  buildInvoiceCoverage([invoice({ status: 'draft' })], [baseContract]).size === 0 &&
    buildInvoiceCoverage([invoice({ status: 'cancelled' })], [baseContract]).size === 0 &&
    buildInvoiceCoverage([invoice({ direction: 'incoming' })], [baseContract]).size === 0,
  'Draft, cancelled and incoming invoices never overlay the revenue schedule'
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

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
