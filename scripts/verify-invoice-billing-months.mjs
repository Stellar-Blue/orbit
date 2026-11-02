/**
 * Verification for the month-by-month billing coverage an invoice reports.
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-invoice-billing-months.mjs
 *
 * Exercises the helper behind the MCP `get_billing_status` tool: an invoice whose lines bill
 * separate periods must mark each of them, not just the months its own reference period and due
 * date name.
 */

import { invoiceBillSegments, invoiceBillsMonth } from '@/lib/invoice-billing-months';

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

const CONTRACT = 'contract-atlas';
const OTHER = 'contract-trading';

/** An invoice in the shape the register stores it: whole-invoice window plus itemised lines. */
const invoice = (overrides = {}) => ({
  id: 'inv-1',
  direction: 'outgoing',
  counterparty_id: 'cp-1',
  type: 'invoice',
  invoice_number: 'Β-10',
  issue_date: '2026-04-27',
  due_date: '2026-05-27',
  reference_period: '2026-04',
  period_from: '2025-11-01',
  period_to: '2027-02-18',
  currency: 'EUR',
  fx_rate: 1,
  net: 25410.6,
  vat_amount: 0,
  vat_rate: '0%',
  gross: 25410.6,
  gross_eur: 25410.6,
  status: 'paid',
  lines: [],
  ...overrides,
});

const line = (overrides = {}) => ({
  id: `line-${Math.random().toString(16).slice(2)}`,
  description: '',
  amount: 1000,
  period_from: '2026-02-01',
  period_to: '2026-02-28',
  contract_id: CONTRACT,
  project_id: null,
  ...overrides,
});

// --- Itemised invoices: the lines decide the months ------------------------------
const itemised = invoice({
  lines: [
    line({ amount: 1085.1, period_from: '2026-02-01', period_to: '2026-02-28', description: 'RES/LOAD Feb 2026' }),
    line({ amount: 1085.1, period_from: '2026-03-01', period_to: '2026-03-31', description: 'RES/LOAD Mar 2026' }),
    line({ amount: 3000, period_from: '2026-02-19', period_to: '2027-02-18', description: 'VM cloud cost 2026' }),
    line({ amount: 7000, period_from: '2026-02-19', period_to: '2027-02-18', description: 'Support 2026' }),
  ],
});

assert(
  invoiceBillsMonth(itemised, CONTRACT, '2026-02').covers,
  'A February line marks February, even though the invoice period starts in 2025 and ends in 2027',
  JSON.stringify(invoiceBillsMonth(itemised, CONTRACT, '2026-02'))
);
assert(
  invoiceBillsMonth(itemised, CONTRACT, '2026-02').amount === 11085.1,
  'The February box allocates the monthly line plus the annual lines that start that month',
  String(invoiceBillsMonth(itemised, CONTRACT, '2026-02').amount)
);
assert(
  invoiceBillsMonth(itemised, CONTRACT, '2026-03').covers &&
    invoiceBillsMonth(itemised, CONTRACT, '2026-03').amount === 1085.1,
  'A later month is covered by its own line and does not repeat the annual charge',
  String(invoiceBillsMonth(itemised, CONTRACT, '2026-03').amount)
);
assert(
  invoiceBillsMonth(itemised, CONTRACT, '2026-01').covers === false,
  'A month no line touches is not billed by this invoice'
);
assert(
  invoiceBillsMonth(itemised, CONTRACT, '2026-12').covers &&
    invoiceBillsMonth(itemised, CONTRACT, '2026-12').amount === 0,
  'A month inside a long line is covered, with no second allocation of that amount',
  JSON.stringify(invoiceBillsMonth(itemised, CONTRACT, '2026-12'))
);

// --- Reference period / due date are not coverage for itemised invoices ----------
const lineDriven = invoice({
  reference_period: '2026-04',
  due_date: '2026-05-27',
  lines: [line({ amount: 1085.1, period_from: '2026-02-01', period_to: '2026-02-28' })],
});
assert(
  !invoiceBillsMonth(lineDriven, CONTRACT, '2026-04').covers &&
    !invoiceBillsMonth(lineDriven, CONTRACT, '2026-05').covers,
  'An itemised invoice no longer bills the months its reference period and due date name',
  `Apr ${invoiceBillsMonth(lineDriven, CONTRACT, '2026-04').covers} · May ${invoiceBillsMonth(lineDriven, CONTRACT, '2026-05').covers}`
);

// --- Lines only bill their own agreement ----------------------------------------
const crossAgreement = invoice({
  lines: [
    line({ amount: 4450, contract_id: OTHER, period_from: '2026-02-16', period_to: '2026-03-15' }),
    line({ amount: 1085.1, contract_id: CONTRACT, period_from: '2026-02-01', period_to: '2026-02-28' }),
  ],
});
assert(
  invoiceBillsMonth(crossAgreement, CONTRACT, '2026-02').amount === 1085.1,
  'Another agreement’s line never counts for this one',
  String(invoiceBillsMonth(crossAgreement, CONTRACT, '2026-02').amount)
);
assert(
  invoiceBillsMonth(crossAgreement, OTHER, '2026-02').amount === 4450,
  'The other agreement sees its own line',
  String(invoiceBillsMonth(crossAgreement, OTHER, '2026-02').amount)
);
const projectOnly = invoice({ lines: [line({ contract_id: CONTRACT, project_id: 'project-1' })] });
assert(
  invoiceBillsMonth(projectOnly, CONTRACT, '2026-02').covers === false,
  'A change-request line bills the project, not the agreement’s own months'
);

// --- Invoices without lines keep the whole-invoice window -----------------------
const legacy = invoice({ lines: [], net: 9985, currency: 'EUR', period_from: '2025-09-16', period_to: '2025-11-15' });
assert(
  invoiceBillsMonth(legacy, CONTRACT, '2025-09').covers &&
    invoiceBillsMonth(legacy, CONTRACT, '2025-10').covers &&
    invoiceBillsMonth(legacy, CONTRACT, '2025-11').covers &&
    !invoiceBillsMonth(legacy, CONTRACT, '2025-12').covers,
  'A line-less invoice covers the months of its own service window',
  String(invoiceBillSegments(legacy, CONTRACT).length)
);
assert(
  invoiceBillsMonth(legacy, CONTRACT, '2025-09').amount === 9985 &&
    invoiceBillsMonth(legacy, CONTRACT, '2025-10').amount === 0,
  'Its net is booked once, on the first month it covers',
  String(invoiceBillsMonth(legacy, CONTRACT, '2025-09').amount)
);
const noPeriod = invoice({ lines: [], period_from: null, period_to: null, reference_period: '2026-04', net: 500 });
assert(
  invoiceBillsMonth(noPeriod, CONTRACT, '2026-04').covers && invoiceBillsMonth(noPeriod, CONTRACT, '2026-04').amount === 500,
  'Without any window it falls back to the reference period it names',
  JSON.stringify(invoiceBillsMonth(noPeriod, CONTRACT, '2026-04'))
);

// --- Foreign currency lines convert to the EUR the schedule is expressed in ------
const usd = invoice({ currency: 'USD', fx_rate: 0.9, lines: [line({ amount: 1000 })] });
assert(
  invoiceBillsMonth(usd, CONTRACT, '2026-02').amount === 900,
  'A line in a foreign currency lands in EUR',
  String(invoiceBillsMonth(usd, CONTRACT, '2026-02').amount)
);

// --- A line without its own window inherits the invoice window -------------------
const inherited = invoice({
  period_from: '2026-02-01',
  period_to: '2026-02-28',
  lines: [line({ amount: 400, period_from: null, period_to: null })],
});
assert(
  invoiceBillsMonth(inherited, CONTRACT, '2026-02').covers &&
    invoiceBillsMonth(inherited, CONTRACT, '2026-02').amount === 400,
  'A line with no window of its own bills the invoice window',
  JSON.stringify(invoiceBillsMonth(inherited, CONTRACT, '2026-02'))
);

// --- Zero-amount placeholder lines are ignored -----------------------------------
const placeholder = invoice({ lines: [line({ amount: 0 }), line({ amount: 250, period_from: '2026-03-01', period_to: '2026-03-31' })] });
assert(
  invoiceBillsMonth(placeholder, CONTRACT, '2026-02').covers === false &&
    invoiceBillsMonth(placeholder, CONTRACT, '2026-03').amount === 250,
  'An empty placeholder line does not turn the invoice into an itemised one',
  JSON.stringify({
    feb: invoiceBillsMonth(placeholder, CONTRACT, '2026-02'),
    mar: invoiceBillsMonth(placeholder, CONTRACT, '2026-03'),
  })
);

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
