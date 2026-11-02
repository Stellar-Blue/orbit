import type { Invoice } from '@/lib/types';
import { invoiceLines } from '@/lib/invoice-links';
import { toMonthKey } from '@/lib/revenue-schedule';

/**
 * Which schedule months an invoice bills for one agreement, and how much of it lands in each.
 *
 * An itemised invoice says this itself: every line carries its own amount and its own service
 * window, so a February line of a year-long invoice bills February — the invoice's own period and
 * due date say nothing about it. Only an invoice without lines falls back to its own window. The
 * report that reads this (the MCP `get_billing_status` tool) used to tie the whole invoice to the
 * months its reference period and due date named, which left every other month it billed looking
 * uninvoiced.
 *
 * A segment's amount is booked on the FIRST month it covers, like the contract schedule books an
 * annual charge in one month, so a line spanning several months is never counted once per month.
 */

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export interface InvoiceMonthBill {
  /** True when the invoice bills something in that month, even if its amount sits on an earlier one. */
  covers: boolean;
  /** Net (EUR) of the segments that start in that month — 0 for a month inside a longer segment. */
  amount: number;
}

interface BillSegment {
  from: string;
  to: string;
  amount: number;
}

/** Invoice amounts are stored in the invoice currency; the schedule is expressed in EUR. */
function toEur(amount: unknown, invoice: Invoice): number {
  const value = Number(amount) || 0;
  const rate = Number(invoice.fx_rate) || 1;
  return round2(invoice.currency && invoice.currency !== 'EUR' ? value * rate : value);
}

/** The billed windows of an invoice for one agreement, one per line (or one for the whole invoice). */
export function invoiceBillSegments(invoice: Invoice, contractId: string): BillSegment[] {
  const itemised = invoiceLines(invoice);

  // An itemised invoice bills through its lines alone: one that bills only change requests covers
  // none of this agreement's own months, whatever its invoice-level period says.
  if (itemised.length > 0) {
    const lines = itemised.filter(line => !line.project_id && line.contract_id === contractId);
    return lines.flatMap(line => {
      const from = toMonthKey(line.period_from) || toMonthKey(invoice.period_from);
      if (!from) return [];
      const to = toMonthKey(line.period_to) || toMonthKey(invoice.period_to) || from;
      return [{ from, to: to >= from ? to : from, amount: toEur(line.amount, invoice) }];
    });
  }

  // No itemised lines: the invoice's own service window (falling back to the month it names or was
  // raised in) is all this tool can go on.
  const from =
    toMonthKey(invoice.period_from) || toMonthKey(invoice.reference_period) || toMonthKey(invoice.issue_date);
  if (!from) return [];
  const to = toMonthKey(invoice.period_to) || from;
  return [{ from, to: to >= from ? to : from, amount: toEur(invoice.net, invoice) }];
}

export function invoiceBillsMonth(invoice: Invoice, contractId: string, month: string): InvoiceMonthBill {
  if (!month) return { covers: false, amount: 0 };
  const covering = invoiceBillSegments(invoice, contractId).filter(segment => segment.from <= month && segment.to >= month);
  if (covering.length === 0) return { covers: false, amount: 0 };
  return {
    covers: true,
    amount: round2(covering.reduce((sum, segment) => sum + (segment.from === month ? segment.amount : 0), 0)),
  };
}
