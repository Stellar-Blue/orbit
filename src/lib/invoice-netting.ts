/**
 * myDATA does not void an invoice: it cancels it by issuing a credit note against it, so the
 * registry ends up holding both documents, both looking "paid". Revenue, cashflow and schedule
 * coverage must count neither — the money was invoiced and then reversed — while a credit note with
 * nothing to reverse still has to reduce revenue.
 *
 * This module owns that rule so every consumer (reports, schedule coverage, invoice suggestions)
 * agrees on which documents are real.
 */

export interface NettableInvoice {
  id: string;
  /** 'invoice' | 'credit_note' | 'proforma' | 'debit_note' … */
  type?: string | null;
  status?: string | null;
  direction?: string | null;
  counterparty_id?: string | null;
  contract_id?: string | null;
  /** Set when the credit note was registered against a specific invoice. */
  credits_invoice_id?: string | null;
  issue_date?: string | null;
  period_from?: string | null;
  period_to?: string | null;
  gross?: number | null;
  gross_eur?: number | null;
  net?: number | null;
  invoice_number?: string | null;
}

export interface InvoiceNetting<T extends NettableInvoice> {
  /** Invoices that still count, at their own value. Credit notes are never in here. */
  active: T[];
  /** Invoices a credit note reversed — excluded from revenue and coverage. */
  reversed: T[];
  /** Credit notes that cancel an invoice (here or elsewhere) — excluded from revenue. */
  appliedCredits: T[];
  /** Credit notes with nothing to reverse: they reduce revenue by their own value. */
  openCredits: T[];
  /** credit note id → the invoice it reverses. */
  reversedOf: Map<string, string>;
}

const dayKey = (value?: string | null) => (value ? String(value).slice(0, 10) : '');

export const isCreditNote = (invoice: NettableInvoice) => String(invoice.type || '').toLowerCase() === 'credit_note';

export const isCancelledInvoice = (invoice: NettableInvoice) => String(invoice.status || '').toLowerCase() === 'cancelled';

/** Absolute document value used to pair a credit note with its invoice (gross wins over net). */
export function invoiceDocumentValue(invoice: NettableInvoice): number {
  const candidates = [invoice.gross, invoice.gross_eur, invoice.net];
  for (const candidate of candidates) {
    const value = Math.abs(Number(candidate) || 0);
    if (value > 0) return value;
  }
  return 0;
}

interface ReverseTarget<T> {
  target: T | null;
  /** The credit names an invoice that is not in this document set — never guess at another one. */
  external: boolean;
}

function reversedInvoiceFor<T extends NettableInvoice>(credit: T, candidates: T[]): ReverseTarget<T> {
  if (credit.credits_invoice_id) {
    const linked = candidates.find(invoice => invoice.id === credit.credits_invoice_id);
    return { target: linked ?? null, external: !linked };
  }

  const value = invoiceDocumentValue(credit);
  // Without an amount there is nothing safe to pair on.
  if (value <= 0) return { target: null, external: false };

  const creditDay = dayKey(credit.issue_date);
  const pool = candidates.filter(invoice => {
    if (invoice.id === credit.id || isCreditNote(invoice) || isCancelledInvoice(invoice)) return false;
    if (String(invoice.direction || '') !== String(credit.direction || '')) return false;
    if (credit.counterparty_id && invoice.counterparty_id && invoice.counterparty_id !== credit.counterparty_id) return false;
    if (Math.abs(invoiceDocumentValue(invoice) - value) > 0.01) return false;
    // A credit note can only reverse an invoice issued on or before it.
    if (creditDay && dayKey(invoice.issue_date) && dayKey(invoice.issue_date) > creditDay) return false;
    return true;
  });
  if (pool.length <= 1) return { target: pool[0] ?? null, external: false };

  // Identical service window first (the usual "same period, same amount" cancellation), then the
  // most recent invoice before the credit.
  const sameWindow = pool.filter(invoice =>
    dayKey(invoice.period_from) === dayKey(credit.period_from) &&
    dayKey(invoice.period_to) === dayKey(credit.period_to)
  );
  const preferred = sameWindow.length > 0 ? sameWindow : pool;
  return {
    target: [...preferred].sort(
      (a, b) => dayKey(b.issue_date).localeCompare(dayKey(a.issue_date)) || String(b.id).localeCompare(String(a.id))
    )[0],
    external: false,
  };
}

/**
 * Splits a document set into the invoices that still count and the credits that cancel or reduce
 * them. Cancelled documents are dropped outright; an unlinked credit note reverses the invoice that
 * shares its counterparty, direction, amount and (when available) service window.
 */
export function netInvoices<T extends NettableInvoice>(invoices: T[]): InvoiceNetting<T> {
  const usable = invoices.filter(invoice => !isCancelledInvoice(invoice));
  const plain = usable.filter(invoice => !isCreditNote(invoice));
  const credits = usable
    .filter(invoice => isCreditNote(invoice))
    .sort((a, b) => dayKey(a.issue_date).localeCompare(dayKey(b.issue_date)) || String(a.id).localeCompare(String(b.id)));

  const reversedIds = new Set<string>();
  const reversedOf = new Map<string, string>();
  const appliedIds = new Set<string>();
  credits.forEach(credit => {
    const { target, external } = reversedInvoiceFor(credit, plain);
    if (target && !reversedIds.has(target.id)) {
      reversedIds.add(target.id);
      reversedOf.set(credit.id, target.id);
      appliedIds.add(credit.id);
    } else if (external) {
      // It credits an invoice tracked elsewhere: it still cancels money, just not one of these.
      appliedIds.add(credit.id);
    }
  });

  return {
    active: plain.filter(invoice => !reversedIds.has(invoice.id)),
    reversed: plain.filter(invoice => reversedIds.has(invoice.id)),
    appliedCredits: credits.filter(credit => appliedIds.has(credit.id)),
    openCredits: credits.filter(credit => !appliedIds.has(credit.id)),
    reversedOf,
  };
}

/** Flips the money fields of a credit note so a plain sum of the result already nets it out. */
function asNegative<T extends NettableInvoice>(invoice: T): T {
  const clone = { ...invoice } as unknown as Record<string, unknown>;
  ['net', 'gross', 'gross_eur', 'vat_amount'].forEach(key => {
    const value = clone[key];
    if (typeof value === 'number') clone[key] = -Math.abs(value);
  });
  return clone as T;
}

/**
 * The document set a financial total should be built from: reversed invoices and the credit notes
 * that reversed them are gone (they net to zero), while unmatched credit notes stay on as negative
 * amounts so the total still comes down. Ready for plain `gross_eur` sums.
 */
export function accountingInvoices<T extends NettableInvoice>(invoices: T[]): T[] {
  const { active, openCredits } = netInvoices(invoices);
  return [...active, ...openCredits.map(asNegative)];
}

/** Signed EUR value of one accounting document — positive for invoices, negative for open credits. */
export function accountingAmount(invoice: NettableInvoice): number {
  return Number(invoice.gross_eur ?? invoice.gross ?? invoice.net ?? 0) || 0;
}
