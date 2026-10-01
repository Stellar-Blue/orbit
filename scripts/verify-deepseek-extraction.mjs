/**
 * Verification — DeepSeek payment extraction (`src/lib/integrations/deepseek.ts`).
 *
 * Imports the REAL module (see `scripts/lib/ts-alias-loader.mjs`) and stubs `fetch`, so this covers
 * the prompt it sends, the request shape and the response handling without needing an API key or
 * touching the network. The only thing not covered here is DeepSeek's actual reply — run the button
 * once with a real key to confirm end to end.
 *
 * Run: node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-deepseek-extraction.mjs
 *      (or: npm run test:deepseek)
 */

import { extractPaymentFields, normalizeExtractedFields, normalizePaymentDate, resolveDocuments, DEEPSEEK_MODEL } from '../src/lib/integrations/deepseek.ts';
import { readFileSync } from 'node:fs';

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

function equal(actual, expected, testName) {
  check(Object.is(actual, expected), testName, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Admin stub: only the vault RPC matters to the module. */
const adminWithKey = (key) => ({ rpc: async () => ({ data: key, error: null }) });

/** Vault RPC for the token itself is case-sensitive; only the deepseek secret should resolve. */
const adminNamed = (name, value) => ({ rpc: async ({ p_name }) => ({ data: p_name === name ? value : null, error: null }) });

const PAYSLIP_TEXT = 'ΕΞΟΦΛΗΤΙΚΗ ΑΠΟΔΕΙΞΗ ΜΙΣΘΟΔΟΣΙΑΣ ΑΠΟΔΟΧΕΣ ΚΡΑΤΗΣΕΙΣ Σύνολο 1.689,61 Σύνολο 396,70 Καθαρές Αποδοχές 1.292,91 Πληρωτέες Αποδοχές 1.292,91';
const RECEIPT_TEXT = 'ΜΕΤΑΦΟΡΑ ΣΕ ΤΡΑΠΕΖΑ ΕΣΩΤΕΡΙΚΟΥ Αριθμός συναλλαγής: 700BCP36CAU Ποσό: 1.292,91 € Αιτιολογία: ΜΙΣΘΟΔΟΣΙΑ Χρονοσφραγίδα Συναλλαγής: 30/09/2026 11:34:59';

const DOCS = [
  { name: 'ΑΠΟΔΟΧΕΣ ΣΕΠΤΕΜΒΡΙΟΣ 2026-2.pdf', type: 'payslip', text: PAYSLIP_TEXT },
  { name: '2026-09-30 Μισθοδοσία Βασιλειαδης.pdf', type: 'receipt', text: RECEIPT_TEXT },
];

console.log('===============================================================');
console.log('🚀 DEEPSEEK PAYMENT EXTRACTION — VERIFICATION');
console.log('===============================================================\n');

// --- Field coercion --------------------------------------------------------------------------
{
  const f = normalizeExtractedFields({
    gross: '1.689,61',
    net: '1.292,91',
    payment_date: '2026-09-30',
    bank_reference: ' 700BCP36CAU ',
    employee_name: 'ΒΑΣΙΛΕΙΑΔΗΣ ΒΑΣΙΛΕΙΟΣ',
    evidence: { gross: 'Σύνολο (ΑΠΟΔΟΧΕΣ)', net: 'Πληρωτέες Αποδοχές', junk: '' },
    warnings: ['amounts agree', '', null],
  });
  equal(f.gross, 1689.61, 'Greek-formatted string amount becomes a number');
  equal(f.net, 1292.91, 'net parsed');
  equal(f.payment_date, '2026-09-30', 'ISO date kept');
  equal(f.bank_reference, '700BCP36CAU', 'bank reference trimmed');
  equal(f.employee_name, 'ΒΑΣΙΛΕΙΑΔΗΣ ΒΑΣΙΛΕΙΟΣ', 'employee name kept');
  equal(Object.keys(f.evidence).length, 2, 'empty evidence entries dropped');
  equal(f.warnings.length, 1, 'non-string warnings dropped');
}

// --- Sloppy model output ---------------------------------------------------------------------
{
  const f = normalizeExtractedFields({
    gross: 1689.61,
    net: null,
    payment_date: '30/09/2026',
    bank_reference: 'N/A',
    employee_name: 'null',
    warnings: 'not-an-array',
  });
  equal(f.gross, 1689.61, 'numeric amount passes through');
  equal(f.net, null, 'null stays null — never invented');
  equal(f.payment_date, '2026-09-30', 'Greek DD/MM/YYYY date converted');
  equal(f.bank_reference, null, '"N/A" treated as absent');
  equal(f.employee_name, null, '"null" string treated as absent');
  equal(f.warnings.length, 0, 'non-array warnings ignored');

  const empty = normalizeExtractedFields({});
  check(
    empty.gross === null && empty.net === null && empty.payment_date === null && empty.bank_reference === null,
    'an empty object yields all nulls'
  );
  const junk = normalizeExtractedFields('not json');
  check(junk.gross === null && junk.warnings.length === 0, 'a non-object payload is tolerated');
}

// --- Date shapes -----------------------------------------------------------------------------
{
  const cases = [
    ['2026-09-30', '2026-09-30'], ['30/09/2026', '2026-09-30'], ['30-09-2026', '2026-09-30'],
    ['30.09.2026', '2026-09-30'], ['1/7/2026', '2026-07-01'], ['2026/09/30', null],
    ['30/13/2026', null], ['', null], ['30 September 2026', null],
  ];
  for (const [input, expected] of cases) {
    equal(normalizePaymentDate(input), expected, `date ${JSON.stringify(input)} → ${JSON.stringify(expected)}`);
  }
}

// --- Failure paths before any network call ---------------------------------------------------
{
  const noKey = await extractPaymentFields(adminWithKey(null), DOCS, { employeeName: 'X', period: '2026-09' });
  check(noKey.ok === false && /No DeepSeek API key/.test(noKey.error || ''), 'no key → clear "configure in Settings" error', noKey.error);

  const wrongSecret = await extractPaymentFields(adminNamed('slack_token:abc', 'sk-real'), DOCS, { employeeName: 'X', period: '2026-09' });
  check(wrongSecret.ok === false && /No DeepSeek API key/.test(wrongSecret.error || ''), 'a key stored under another name is not used', wrongSecret.error);

  const unreadable = await extractPaymentFields(adminWithKey('sk-test'), [{ name: 'scan.pdf' }], { employeeName: 'X', period: '2026-09' });
  check(unreadable.ok === false && /could be read/.test(unreadable.error || ''), 'documents with no text and no images → explicit error', unreadable.error);
}

// --- A read failure must never be reported as a scan ------------------------------------------
// The reported bug: pdfjs was bundled, so its fake worker failed and EVERY read threw. The error was
// swallowed and reported as "a scan with an empty text layer", blaming the customer's files.
{
  const placeholder = await resolveDocuments([{ name: 'voucher.pdf', type: 'receipt' }]);
  check(
    placeholder.unreadable.length === 1 && /placeholder row|no stored file/i.test(placeholder.unreadable[0]),
    'a metadata-only placeholder row is reported as such, not as a scan',
    placeholder.unreadable[0]
  );

  const corrupt = await resolveDocuments([{ name: 'broken.pdf', type: 'receipt', dataUrl: 'data:application/pdf;base64,bm90LWEtcGRm' }]);
  check(corrupt.readable.length === 0 && corrupt.unreadable.length === 1, 'a PDF that cannot be opened is reported as unreadable');
  check(/could not be read/i.test(corrupt.unreadable[0]), 'and says it could not be read', corrupt.unreadable[0]);
  check(!/scan/i.test(corrupt.unreadable[0]), 'and is NOT mislabelled as a scan', corrupt.unreadable[0]);

  // The bundler trap that caused all of the above: pdfjs must stay outside the server bundle, or its
  // fake worker path is rewritten to a chunk that does not exist.
  const nextConfig = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
  check(/serverExternalPackages\s*:\s*\[[^\]]*['"]pdfjs-dist['"]/.test(nextConfig),
    'next.config.ts keeps pdfjs-dist out of the server bundle (serverExternalPackages)',
    'without this, every PDF read throws "Setting up fake worker failed" at runtime');

  // An image attachment is vision input and needs no PDF machinery at all.
  const image = await resolveDocuments([{ name: 'photo.jpg', type: 'receipt', dataUrl: 'data:image/jpeg;base64,AAAA' }]);
  check(image.readable[0]?.images?.length === 1, 'an image attachment becomes a vision block');
}

// --- The request it sends --------------------------------------------------------------------
let captured = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  captured = { url, init, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      gross: '1.689,61', net: '1.292,91', payment_date: '30/09/2026',
      bank_reference: '700BCP36CAU', employee_name: 'ΒΑΣΙΛΕΙΑΔΗΣ ΒΑΣΙΛΕΙΟΣ',
      evidence: { gross: 'Σύνολο (ΑΠΟΔΟΧΕΣ)' }, warnings: [],
    }) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

try {
  const ok = await extractPaymentFields(adminWithKey('sk-secret-key'), DOCS, { employeeName: 'Vasileios Vasileiadis', period: '2026-09' });

  check(captured.url === 'https://api.deepseek.com/chat/completions', 'posts to the DeepSeek chat endpoint', captured.url);
  equal(captured.init.method, 'POST', 'uses POST');
  equal(captured.init.headers.Authorization, 'Bearer sk-secret-key', 'sends the key as a bearer token to DeepSeek only');
  equal(captured.body.model, DEEPSEEK_MODEL, `uses ${DEEPSEEK_MODEL} (the vision-capable model)`);
  equal(captured.body.model, 'deepseek-flash', 'model name is deepseek-flash');
  equal(captured.body.response_format.type, 'json_object', 'asks for JSON output');
  equal(captured.body.stream, false, 'requests a non-streamed reply');

  const userContent = captured.body.messages[1].content;
  const promptText = userContent[0].text;
  check(Array.isArray(userContent) && userContent.length > 1, 'user message carries content blocks');
  check(promptText.includes('ΑΠΟΔΟΧΕΣ ΣΕΠΤΕΜΒΡΙΟΣ 2026-2.pdf'), 'names the payslip it was given');
  check(promptText.includes('ΜΙΚΤΕΣ ΑΠΟΔΟΧΕΣ'), 'tells the model which printed label is gross');
  check(promptText.includes('Πληρωτέες Αποδοχές'), 'tells the model which printed label is net');
  check(promptText.includes('Αριθμός συναλλαγής'), 'tells the model where the bank reference lives');
  check(promptText.includes('Vasileios Vasileiadis'), 'includes the employee name as context');
  check(userContent.some(b => b.type === 'text' && b.text.includes('700BCP36CAU')), 'sends the extracted receipt text');
  check(!userContent.some(b => b.type === 'image_url'), 'digital PDFs are sent as text, not images');
  check(captured.body.messages[0].role === 'system', 'system prompt first');

  check(ok.ok === true, 'a valid reply is accepted', ok.error);
  equal(ok.fields.gross, 1689.61, 'gross returned as a number');
  equal(ok.fields.net, 1292.91, 'net returned as a number');
  equal(ok.fields.payment_date, '2026-09-30', 'payment date returned in ledger format');
  equal(ok.fields.bank_reference, '700BCP36CAU', 'bank reference returned');
} finally {
  globalThis.fetch = originalFetch;
}

// --- Scanned documents go as images ----------------------------------------------------------
{
  let body = null;
  globalThis.fetch = async (url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"net": 100}' } }] }), { status: 200 });
  };
  try {
    await extractPaymentFields(adminWithKey('sk-test'), [
      { name: 'receipt.pdf', type: 'receipt', images: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'] },
    ], { employeeName: 'X', period: '2026-09' });
    const blocks = body.messages[1].content;
    equal(blocks.filter(b => b.type === 'image_url').length, 2, 'both scanned pages are sent as image blocks');
    check(blocks.every(b => b.type !== 'text' || !b.text.includes('could not be read')), 'readable scans are not reported as unreadable');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --- Bad replies -----------------------------------------------------------------------------
{
  const withReply = async (status, content) => {
    globalThis.fetch = async () => new Response(content, { status });
    try {
      return await extractPaymentFields(adminWithKey('sk-test'), DOCS, { employeeName: 'X', period: '2026-09' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  const unauthorized = await withReply(401, 'nope');
  check(unauthorized.ok === false && /rejected the API key/.test(unauthorized.error || ''), '401 → actionable key message', unauthorized.error);

  const broke = await withReply(402, 'no balance');
  check(broke.ok === false && /balance/.test(broke.error || ''), '402 → balance message', broke.error);

  const fenced = await withReply(200, JSON.stringify({ choices: [{ message: { content: '```json\n{"net": 1292.91, "gross": 1689.61}\n```' } }] }));
  check(fenced.ok === true && fenced.fields.net === 1292.91, 'a reply wrapped in markdown fences still parses');

  const nothingFound = await withReply(200, JSON.stringify({ choices: [{ message: { content: '{"gross": null, "net": null, "payment_date": null, "bank_reference": null}' } }] }));
  check(nothingFound.ok === false && /could not find any payment details/.test(nothingFound.error || ''), 'an all-null reply reports "nothing found" instead of filling nothing', nothingFound.error);

  const empty = await withReply(200, JSON.stringify({ choices: [{ message: { content: '' } }] }));
  check(empty.ok === false, 'an empty completion is an error, not a silent no-op');

  globalThis.fetch = async () => { throw new Error('network down'); };
  const offline = await extractPaymentFields(adminWithKey('sk-test'), DOCS, { employeeName: 'X', period: '2026-09' });
  globalThis.fetch = originalFetch;
  check(offline.ok === false && /Could not reach/.test(offline.error || ''), 'a network failure surfaces instead of throwing', offline.error);
}

console.log(`\n===============================================================`);
console.log(`${failed === 0 ? '✅ ALL CHECKS PASSED' : '❌ FAILURES PRESENT'} — ${passed} passed, ${failed} failed`);
console.log(`================================================================`);

process.exit(failed === 0 ? 0 : 1);
