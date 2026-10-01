import { SupabaseClient } from '@supabase/supabase-js';
import { getVaultSecret, setVaultSecret, deleteVaultSecret } from './server';
import { readPdfText, splitDataUrl } from './pdf-text';
import { parseAmountInput } from '@/lib/currency';

/**
 * DeepSeek document extraction for the payment ledger.
 *
 * The key lives in Supabase Vault, never in `integration_settings` — that table grants SELECT to
 * every authenticated user (`policy_integration_settings_read`), so a key stored there would be
 * readable by all employees through PostgREST.
 *
 * `deepseek-flash` is the only model with vision (V4-Pro has none), which only matters for scanned
 * documents: digital PDFs are sent as extracted text.
 */

const SECRET_NAME = 'deepseek:api_key';
const API_URL = 'https://api.deepseek.com/chat/completions';
/** Only vision-capable DeepSeek model; also the cheapest. */
export const DEEPSEEK_MODEL = 'deepseek-flash';

export async function hasDeepSeekKey(admin: SupabaseClient): Promise<boolean> {
  return !!(await getVaultSecret(admin, SECRET_NAME));
}

export async function setDeepSeekKey(admin: SupabaseClient, key: string): Promise<boolean> {
  return !!(await setVaultSecret(admin, SECRET_NAME, key));
}

export async function clearDeepSeekKey(admin: SupabaseClient): Promise<void> {
  await deleteVaultSecret(admin, SECRET_NAME);
}

/** What the model is asked to return. Everything is nullable: a missing fact must not be invented. */
export interface ExtractedPaymentFields {
  /** Μικτές αποδοχές — the ΑΠΟΔΟΧΕΣ total from the payslip. */
  gross: number | null;
  /** Πληρωτέες/Καθαρές αποδοχές — what the employee actually receives. */
  net: number | null;
  /** `YYYY-MM-DD`. */
  payment_date: string | null;
  /** Bank transfer number on the receipt. */
  bank_reference: string | null;
  /** Name printed on the documents, used to check the right employee's paperwork was attached. */
  employee_name: string | null;
  /** Which printed label each value came from — shown to the admin so a fill can be trusted. */
  evidence: Record<string, string>;
  /** Anything the model noticed but could not resolve (documents disagreeing, unclear field…). */
  warnings: string[];
}

export interface DeepSeekExtractionResult {
  ok: boolean;
  fields?: ExtractedPaymentFields;
  /** Human-readable failure, safe to show in the UI. */
  error?: string;
}

export interface ModelInputPayload {
  name: string;
  /** Document category from the ledger (`receipt`, `payslip`, …). */
  type?: string;
  /** Already-read text (or a decoded image), mainly for tests and future callers. */
  text?: string;
  images?: string[];
  /** The stored document itself; a data URL. PDFs are read here, images are passed through. */
  dataUrl?: string;
}

const SYSTEM_PROMPT = `You extract fields from Greek payroll paperwork for a company payment ledger.
You are given one or more documents for a single employee payment, each preceded by its file name and category.
Reply with a single JSON object and nothing else. Never guess: use null when a document does not state a value.`;

function buildUserPrompt(docs: ModelInputPayload[], context: { employeeName: string; period: string }): string {
  const parts: string[] = [
    `Employee: ${context.employeeName}`,
    `Ledger period: ${context.period}`,
    '',
    'Documents:',
  ];

  docs.forEach((doc, index) => {
    const category = doc.type === 'payslip' ? 'payslip (ΕΞΟΦΛΗΤΙΚΗ ΑΠΟΔΕΙΞΗ ΜΙΣΘΟΔΟΣΙΑΣ / ΑΠΟΔΟΧΕΣ)'
      : doc.type === 'receipt' ? 'bank payment receipt (ΤΡΑΠΕΖΙΚΗ ΜΕΤΑΦΟΡΑ / ΜΙΣΘΟΔΟΣΙΑ)'
      : 'document';
    parts.push(`--- Document ${index + 1}: "${doc.name}" — ${category} ---`);
    if (doc.text) parts.push(doc.text);
    else parts.push('(no text layer — read the image)');
    parts.push('');
  });

  parts.push(`Return exactly this JSON shape:
{
  "gross": number|null,
  "net": number|null,
  "payment_date": "YYYY-MM-DD"|null,
  "bank_reference": string|null,
  "employee_name": string|null,
  "evidence": { "gross": "printed label you read it from", "net": "...", "payment_date": "...", "bank_reference": "..." },
  "warnings": ["anything unclear or contradictory"]
}

Field rules:
- "gross" = ΜΙΚΤΕΣ ΑΠΟΔΟΧΕΣ: the total of the ΑΠΟΔΟΧΕΣ column on the payslip (the Σύνολο line under ΑΠΟΔΟΧΕΣ, e.g. 1.689,61). It is NOT Συνολικός Μισθός, NOT the Σύνολο under ΚΡΑΤΗΣΕΙΣ, and NOT the bank's Συνολική χρέωση.
- "net" = the amount actually paid: Πληρωτέες Αποδοχές or Καθαρές Αποδοχές on the payslip. On the bank receipt that is the Ποσό line. Ignore the bank's own fees (Σύνολο εξόδων / Ανάλυση εξόδων) even though they appear in Συνολική χρέωση.
- "payment_date" = the execution/transaction date on the bank receipt (Χρονοσφραγίδα Συναλλαγής, or Ημ/νία Εκτύπωσης if that is all there is). Only fall back to the payslip's Ημερομηνία Πληρωμής if there is no bank receipt.
- "bank_reference" = the bank's transaction number (Αριθμός συναλλαγής) on the receipt. Do not use the Αιτιολογία text, and never an account number (starts with GR).
- "employee_name" = the employee's name as printed on the payslip (Greek capitals; e.g. Επώνυμο then Όνομα).
- Watch the two Σύνολο totals on a payslip: 1.689,61 is gross (ΑΠΟΔΟΧΕΣ) and 396,70 is deductions (ΚΡΑΤΗΣΕΙΣ). Gross minus deductions should equal the net — use that to check yourself.
- If the payslip and the bank receipt disagree on the paid amount, report both in "warnings".
- Numbers are formatted Greek style: 1.785,12 means 1785.12. Return plain numbers with a dot decimal separator. Do not write prose outside the JSON.`);

  return parts.join('\n');
}

/**
 * Coerce a date the model reported into the `YYYY-MM-DD` the ledger column needs.
 * Greek documents print `30/09/2026`, so that shape is converted rather than thrown away.
 */
export function normalizePaymentDate(value: string | null): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return value;
  const greek = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (greek) {
    const [, d, m, y] = greek;
    const day = Number(d);
    const month = Number(m);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

/** Normalise whatever the model produced into the exact contract, dropping anything unusable. */
export function normalizeExtractedFields(raw: unknown): ExtractedPaymentFields {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const asAmount = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') return parseAmountInput(v);
    return null;
  };
  const asText = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed && !/^(null|n\/?a|-|unknown)$/i.test(trimmed) ? trimmed : null;
  };

  const date = asText(value.payment_date);
  const evidence = value.evidence && typeof value.evidence === 'object'
    ? Object.fromEntries(
        Object.entries(value.evidence as Record<string, unknown>)
          .map(([k, v]) => [k, asText(v)])
          .filter((entry): entry is [string, string] => !!entry[1])
      )
    : {};

  return {
    gross: asAmount(value.gross),
    net: asAmount(value.net),
    // A date the ledger column cannot store is worse than no date.
    payment_date: normalizePaymentDate(date),
    bank_reference: asText(value.bank_reference),
    employee_name: asText(value.employee_name),
    evidence,
    warnings: Array.isArray(value.warnings) ? value.warnings.map(asText).filter((w): w is string => !!w) : [],
  };
}

/** Content blocks for one document — text when we have it, images otherwise. Images must be in `user` messages. */
function documentBlocks(doc: ModelInputPayload): unknown[] {
  if (doc.text) {
    return [{ type: 'text', text: `Text layer of "${doc.name}":\n${doc.text}` }];
  }
  if (doc.images?.length) {
    return [
      { type: 'text', text: `Page images of "${doc.name}":` },
      ...doc.images.map(url => ({ type: 'image_url', image_url: { url } })),
    ];
  }
  return [];
}

/**
 * Resolve stored documents into something the model can read: PDFs become their text layer (read
 * here, on the server), images pass straight through. Files with no usable content are reported back
 * with the reason so the admin is told which attachment was unreadable instead of getting a silent
 * half-extraction.
 */
export async function resolveDocuments(docs: ModelInputPayload[]): Promise<{ readable: ModelInputPayload[]; unreadable: string[] }> {
  const readable: ModelInputPayload[] = [];
  const unreadable: string[] = [];

  for (const doc of docs) {
    if (doc.text || doc.images?.length) { readable.push(doc); continue; }
    if (!doc.dataUrl) { unreadable.push(`${doc.name} (no stored file — it was registered as a placeholder row)`); continue; }

    const kind = splitDataUrl(doc.dataUrl)?.mime || '';
    if (/^image\//i.test(kind)) { readable.push({ ...doc, images: [doc.dataUrl] }); continue; }
    if (/pdf/i.test(kind)) {
      const result = await readPdfText(doc.dataUrl);
      if (result.status === 'text') readable.push({ ...doc, text: result.text });
      else if (result.status === 'no-text-layer') {
        unreadable.push(`${doc.name} (no text layer — it is a scan, so the model would have to see it as an image)`);
      } else {
        // A read failure is OUR problem, never the document's: say what broke.
        unreadable.push(`${doc.name} (could not be read: ${result.detail})`);
      }
      continue;
    }
    unreadable.push(`${doc.name} (unsupported file type)`);
  }

  return { readable, unreadable };
}

/**
 * Send the documents to DeepSeek and return the ledger fields it could read.
 * Never throws — a failure comes back as `{ ok: false, error }` for the UI to show.
 */
export async function extractPaymentFields(
  admin: SupabaseClient,
  docs: ModelInputPayload[],
  context: { employeeName: string; period: string }
): Promise<DeepSeekExtractionResult> {
  const key = await getVaultSecret(admin, SECRET_NAME);
  if (!key) return { ok: false, error: 'No DeepSeek API key configured. Add one in Settings → Integrations.' };

  const { readable, unreadable } = await resolveDocuments(docs);
  if (!readable.length) {
    return { ok: false, error: `None of the attached documents could be read: ${unreadable.join('; ')}` };
  }

  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [{ type: 'text', text: buildUserPrompt(readable, context) }, ...readable.flatMap(documentBlocks)] },
    ],
    // JSON mode keeps the reply parseable without stripping markdown fences.
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 1200,
    stream: false,
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      // Never echo the request: it carries the key in a header and payslips in the body.
      console.error(`deepseek extraction failed: ${res.status}`);
      if (res.status === 401) return { ok: false, error: 'DeepSeek rejected the API key. Update it in Settings → Integrations.' };
      if (res.status === 402) return { ok: false, error: 'DeepSeek account has insufficient balance.' };
      if (res.status === 429) return { ok: false, error: 'DeepSeek is rate limiting this key. Try again shortly.' };
      return { ok: false, error: `DeepSeek request failed (${res.status}).` };
    }

    const payload = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: 'DeepSeek returned an empty response.' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Defensive: a model that wrapped the object in prose or fences.
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return { ok: false, error: 'DeepSeek returned something that was not JSON.' };
      parsed = JSON.parse(match[0]);
    }

    const fields: ExtractedPaymentFields = { ...normalizeExtractedFields(parsed) };
    // Attachments that could not be read are reported even on success, so a half-read pair of
    // documents never looks like a clean extraction.
    if (unreadable.length) fields.warnings.push(`Could not read: ${unreadable.join('; ')}`);
    if (fields.gross === null && fields.net === null && fields.payment_date === null && fields.bank_reference === null) {
      return { ok: false, error: 'DeepSeek could not find any payment details in these documents.' };
    }
    return { ok: true, fields };
  } catch (e) {
    console.error('deepseek extraction error:', e);
    return { ok: false, error: 'Could not reach DeepSeek.' };
  }
}
