/**
 * Verification — money input parsing (`src/lib/currency.ts`).
 *
 * Imports the REAL module (Node strips the types), so this cannot drift from the implementation the
 * way a mirrored copy would.
 *
 * Why it exists: `type="number"` cannot hold `1.785,12` — the browser drops the comma, hands back
 * `1.78512`, and the payment was saved as €1.79 instead of €1,785.12. Both separator conventions now
 * parse the same, in both directions.
 *
 * Run: node scripts/verify-amount-input.mjs   (or: npm run test:amount)
 */

import { parseAmountInput, formatAmountInput } from '../src/lib/currency.ts';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, testName) {
  const ok = Object.is(actual, expected);
  if (ok) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    console.error(`          └─ expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log('===============================================================');
console.log('🚀 MONEY INPUT PARSING — VERIFICATION');
console.log('===============================================================\n');

// --- The reported bug ------------------------------------------------------------------------
{
  const pasted = '1.785,12';
  assertEqual(Number(pasted), NaN, "the raw paste is not a number — Number('1.785,12') is NaN");
  // What `type="number"` used to deliver to the app: the comma dropped, dot kept.
  assertEqual(Number('1.78512'), 1.78512, 'the old mangled value was 1.78512, i.e. €1.79');
  assertEqual(parseAmountInput(pasted), 1785.12, 'the pasted 1.785,12 now parses as €1,785.12');
}

// --- Both conventions, and the ambiguity between them ----------------------------------------
{
  const cases = [
    ['1.785,12', 1785.12, 'si-style: dot groups, comma decimal'],
    ['1,785.12', 1785.12, 'en-style: comma groups, dot decimal'],
    ['1785,12', 1785.12, 'bare comma decimal'],
    ['1785.12', 1785.12, 'bare dot decimal'],
    ['1785', 1785, 'no separators at all'],
    ['1.785', 1785, 'one dot with 3 digits behind = thousands, not a decimal'],
    ['1,785', 1785, 'one comma with 3 digits behind = thousands'],
    ['12,5', 12.5, 'one comma with 1 digit behind = decimal'],
    ['12.5', 12.5, 'one dot with 1 digit behind = decimal'],
    ['1.234.567,89', 1234567.89, 'multiple dot groups + comma decimal'],
    ['1,234,567.89', 1234567.89, 'multiple comma groups + dot decimal'],
    ['1.234.567', 1234567, 'multiple separators are all thousands'],
    ['0', 0, 'zero'],
    ['0,00', 0, 'zero with decimals'],
    ['-1.785,12', -1785.12, 'negative amount'],
    ['  2.800,00  ', 2800, 'surrounding whitespace'],
    ['€ 2.800,00', 2800, 'currency symbol'],
    ['1 785,12', 1785.12, 'space as thousands separator'],
    ['1\u00A0785,12', 1785.12, 'non-breaking space as thousands separator'],
    ["1'785.12", 1785.12, 'apostrophe as thousands separator'],
    ['1785,', 1785, 'trailing separator while typing'],
    ['1785.', 1785, 'trailing dot while typing'],
  ];
  for (const [input, expected, name] of cases) {
    assertEqual(parseAmountInput(input), expected, `${JSON.stringify(input)} → ${expected} (${name})`);
  }
}

// --- Nothing usable should never be read as 0 silently ----------------------------------------
{
  assertEqual(parseAmountInput(''), null, 'empty string → null, so the caller picks the fallback');
  assertEqual(parseAmountInput('   '), null, 'whitespace only → null');
  assertEqual(parseAmountInput('abc'), null, 'letters → null');
  assertEqual(parseAmountInput(null), null, 'null → null');
  assertEqual(parseAmountInput(undefined), null, 'undefined → null');
}

// --- Display convention round-trip ------------------------------------------------------------
{
  assertEqual(formatAmountInput(1785.12), '1.785,12', 'amounts display in the app convention');
  assertEqual(formatAmountInput(2800), '2.800,00', 'whole amounts still show cents');
  for (const n of [0, 1.5, 1785.12, 1234567.89, 99.99]) {
    assertEqual(parseAmountInput(formatAmountInput(n)), n, `round-trip ${n} survives format → parse`);
  }
}

console.log(`\n===============================================================`);
console.log(`${failed === 0 ? '✅ ALL CHECKS PASSED' : '❌ FAILURES PRESENT'} — ${passed} passed, ${failed} failed`);
console.log(`================================================================`);

process.exit(failed === 0 ? 0 : 1);
