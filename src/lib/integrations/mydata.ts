import { SupabaseClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';
import { getVaultSecret, setVaultSecret, deleteVaultSecret } from './server';

// AADE myDATA REST API v2.0.1 — RequestTransmittedDocs (issued invoices)
// Endpoint returns XML. MARK is the durable cursor. Follows the AADE issued-invoices retrieval guide.

const MYDATA_PROD = 'https://mydatapi.aade.gr/myDATA/RequestTransmittedDocs';
const MYDATA_DEV = 'https://mydataapidev.aade.gr/RequestTransmittedDocs';
const USE_DEV = process.env.MYDATA_DEV === 'true';

const USERNAME_SECRET = 'mydata:username';
const KEY_SECRET = 'mydata:subscription_key';

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
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
      const res = await fetch(url, { headers, signal: ctrl.signal });
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

interface AadeInvoice {
  invoiceMark: unknown;
  invoiceUid?: unknown;
  cancelledByMark?: unknown;
  invoice?: {
    issuer?: { vatNumber?: unknown };
    counterparty?: { vatNumber?: unknown; name?: unknown };
    invoiceHeader?: { series?: unknown; aa?: unknown; issueDate?: unknown; invoiceType?: unknown; currency?: unknown };
    invoiceSummary?: { totalNetValue?: unknown; totalVatAmount?: unknown; totalGrossValue?: unknown };
  };
  qrUrl?: unknown;
}

/**
 * Import issued invoices from AADE myDATA (RequestTransmittedDocs).
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

  const { data: state } = await admin.from('aade_sync_state').select('last_completed_mark').eq('id', 1).maybeSingle();
  let cursor = Number(state?.last_completed_mark || 0);
  let maxMark = cursor;
  const processedMarks = new Set<number>();

  const fail = async (error: string): Promise<MyDataSyncResult> => {
    await admin.from('aade_sync_state').update({ last_error: error }).eq('id', 1);
    return { ...base, ran: true, error, lastCompletedMark: cursor };
  };

  try {
    let continuation: { pk?: string; rk?: string } | null = null;
    let pages = 0;

    do {
      const url = new URL(endpoint);
      url.searchParams.set('mark', String(cursor));
      if (continuation?.pk) url.searchParams.set('nextPartitionKey', continuation.pk);
      if (continuation?.rk) url.searchParams.set('nextRowKey', continuation.rk);

      const res = await fetchWithRetry(url.toString(), headers);
      const xml = await res.text();
      if (!res.ok) {
        // AADE carries business/validation errors in the XML body too
        const msg = `HTTP ${res.status}: ${xml.slice(0, 300)}`;
        await admin.from('aade_sync_state').update({ last_error: msg }).eq('id', 1);
        return { ...base, ran: true, pages, error: msg, lastCompletedMark: cursor };
      }

      const parsed = parser.parse(xml);
      const root = parsed.RequestedDoc || parsed;
      const invoices = asArray(root.invoices?.invoice as AadeInvoice[] | AadeInvoice | undefined);
      const continuationEl = root.continuationToken as { nextPartitionKey?: unknown; nextRowKey?: unknown } | undefined;

      for (const inv of invoices) {
        const mark = asNum(inv.invoiceMark);
        if (mark == null) continue;
        if (processedMarks.has(mark)) continue;
        processedMarks.add(mark);
        maxMark = Math.max(maxMark, mark);

        const header = inv.invoice?.invoiceHeader;
        const summary = inv.invoice?.invoiceSummary;
        const receiverVat = normAfm(str(inv.invoice?.counterparty?.vatNumber));

        try {
          // Record raw doc (idempotent by mark)
          const { data: existingDoc } = await admin
            .from('aade_documents')
            .select('id')
            .eq('mark', mark)
            .maybeSingle();

          if (existingDoc) {
            await admin.from('aade_documents').update({
              uid: str(inv.invoiceUid),
              issue_date: str(header?.issueDate)?.slice(0, 10) || null,
              invoice_type_code: str(header?.invoiceType),
              series: str(header?.series),
              aa: str(header?.aa),
              receiver_vat_number: receiverVat,
              currency: str(header?.currency),
              net: asNum(summary?.totalNetValue),
              vat: asNum(summary?.totalVatAmount),
              gross: asNum(summary?.totalGrossValue),
              qr_url: str(inv.qrUrl),
              updated_at: new Date().toISOString(),
            }).eq('mark', mark);
            base.docsUpdated += 1;
          } else {
            await admin.from('aade_documents').insert({
              mark,
              uid: str(inv.invoiceUid),
              issue_date: str(header?.issueDate)?.slice(0, 10) || null,
              invoice_type_code: str(header?.invoiceType),
              series: str(header?.series),
              aa: str(header?.aa),
              receiver_vat_number: receiverVat,
              currency: str(header?.currency),
              net: asNum(summary?.totalNetValue),
              vat: asNum(summary?.totalVatAmount),
              gross: asNum(summary?.totalGrossValue),
              qr_url: str(inv.qrUrl),
            });
            base.docsImported += 1;
          }

          const cancelledBy = asNum(inv.cancelledByMark);
          if (cancelledBy != null) {
            base.cancellations += 1;
            await admin.from('aade_cancellations').insert({
              invoice_mark: mark,
              cancellation_mark: cancelledBy,
            }, { onConflict: 'invoice_mark,cancellation_mark' }).select().single().catch(() => null);
            await admin.from('aade_documents').update({ status: 'cancelled' }).eq('mark', mark);
            await admin.from('invoices').update({ status: 'cancelled' }).eq('mark', String(mark));
            continue;
          }

          await mirrorInvoice(admin, inv, mark, receiverVat, base);
        } catch (e) {
          base.skippedErrors += 1;
          // swallow per-doc errors (e.g. unique-constraint collisions with manually registered invoices)
          console.warn('myDATA per-doc sync error (mark ' + mark + '):', e instanceof Error ? e.message : e);
        }
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
  base: MyDataSyncResult,
): Promise<void> {
  const header = inv.invoice?.invoiceHeader;
  const summary = inv.invoice?.invoiceSummary;
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

  // Match the customer by AFM to an existing counterparty
  let counterpartyId: string | null = null;
  if (receiverVat) {
    const { data: cp } = await admin
      .from('counterparties')
      .select('id')
      .or(`afm.eq.${receiverVat},vat_number.eq.${receiverVat},vat_number.eq.EL${receiverVat},vat_number.eq.GR${receiverVat}`)
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
      vat_rate: vat > 0 ? '24%' : '0%',
      gross,
      gross_eur: gross,
      missing_document: false,
    }).eq('id', existing.id);
    base.invoicesUpdated += 1;
  } else {
    await admin.from('invoices').insert({
      direction: 'outgoing',
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
      vat_rate: vat > 0 ? '24%' : '0%',
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
