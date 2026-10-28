import type { CatalogItem, CatalogModule, Contract, Invoice, InvoiceStatus, Project } from '@/lib/types';
import { netInvoices } from '@/lib/invoice-netting';
import { invoiceLinkedContractIds, invoiceProjectIds } from '@/lib/invoice-links';
import { contractChargeMonths, monthKeysBetween, toMonthKey } from '@/lib/revenue-schedule';

/**
 * Maps outgoing invoices onto the revenue schedule's cells so the grid can overlay the months an
 * invoice already covers. An invoice paints every agreement it is linked to (and the agreements of
 * the projects it bills). An invoice with no link at all is attributed to the counterparty's revenue
 * contract whose reference appears on the invoice, or — failing that — whose charged total is
 * closest to the invoice net.
 */

export type InvoiceMarkerPosition = 'start' | 'middle' | 'end';

export interface InvoiceCellCoverage {
  contractId: string;
  paid: boolean;
  /** True while every covering invoice is still a draft — the money is reserved, not yet issued. */
  draft: boolean;
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

/** Change-request cells use the same box model, keyed by project instead of contract. */
export const projectInvoiceCellKey = (projectId: string, month: string) => `${projectId}:${month}`;

const INACTIVE_STATUSES: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(['cancelled']);
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
 * Paints one invoice's month box into a coverage map. `keyFor(month)` decides the cell key, so the
 * same merge rules serve contract rows and change-request rows. Overlapping invoices merge: `paid`
 * is only true when every covering invoice is paid, `draft` only while all are drafts, and the
 * latest issue date drives the asterisk.
 */
function paintInvoiceBox(
  covered: InvoiceCoverageMap,
  invoice: Invoice,
  months: string[],
  ownerId: string,
  keyFor: (month: string) => string
): void {
  if (months.length === 0) return;
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const issuedMonth = toMonthKey(invoice.issue_date);
  const markerMonth = !issuedMonth || issuedMonth < firstMonth
    ? firstMonth
    : issuedMonth > lastMonth
      ? lastMonth
      : issuedMonth;
  const isPaid = invoice.status === 'paid';
  const isDraft = invoice.status === 'draft';
  const issueDate = invoice.issue_date || '';
  const label = invoice.invoice_number || invoice.id;
  const amount = invoiceAmountEur(invoice);

  months.forEach(month => {
    const key = keyFor(month);
    const existing = covered.get(key);
    if (!existing) {
      covered.set(key, {
        contractId: ownerId,
        paid: isPaid,
        draft: isDraft,
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
      contractId: ownerId,
      paid: existing.paid && isPaid,
      draft: existing.draft && isDraft,
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
}

/**
 * Builds `${contractId}:${month}` → coverage for every month an active outgoing invoice bills,
 * drafts included — a draft is money already reserved for those months, so the schedule shows it
 * separately from an issued bill. Overlapping invoices merge into one box: `paid` is only true when
 * every covering invoice is paid, `draft` only while every one of them is still a draft, and the
 * latest issue date drives the asterisk.
 */
export function buildInvoiceCoverage(
  invoices: Invoice[],
  contracts: Contract[],
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = [],
  projects: Array<Pick<Project, 'id' | 'contract_id'>> = []
): InvoiceCoverageMap {
  const contractsById = new Map(contracts.map(contract => [contract.id, contract]));
  const contractsByCounterparty = new Map<string, Contract[]>();
  contracts.forEach(contract => {
    const list = contractsByCounterparty.get(contract.counterparty_id) ?? [];
    list.push(contract);
    contractsByCounterparty.set(contract.counterparty_id, list);
  });

  const outgoing = invoices
    .filter(invoice => invoice.direction === 'outgoing')
    .filter(invoice => !INACTIVE_STATUSES.has(invoice.status))
    .filter(invoice => Boolean(invoice.counterparty_id));

  // Credit notes cancel their invoice rather than paying it, so neither side of the pair may paint
  // an "invoiced" box — and an unmatched credit never covers anything on its own. Drafts are kept
  // out of that pairing (an unissued credit cancels nothing) and added back once the issued set is
  // netted; a draft credit note has no box of its own.
  const drafts = outgoing.filter(invoice => invoice.status === 'draft' && invoice.type !== 'credit_note');
  const issued = outgoing.filter(invoice => invoice.status !== 'draft');
  const ordered = [...netInvoices(issued).active, ...drafts].sort(
    (a, b) => String(a.issue_date || '').localeCompare(String(b.issue_date || '')) || a.id.localeCompare(b.id)
  );

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

    const linkedContracts = invoiceLinkedContractIds(invoice, projects)
      .map(contractId => contractsById.get(contractId))
      .filter((contract): contract is Contract => Boolean(contract));
    // Nothing linked: fall back to the counterparty contract the invoice actually mentions / matches.
    const inferred = linkedContracts.length > 0 ? undefined : pickContract(
      invoice,
      months,
      contractsByCounterparty.get(invoice.counterparty_id) ?? [],
      catalogModules,
      catalogItems
    );
    const targets = linkedContracts.length > 0 ? linkedContracts : inferred ? [inferred] : [];
    if (targets.length === 0) return;

    targets.forEach(contract => {
      paintInvoiceBox(covered, invoice, months, contract.id, month => invoiceCellKey(contract.id, month));
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

/** Box colours per invoice state: paid (bold green), issued but unpaid (light magenta), draft (slate). */
export const INVOICE_BOX_COLORS = {
  paid: { line: 'rgba(21, 128, 61, 0.85)', fill: 'rgba(22, 163, 74, 0.28)', marker: '#14532d' },
  issued: { line: 'rgba(162, 28, 175, 0.55)', fill: 'rgba(217, 70, 239, 0.12)', marker: '#a21caf' },
  draft: { line: 'rgba(100, 116, 139, 0.7)', fill: 'rgba(100, 116, 139, 0.12)', marker: '#475569' },
} as const;

/** Colour of the issue-month asterisk, so it always agrees with its box. */
export function invoiceMarkerColor(coverage: InvoiceCellCoverage): string {
  return coverage.draft
    ? INVOICE_BOX_COLORS.draft.marker
    : coverage.paid
      ? INVOICE_BOX_COLORS.paid.marker
      : INVOICE_BOX_COLORS.issued.marker;
}

/** Inline style painting one cell of the invoice box; contiguous cells share the box outline. */
export function invoiceCellStyle(coverage: InvoiceCellCoverage, month: string): Record<string, string> {
  const palette = coverage.draft
    ? INVOICE_BOX_COLORS.draft
    : coverage.paid
      ? INVOICE_BOX_COLORS.paid
      : INVOICE_BOX_COLORS.issued;
  const line = palette.line;
  const shadows = [`inset 0 2px 0 0 ${line}`, `inset 0 -2px 0 0 ${line}`];
  if (month === coverage.firstMonth) shadows.push(`inset 2px 0 0 0 ${line}`);
  if (month === coverage.lastMonth) shadows.push(`inset -2px 0 0 0 ${line}`);
  return {
    backgroundColor: palette.fill,
    boxShadow: shadows.join(', '),
  };
}

/**
 * Coverage for the change-request rows: an invoice linked to a project paints that project's months.
 * `contractTotal` is left at 0 — the grid fills it with the row's own charges, which it is the only
 * one that knows.
 */
export function buildProjectInvoiceCoverage(
  invoices: Invoice[],
  projects: Array<Pick<Project, 'id' | 'contract_id'>>
): InvoiceCoverageMap {
  const parentByProject = new Map(projects.map(project => [project.id, String(project.contract_id || '')]));
  const outgoing = invoices
    .filter(invoice => invoice.direction === 'outgoing')
    .filter(invoice => !INACTIVE_STATUSES.has(invoice.status))
    .filter(invoice => invoiceProjectIds(invoice).length > 0);

  const drafts = outgoing.filter(invoice => invoice.status === 'draft' && invoice.type !== 'credit_note');
  const issued = outgoing.filter(invoice => invoice.status !== 'draft');
  const ordered = [...netInvoices(issued).active, ...drafts].sort(
    (a, b) => String(a.issue_date || '').localeCompare(String(b.issue_date || '')) || a.id.localeCompare(b.id)
  );

  const covered: InvoiceCoverageMap = new Map();
  ordered.forEach(invoice => {
    const months = invoiceCoveredMonths(invoice);
    if (months.length === 0) return;
    invoiceProjectIds(invoice).forEach(projectId => {
      paintInvoiceBox(covered, invoice, months, parentByProject.get(projectId) ?? '', month => projectInvoiceCellKey(projectId, month));
    });
  });
  return covered;
}
