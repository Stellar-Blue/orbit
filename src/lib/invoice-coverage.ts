import type { CatalogItem, CatalogModule, Contract, Invoice, InvoiceStatus } from '@/lib/types';
import { contractChargeMonths, monthKeysBetween, toMonthKey } from '@/lib/revenue-schedule';

/**
 * Maps outgoing invoices onto the revenue schedule's cells so the grid can overlay the months an
 * invoice already covers. Most invoices are not linked to a contract (`contract_id` is null), so an
 * unlinked invoice is attributed to the counterparty's revenue contract whose reference appears on
 * the invoice, or — failing that — whose charged total is closest to the invoice net.
 */

export type InvoiceMarkerPosition = 'start' | 'middle' | 'end';

export interface InvoiceCellCoverage {
  contractId: string;
  paid: boolean;
  firstMonth: string;
  lastMonth: string;
  /** Month the invoice was issued; the asterisk is drawn on this cell. */
  markerMonth: string;
  markerPosition: InvoiceMarkerPosition;
  /** Invoice numbers covering this cell, oldest first (capped for the tooltip). */
  invoices: string[];
  /** Ids of the covering invoices, so the grid can open their details. */
  invoiceIds: string[];
  /** Most recent issue date among the covering invoices. */
  issueDate: string;
  /** Invoice net (EUR) of every invoice covering the box. */
  invoiceTotal: number;
  /** The contract's own charges over the box's months — what should have been billed. */
  contractTotal: number;
  /** `invoiceTotal - contractTotal`; 0 when the invoice matches the schedule. */
  variance: number;
}

export type InvoiceVarianceTone = 'match' | 'under' | 'over';

export type InvoiceCoverageMap = Map<string, InvoiceCellCoverage>;

export const invoiceCellKey = (contractId: string, month: string) => `${contractId}:${month}`;

const INACTIVE_STATUSES: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(['draft', 'cancelled']);
const MAX_INVOICE_LABELS = 3;
/** Anything under half a euro is rounding noise, not a billing mismatch. */
const MATCH_TOLERANCE = 0.5;

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

/** Invoice net converted to the EUR the contract schedule is expressed in. */
export function invoiceAmountEur(invoice: Invoice): number {
  const net = Number(invoice.net) || 0;
  const rate = Number(invoice.fx_rate) || 1;
  return round2(invoice.currency && invoice.currency !== 'EUR' ? net * rate : net);
}

/** Which badge colour the invoice/contract comparison earns. */
export function invoiceVarianceTone(coverage: InvoiceCellCoverage): InvoiceVarianceTone {
  if (Math.abs(coverage.variance) < MATCH_TOLERANCE) return 'match';
  return coverage.variance < 0 ? 'under' : 'over';
}

/** Inclusive 'YYYY-MM' months the invoice bills, falling back to its issue month. */
export function invoiceCoveredMonths(invoice: Invoice): string[] {
  const from = toMonthKey(invoice.period_from);
  const to = toMonthKey(invoice.period_to);
  if (from && to) {
    const months = monthKeysBetween(from, to);
    return months.length > 0 ? months : [from];
  }
  if (from || to) return [from ?? (to as string)];
  const issued = toMonthKey(invoice.issue_date);
  return issued ? [issued] : [];
}

/** Where the asterisk sits inside the invoice's month box. */
export function invoiceMarkerPosition(
  markerMonth: string,
  firstMonth: string,
  lastMonth: string
): InvoiceMarkerPosition {
  if (markerMonth <= firstMonth) return 'start';
  if (markerMonth >= lastMonth) return 'end';
  return 'middle';
}

function contractChargedTotal(
  contract: Contract,
  months: string[],
  catalogModules: CatalogModule[],
  catalogItems: CatalogItem[]
): number {
  const charges = contractChargeMonths(contract, catalogModules, catalogItems);
  return months.reduce((total, key) => total + (charges[key] || 0), 0);
}

function invoiceHaystack(invoice: Invoice): string {
  return [invoice.internal_ref, invoice.reference_period, invoice.notes, invoice.invoice_number]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
}

function pickContract(
  invoice: Invoice,
  months: string[],
  candidates: Contract[],
  catalogModules: CatalogModule[],
  catalogItems: CatalogItem[]
): Contract | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const haystack = invoiceHaystack(invoice);
  const referenced = candidates.find(candidate => candidate.reference && haystack.includes(candidate.reference.toUpperCase()));
  if (referenced) return referenced;

  const net = Number(invoice.net) || 0;
  let best = candidates[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  candidates.forEach(candidate => {
    const diff = Math.abs(contractChargedTotal(candidate, months, catalogModules, catalogItems) - net);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  });
  return best;
}

/**
 * Builds `${contractId}:${month}` → coverage for every month an active outgoing invoice bills.
 * Overlapping invoices merge into one box: an unpaid invoice keeps the lighter tint
 * (`paid` is only true when every covering invoice is paid) and the latest issue date drives the
 * asterisk.
 */
export function buildInvoiceCoverage(
  invoices: Invoice[],
  contracts: Contract[],
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = []
): InvoiceCoverageMap {
  const contractsById = new Map(contracts.map(contract => [contract.id, contract]));
  const contractsByCounterparty = new Map<string, Contract[]>();
  contracts.forEach(contract => {
    const list = contractsByCounterparty.get(contract.counterparty_id) ?? [];
    list.push(contract);
    contractsByCounterparty.set(contract.counterparty_id, list);
  });

  const ordered = invoices
    .filter(invoice => invoice.direction === 'outgoing')
    .filter(invoice => !INACTIVE_STATUSES.has(invoice.status))
    .filter(invoice => Boolean(invoice.counterparty_id))
    .sort((a, b) => String(a.issue_date || '').localeCompare(String(b.issue_date || '')) || a.id.localeCompare(b.id));

  const covered: InvoiceCoverageMap = new Map();
  const chargesByContract = new Map<string, Record<string, number>>();
  const chargesFor = (contract: Contract) => {
    let charges = chargesByContract.get(contract.id);
    if (!charges) {
      charges = contractChargeMonths(contract, catalogModules, catalogItems);
      chargesByContract.set(contract.id, charges);
    }
    return charges;
  };

  ordered.forEach(invoice => {
    const months = invoiceCoveredMonths(invoice);
    if (months.length === 0) return;

    const linked = invoice.contract_id ? contractsById.get(invoice.contract_id) : undefined;
    const contract = linked ?? pickContract(
      invoice,
      months,
      contractsByCounterparty.get(invoice.counterparty_id) ?? [],
      catalogModules,
      catalogItems
    );
    if (!contract) return;

    const firstMonth = months[0];
    const lastMonth = months[months.length - 1];
    const issuedMonth = toMonthKey(invoice.issue_date);
    const markerMonth = !issuedMonth || issuedMonth < firstMonth
      ? firstMonth
      : issuedMonth > lastMonth
        ? lastMonth
        : issuedMonth;
    const isPaid = invoice.status === 'paid';
    const issueDate = invoice.issue_date || '';
    const label = invoice.invoice_number || invoice.id;
    const amount = invoiceAmountEur(invoice);

    months.forEach(month => {
      const key = invoiceCellKey(contract.id, month);
      const existing = covered.get(key);
      if (!existing) {
        covered.set(key, {
          contractId: contract.id,
          paid: isPaid,
          firstMonth,
          lastMonth,
          markerMonth,
          markerPosition: invoiceMarkerPosition(markerMonth, firstMonth, lastMonth),
          invoices: [label],
          invoiceIds: [invoice.id],
          issueDate,
          invoiceTotal: amount,
          contractTotal: 0,
          variance: 0,
        });
        return;
      }

      const mergedFirst = firstMonth < existing.firstMonth ? firstMonth : existing.firstMonth;
      const mergedLast = lastMonth > existing.lastMonth ? lastMonth : existing.lastMonth;
      const latestMarker = markerMonth >= existing.markerMonth ? markerMonth : existing.markerMonth;
      covered.set(key, {
        contractId: contract.id,
        paid: existing.paid && isPaid,
        firstMonth: mergedFirst,
        lastMonth: mergedLast,
        markerMonth: latestMarker,
        markerPosition: invoiceMarkerPosition(latestMarker, mergedFirst, mergedLast),
        invoices: existing.invoices.includes(label)
          ? existing.invoices
          : [...existing.invoices, label].slice(-MAX_INVOICE_LABELS),
        invoiceIds: existing.invoiceIds.includes(invoice.id)
          ? existing.invoiceIds
          : [...existing.invoiceIds, invoice.id].slice(-MAX_INVOICE_LABELS),
        issueDate: issueDate > existing.issueDate ? issueDate : existing.issueDate,
        invoiceTotal: round2(existing.invoiceTotal + amount),
        contractTotal: 0,
        variance: 0,
      });
    });
  });

  // The comparison only makes sense once a box has absorbed every overlapping invoice, so the
  // contract side is summed over the final month range in a second pass.
  covered.forEach(entry => {
    const contract = contractsById.get(entry.contractId);
    const charges = contract ? chargesFor(contract) : {};
    entry.contractTotal = round2(
      monthKeysBetween(entry.firstMonth, entry.lastMonth).reduce((total, month) => total + (charges[month] || 0), 0)
    );
    entry.variance = round2(entry.invoiceTotal - entry.contractTotal);
  });

  return covered;
}

/** Inline style painting one cell of the invoice box; contiguous cells share the box outline. */
export function invoiceCellStyle(coverage: InvoiceCellCoverage, month: string): Record<string, string> {
  const line = coverage.paid ? 'rgba(21, 128, 61, 0.85)' : 'rgba(22, 163, 74, 0.55)';
  const shadows = [`inset 0 2px 0 0 ${line}`, `inset 0 -2px 0 0 ${line}`];
  if (month === coverage.firstMonth) shadows.push(`inset 2px 0 0 0 ${line}`);
  if (month === coverage.lastMonth) shadows.push(`inset -2px 0 0 0 ${line}`);
  return {
    backgroundColor: coverage.paid ? 'rgba(22, 163, 74, 0.28)' : 'rgba(34, 197, 94, 0.13)',
    boxShadow: shadows.join(', '),
  };
}
