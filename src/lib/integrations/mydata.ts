import { SupabaseClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';
import { getVaultSecret, setVaultSecret, deleteVaultSecret } from './server';

// AADE myDATA REST API v2.0.1 — RequestTransmittedDocs (issued invoices)
// Endpoint returns XML. MARK is the durable cursor. Follows the AADE issued-invoices retrieval guide.
//
// READ-ONLY TOWARD AADE: this integration only RETRIEVES transmitted documents (GET
// RequestTransmittedDocs). It never sends, registers, transmits, or cancels anything with the
// tax authority. All writes go exclusively to the local Supabase database.

const MYDATA_PROD = 'https://mydatapi.aade.gr/myDATA/RequestTransmittedDocs';
const MYDATA_DEV = 'https://mydataapidev.aade.gr/RequestTransmittedDocs';
const USE_DEV = process.env.MYDATA_DEV === 'true';

const USERNAME_SECRET = 'mydata:username';
const KEY_SECRET = 'mydata:subscription_key';

// AADE responses can legitimately contain many entity references (e.g. large multi-page payloads).
// Raise the parser's safety caps well above the defaults (maxTotalExpansions=1000, maxExpandedLength=100KB)
// so legitimate responses aren't rejected as entity-expansion attacks.
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
  processEntities: {
    enabled: true,
    maxTotalExpansions: 1_000_000,
    maxExpandedLength: 50_000_000,
  },
});

export interface MyDataCreds {
  configured: boolean;
  username: string | null;
}

export async function getMyDataCreds(admin: SupabaseClient): Promise<MyDataCreds> {
  const username = await getVaultSecret(admin, USERNAME_SECRET);
  const key = await getVaultSecret(admin, KEY_SECRET);
  return { configured: Boolean(username && key), username };
}

export async function setMyDataCreds(admin: SupabaseClient, username: string, subscriptionKey: string): Promise<void> {
  await setVaultSecret(admin, USERNAME_SECRET, username.trim());
  await setVaultSecret(admin, KEY_SECRET, subscriptionKey.trim());
}

export async function clearMyDataCreds(admin: SupabaseClient): Promise<void> {
  await deleteVaultSecret(admin, USERNAME_SECRET);
  await deleteVaultSecret(admin, KEY_SECRET);
}

// ---- Debug log ----
// Only the username is echoed back; the subscription key is never stored. Response bodies
// contain counterparty AFMs, so the log table is admin-only (see migration 0044).
export interface MyDataLogRow {
  id: string;
  created_at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  detail?: string | null;
  mark?: number | null;
  method?: string | null;
  url?: string | null;
  request_headers?: string | null;
  response_status?: number | null;
  response_body?: string | null;
  duration_ms?: number | null;
}

export interface MyDataRequestLog {
  method?: string | null;
  url?: string | null;
  requestHeaders?: string | null;
  responseStatus?: number | null;
  responseBody?: string | null;
  durationMs?: number | null;
}

async function logMyData(admin: SupabaseClient, level: MyDataLogRow['level'], message: string, detail?: string | null, mark?: number | null, req?: MyDataRequestLog): Promise<void> {
  try {
    await admin.from('aade_sync_logs').insert({
      level,
      message,
      detail: detail || null,
      mark: mark ?? null,
      method: req?.method ?? null,
      url: req?.url ?? null,
      request_headers: req?.requestHeaders ?? null,
      response_status: req?.responseStatus ?? null,
      response_body: req?.responseBody ?? null,
      duration_ms: req?.durationMs ?? null,
    });
  } catch (e) {
    // logging must never break the sync
    console.warn('myDATA log insert failed:', e instanceof Error ? e.message : e);
  }
}

export interface MyDataSyncResult {
  configured: boolean;
  ran: boolean;
  pages: number;
  docsImported: number;
  docsUpdated: number;
  cancellations: number;
  invoicesCreated: number;
  invoicesUpdated: number;
  unmatchedAfm: number;
  skippedErrors: number;
  lastCompletedMark: number;
  error?: string;
}

const asArray = <T>(x: T | T[] | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : []);
const asNum = (x: unknown): number | null => {
  if (x == null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const str = (x: unknown): string | null => (x == null ? null : String(x));

// AADE's Azure gateway wraps responses in <string xmlns="http://schemas.microsoft.com/2003/10/Serialization/">
// containing XML-escaped XML (&lt;?xml ... &lt;/RequestedDoc&gt;). Decode the text node of <string> and
// re-parse the real document. Non-wrapped bodies (e.g. some error responses) pass through unchanged.
function parseAadeXml(xml: string): any {
  const first = parser.parse(xml);
  const wrapped = typeof first.string === 'string' ? first.string : null;
  return wrapped ? parser.parse(wrapped) : first;
}

// Normalise Greek AFM: strip EL/GR prefix (AADE returns bare 9-digit; counterparties store 'EL123456789')
const normAfm = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const s = String(v).replace(/^EL/i, '').replace(/^GR/i, '').replace(/\s+/g, '').trim();
  return s || null;
};

async function fetchWithRetry(url: string, headers: Record<string, string>, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      // GET only, no body — this integration never writes to AADE.
      const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status >= 500 || res.status === 408 || res.status === 429) {
        // transient — retry with backoff
      } else {
        return res;
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 500 * 2 ** i + Math.random() * 200));
  }
  if (lastErr) throw lastErr;
  throw new Error(`AADE request failed after ${attempts} attempts`);
}

// Mirrors the real RequestTransmittedDocs <invoice> element: issuer/counterpart/invoiceHeader/
// invoiceSummary are DIRECT children of <invoice> (there is no nested wrapper element).
interface AadeInvoice {
  uid?: unknown;
  mark?: unknown;
  cancelledByMark?: unknown;
  issuer?: { vatNumber?: unknown; name?: unknown; country?: unknown; branch?: unknown };
  counterpart?: { vatNumber?: unknown; name?: unknown; country?: unknown; branch?: unknown };
  invoiceHeader?: {
    series?: unknown;
    aa?: unknown;
    issueDate?: unknown;
    invoiceType?: unknown;
    currency?: unknown;
    correlatedInvoices?: unknown;
  };
  invoiceDetails?: unknown[];
  invoiceSummary?: { totalNetValue?: unknown; totalVatAmount?: unknown; totalGrossValue?: unknown };
  invoiceFormat?: unknown;
  qrCodeUrl?: unknown;
  isB2G?: unknown;
  downloadingInvoiceUrl?: unknown;
}

interface AadeCancelledInvoice {
  invoiceMark?: unknown;
  cancellationMark?: unknown;
  cancellationDate?: unknown;
}

/**
 * Import issued invoices from AADE myDATA (RequestTransmittedDocs).
 * - STRICTLY READ-ONLY toward AADE: only GET RequestTransmittedDocs, never sends/registers/cancels.
 * - MARK is the durable cursor; advanced only after the full page chain commits.
 * - Idempotent by AADE MARK (docs table unique on mark; invoices matched on invoices.mark).
 * - Cancellations flip local status to 'cancelled' (records are never deleted).
 * - Receiver AFM is matched to an existing counterparty; unmatched docs are counted and skipped
 *   (no phantom counterparties are created).
 */
export async function syncIssuedInvoices(admin: SupabaseClient): Promise<MyDataSyncResult> {
  const creds = await getMyDataCreds(admin);
  const base: MyDataSyncResult = {
    configured: creds.configured,
    ran: false,
    pages: 0,
    docsImported: 0,
    docsUpdated: 0,
    cancellations: 0,
    invoicesCreated: 0,
    invoicesUpdated: 0,
    unmatchedAfm: 0,
    skippedErrors: 0,
    lastCompletedMark: 0,
  };
  if (!creds.configured || !creds.username) {
    return base;
  }
  const key = await getVaultSecret(admin, KEY_SECRET);
  if (!key) return base;

  const endpoint = USE_DEV ? MYDATA_DEV : MYDATA_PROD;
  const headers = {
    'aade-user-id': creds.username,
    'ocp-apim-subscription-key': key,
    Accept: 'application/xml',
  };

  const { data: state } = await admin.from('aade_sync_state').select('last_completed_mark,company_afm').eq('id', 1).maybeSingle();
  let cursor = Number(state?.last_completed_mark || 0);
  const companyAfm = (state?.company_afm as string | null | undefined) || null;
  let maxMark = cursor;
  const processedMarks = new Set<number>();
  const cancelledPairs = new Set<string>();

  const fail = async (error: string): Promise<MyDataSyncResult> => {
    await logMyData(admin, 'error', 'Sync failed', error);
    await admin.from('aade_sync_state').update({ last_error: error }).eq('id', 1);
    return { ...base, ran: true, error, lastCompletedMark: cursor };
  };

  try {
    let continuation: { pk?: string; rk?: string } | null = null;
    let pages = 0;
    await logMyData(admin, 'info', 'Sync started', `endpoint=${USE_DEV ? 'dev' : 'prod'} cursor=${cursor}`);

    do {
      const url = new URL(endpoint);
      url.searchParams.set('mark', String(cursor));
      if (continuation?.pk) url.searchParams.set('nextPartitionKey', continuation.pk);
      if (continuation?.rk) url.searchParams.set('nextRowKey', continuation.rk);

      const startedAt = Date.now();
      const res = await fetchWithRetry(url.toString(), headers);
      const xml = await res.text();
      const durationMs = Date.now() - startedAt;

      // Capture the full request/response for the debug log (subscription key is always redacted)
      const reqLog: MyDataRequestLog = {
        method: 'GET',
        url: url.toString(),
        requestHeaders: `aade-user-id: ${creds.username}\nocp-apim-subscription-key: [REDACTED]\nAccept: application/xml`,
        responseStatus: res.status,
        responseBody: xml,
        durationMs,
      };

      if (!res.ok) {
        // AADE carries business/validation errors in the XML body too
        const msg = `HTTP ${res.status} on page ${pages + 1}`;
        await logMyData(admin, 'error', 'AADE request error', msg, null, reqLog);
        await admin.from('aade_sync_state').update({ last_error: msg }).eq('id', 1);
        return { ...base, ran: true, pages, error: msg, lastCompletedMark: cursor };
      }

      const parsed = parseAadeXml(xml);
      const root = parsed.RequestedDoc || parsed;
      const invoices = asArray(root.invoicesDoc?.invoice as AadeInvoice[] | AadeInvoice | undefined);
      const continuationEl = root.continuationToken as { nextPartitionKey?: unknown; nextRowKey?: unknown } | undefined;
      await logMyData(admin, 'info', `GET RequestTransmittedDocs → ${res.status}`,
        `Page ${pages + 1} · ${invoices.length} document(s) · ${durationMs}ms` + (continuation?.pk ? ' · (continued)' : ''),
        null, reqLog);

      for (const inv of invoices) {
        const mark = asNum(inv.mark);
        if (mark == null) continue;
        if (processedMarks.has(mark)) continue;
        processedMarks.add(mark);
        maxMark = Math.max(maxMark, mark);

        const header = inv.invoiceHeader;
        const summary = inv.invoiceSummary;
        const receiverVat = normAfm(str(inv.counterpart?.vatNumber));

        try {
          // Record raw doc (idempotent by mark)
          const { data: existingDoc } = await admin
            .from('aade_documents')
            .select('id')
            .eq('mark', mark)
            .maybeSingle();

          if (existingDoc) {
            await admin.from('aade_documents').update({
              uid: str(inv.uid),
              issue_date: str(header?.issueDate)?.slice(0, 10) || null,
              invoice_type_code: str(header?.invoiceType),
              series: str(header?.series),
              aa: str(header?.aa),
              receiver_vat_number: receiverVat,
              currency: str(header?.currency),
              net: asNum(summary?.totalNetValue),
              vat: asNum(summary?.totalVatAmount),
              gross: asNum(summary?.totalGrossValue),
              qr_url: str(inv.qrCodeUrl),
              updated_at: new Date().toISOString(),
            }).eq('mark', mark);
            base.docsUpdated += 1;
          } else {
            await admin.from('aade_documents').insert({
              mark,
              uid: str(inv.uid),
              issue_date: str(header?.issueDate)?.slice(0, 10) || null,
              invoice_type_code: str(header?.invoiceType),
              series: str(header?.series),
              aa: str(header?.aa),
              receiver_vat_number: receiverVat,
              currency: str(header?.currency),
              net: asNum(summary?.totalNetValue),
              vat: asNum(summary?.totalVatAmount),
              gross: asNum(summary?.totalGrossValue),
              qr_url: str(inv.qrCodeUrl),
            });
            base.docsImported += 1;
          }

          const cancelledBy = asNum(inv.cancelledByMark);
          if (cancelledBy != null) {
            const pair = `${mark}:${cancelledBy}`;
            if (cancelledPairs.has(pair)) continue;
            cancelledPairs.add(pair);
            base.cancellations += 1;
            // Idempotent: insert-or-ignore on the (invoice_mark, cancellation_mark) unique pair
            await admin.from('aade_cancellations').upsert({
              invoice_mark: mark,
              cancellation_mark: cancelledBy,
            }, { onConflict: 'invoice_mark,cancellation_mark' });
            await admin.from('aade_documents').update({ status: 'cancelled' }).eq('mark', mark);
            await admin.from('invoices').update({ status: 'cancelled' }).eq('mark', String(mark));
            continue;
          }

          await mirrorInvoice(admin, inv, mark, receiverVat, companyAfm, base);
        } catch (e) {
          base.skippedErrors += 1;
          // swallow per-doc errors (e.g. unique-constraint collisions with manually registered invoices)
          console.warn('myDATA per-doc sync error (mark ' + mark + '):', e instanceof Error ? e.message : e);
        }
      }

      // Cancellations may arrive via <cancelledInvoicesDoc> instead of an inline <cancelledByMark>.
      const cancelledDocs = asArray((root.cancelledInvoicesDoc as { cancelledInvoice?: unknown } | undefined)?.cancelledInvoice as AadeCancelledInvoice[] | AadeCancelledInvoice | undefined);
      for (const c of cancelledDocs) {
        const invoiceMark = asNum(c.invoiceMark);
        const cancellationMark = asNum(c.cancellationMark);
        if (invoiceMark == null || cancellationMark == null) continue;
        const pair = `${invoiceMark}:${cancellationMark}`;
        if (cancelledPairs.has(pair)) continue;
        cancelledPairs.add(pair);
        base.cancellations += 1;
        await admin.from('aade_cancellations').upsert({
          invoice_mark: invoiceMark,
          cancellation_mark: cancellationMark,
        }, { onConflict: 'invoice_mark,cancellation_mark' });
        await admin.from('aade_documents').update({ status: 'cancelled' }).eq('mark', invoiceMark);
        await admin.from('invoices').update({ status: 'cancelled' }).eq('mark', String(invoiceMark));
      }

      pages += 1;

      if (continuationEl && continuationEl.nextPartitionKey && continuationEl.nextRowKey) {
        continuation = { pk: String(continuationEl.nextPartitionKey), rk: String(continuationEl.nextRowKey) };
      } else {
        continuation = null;
      }
    } while (continuation);

    // Advance the durable cursor only after the whole chain committed
    cursor = maxMark;
    await admin.from('aade_sync_state').update({
      last_completed_mark: cursor,
      last_success_at: new Date().toISOString(),
      last_error: null,
    }).eq('id', 1);
    await logMyData(admin, 'info', 'Sync completed',
      `pages=${pages} docsImported=${base.docsImported} invoicesCreated=${base.invoicesCreated} cancellations=${base.cancellations} unmatchedAfm=${base.unmatchedAfm} cursor=${cursor}`);

    return { ...base, ran: true, pages, lastCompletedMark: cursor };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

// Mirror a transmitted invoice into the invoices registry as AR (outgoing).
async function mirrorInvoice(
  admin: SupabaseClient,
  inv: AadeInvoice,
  mark: number,
  receiverVat: string | null,
  companyAfm: string | null,
  base: MyDataSyncResult,
): Promise<void> {
  const header = inv.invoiceHeader;
  const summary = inv.invoiceSummary;
  const net = asNum(summary?.totalNetValue) ?? 0;
  const vat = asNum(summary?.totalVatAmount) ?? 0;
  const gross = asNum(summary?.totalGrossValue) ?? (net + vat);
  const issueDate = str(header?.issueDate)?.slice(0, 10);
  if (!issueDate) return; // cannot place an invoice without an issue date
  const currency = str(header?.currency) || 'EUR';
  const typeCode = str(header?.invoiceType) || '';
  const type = typeCode.startsWith('5.') ? 'credit_note' : 'invoice';
  const series = str(header?.series) || '';
  const aa = str(header?.aa) || '';
  const invoiceNumber = series ? `${series}-${aa}` : aa || String(mark);
  const dueDate = new Date(new Date(issueDate + 'T00:00:00').getTime() + 30 * 86400000).toISOString().slice(0, 10);

  // Direction: we ISSUED it when our AFM is the issuer → outgoing (AR), other party = counterpart.
  // Otherwise we RECEIVED it → incoming (AP), other party = issuer. Without a configured company
  // AFM we fall back to treating everything as issued (previous behaviour).
  const issuerVat = normAfm(str(inv.issuer?.vatNumber));
  const myAfm = companyAfm ? normAfm(companyAfm) : null;
  const outgoing = myAfm ? issuerVat === myAfm : true;
  const direction: 'outgoing' | 'incoming' = outgoing ? 'outgoing' : 'incoming';
  const matchVat = outgoing ? receiverVat : issuerVat;
  const vatRate = net > 0 ? `${Math.round((vat / net) * 1000) / 10}%` : '0%';

  // Match the other party by AFM to an existing counterparty
  let counterpartyId: string | null = null;
  if (matchVat) {
    const { data: cp } = await admin
      .from('counterparties')
      .select('id')
      .or(`afm.eq.${matchVat},vat_number.eq.${matchVat},vat_number.eq.EL${matchVat},vat_number.eq.GR${matchVat}`)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    counterpartyId = cp?.id || null;
  }
  if (!counterpartyId) {
    base.unmatchedAfm += 1;
    return;
  }

  const { data: existing } = await admin.from('invoices').select('id').eq('mark', String(mark)).maybeSingle();
  if (existing) {
    await admin.from('invoices').update({
      invoice_number: invoiceNumber,
      type,
      issue_date: issueDate,
      due_date: dueDate,
      period_from: issueDate,
      period_to: dueDate,
      currency,
      net,
      vat_amount: vat,
      vat_rate: vatRate,
      gross,
      gross_eur: gross,
      missing_document: false,
    }).eq('id', existing.id);
    base.invoicesUpdated += 1;
  } else {
    await admin.from('invoices').insert({
      direction,
      counterparty_id: counterpartyId,
      type,
      invoice_number: invoiceNumber,
      mark: String(mark),
      issue_date: issueDate,
      due_date: dueDate,
      period_from: issueDate,
      period_to: dueDate,
      currency,
      fx_rate: 1,
      net,
      vat_amount: vat,
      vat_rate: vatRate,
      gross,
      gross_eur: gross,
      status: 'sent_received',
      missing_document: false,
      created_via: 'api',
      notes: `Imported automatically from AADE myDATA (MARK ${mark}).`,
    });
    base.invoicesCreated += 1;
  }
}
