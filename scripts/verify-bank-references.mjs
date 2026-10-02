/**
 * Verification — multiple bank references per payment (`src/lib/bank-references.ts`).
 *
 * A payment can be settled by several transfers, each with its own transaction number, so the column
 * is `text[]`. The parsing rules and the two contracts that keep the shape honest (the migration and
 * the types) are asserted here.
 *
 * Run: node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-bank-references.mjs
 *      (or: npm run test:bankrefs)
 */

import { bankReferences, formatBankReferences } from '../src/lib/bank-references.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function check(condition, testName, details = '') {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    if (details) console.error(`          └─ ${details}`);
    failed++;
  }
}

function same(actual, expected, testName) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, testName, a === e ? '' : `expected ${e}, got ${a}`);
}

// ---------------------------------------------------------------------------
// Reading a stored list
// ---------------------------------------------------------------------------
same(bankReferences(['700BCP36CAU', '1568395314']), ['700BCP36CAU', '1568395314'], 'a stored list is returned in order');
same(bankReferences(['  REF-1  ', 'REF-2']), ['REF-1', 'REF-2'], 'each reference is trimmed');

// ---------------------------------------------------------------------------
// Legacy and typed shapes
// ---------------------------------------------------------------------------
same(bankReferences('700BCP36CAU'), ['700BCP36CAU'], 'a legacy single string still reads as one reference');
same(
  bankReferences('REF-A, REF-B;REF-C|REF-D\nREF-E'),
  ['REF-A', 'REF-B', 'REF-C', 'REF-D', 'REF-E'],
  'a typed line splits on commas, semicolons, pipes and newlines'
);
same(bankReferences(['REF-A', '', '   ', 'REF-B']), ['REF-A', 'REF-B'], 'blank entries are dropped');
same(bankReferences(['ref-a', 'REF-A', 'Ref-A']), ['ref-a'], 'duplicates are removed case-insensitively, first casing wins');
same(bankReferences(['B', 'a', 'C']), ['B', 'a', 'C'], 'order is preserved, not sorted');

// ---------------------------------------------------------------------------
// Unusable input
// ---------------------------------------------------------------------------
same(bankReferences(null), [], 'null yields no references');
same(bankReferences(undefined), [], 'undefined yields no references');
same(bankReferences(''), [], 'an empty string yields no references');
same(bankReferences('   ,  ;  '), [], 'a line of separators only yields no references');
same(bankReferences([]), [], 'an empty list yields no references');
same(bankReferences([null, 42, {}, ['nested']]), [], 'non-string entries are ignored');
same(bankReferences(42), [], 'a number yields no references');

// ---------------------------------------------------------------------------
// Display form
// ---------------------------------------------------------------------------
check(formatBankReferences(['REF-A', 'REF-B']) === 'REF-A, REF-B', 'the display form joins with a comma and a space');
check(formatBankReferences(['REF-A', 'REF-B'], ' / ') === 'REF-A / REF-B', 'the separator can be overridden');
check(formatBankReferences(undefined) === '', 'no references display as an empty string, not "undefined"');
check(formatBankReferences('REF-A') === 'REF-A', 'the display form accepts a legacy string');

// ---------------------------------------------------------------------------
// Contract: the column, the migration and the types move together
// ---------------------------------------------------------------------------
const migration = readFileSync(path.join(here, '../supabase/migrations/0080_payment_bank_references.sql'), 'utf8');
check(
  /ALTER COLUMN bank_reference TYPE TEXT\[\]/.test(migration),
  'the migration turns payments.bank_reference into text[]'
);
check(
  /USING\s*\([\s\S]*?ARRAY\[/.test(migration),
  'the migration keeps existing values (USING ... ARRAY[...])'
);
check(
  /NOTIFY pgrst, 'reload schema'/.test(migration),
  'the migration reloads the PostgREST schema, or reads keep the old text shape'
);

const types = readFileSync(path.join(here, '../src/lib/types.ts'), 'utf8');
const paymentRecord = types.slice(types.indexOf('export interface PaymentRecord'), types.indexOf('export interface LeaveType'));
check(
  /bank_reference\?: string\[\]/.test(paymentRecord),
  'PaymentRecord.bank_reference is a list'
);
const invoicePayment = types.slice(types.indexOf('export interface InvoicePayment'), types.indexOf('export interface InvoiceAllocation'));
check(
  /bank_reference\?: string \| null/.test(invoicePayment),
  'InvoicePayment.bank_reference stays a single value (invoice payments were out of scope)'
);

console.log(`\n${failed === 0 ? '🎉' : '⚠️'} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
