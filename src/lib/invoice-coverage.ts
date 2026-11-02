import type { CatalogItem, CatalogModule, Contract, Invoice, InvoiceLine, InvoiceStatus, Project, Receipt } from '@/lib/types';
import { netInvoices } from '@/lib/invoice-netting';
import { invoiceContractIds, invoiceLines, invoiceLineTargets, invoiceProjectIds, normalizeLinkIds } from '@/lib/invoice-links';
import { contractChargeMonths, contractProjectSchedules, monthKeysBetween, toMonthKey } from '@/lib/revenue-schedule';

/**
 * Maps outgoing invoices — and receipts, the money that arrived without a tax document — onto the
 * revenue schedule's cells so the grid can overlay the months they cover. An invoice paints every
 * agreement it is linked to (and the agreements of the projects it bills). An invoice with no link
 * at all is attributed to the counterparty's revenue contract whose reference appears on the
 * invoice, or — failing that — whose charged total is closest to the invoice net. A receipt paints
 * only where it is explicitly linked, and always as paid.
 */

export type InvoiceMarkerPosition = 'start' | 'middle' | 'end';

export interface InvoiceCellCoverage {
  contractId: string;
  paid: boolean;
  /** True while every covering invoice is still a draft — the money is reserved, not yet issued. */
  draft: boolean;
  /**
   * True while a covering invoice is issued but unpaid — the only state that says money is owed.
   * It is tracked on its own because "not paid" is not the same thing: a box that mixes a paid
   * invoice with a draft one has nothing outstanding, so it stays in the draft state.
   */
  unpaid: boolean;
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
  /**
   * Invoiced money (EUR) this row's box accounts for: the matching lines of invoices that have lines,
   * the whole net of those that do not.
   */
  invoiceTotal: number;
  /** Full net (EUR) of each covering invoice, by id — the "of €…" total the badge quotes. */
  documentNets: Record<string, number>;
  /** Descriptions of the invoice lines behind the box, for the tooltip. */
  lines: string[];
  /** Receipt money (EUR) — paid without a tax document — covering the box. */
  receiptTotal: number;
  /** Labels of the receipts covering the box, oldest first. */
  receipts: string[];
  /**
   * What the box's money should come to: this contract's charges over the box's months, plus what
   * else its invoices bill (other agreements' fees, change requests) — so a multi-agreement invoice
   * is measured against all of it.
   */
  contractTotal: number;
  /** `invoiceTotal + receiptTotal - contractTotal`; 0 when the coverage matches the schedule. */
  variance: number;
}

export type InvoiceVarianceTone = 'match' | 'under' | 'over';

/** How a box reads: settled (green), invoiced but unpaid (magenta), or still draft (slate). */
export type InvoiceBoxState = 'paid' | 'issued' | 'draft';

/**
 * A box mixing a paid invoice with a draft one owes nothing yet, so it reads as a draft; only an
 * issued invoice that is actually unpaid turns it into an "invoiced" box.
 */
export function invoiceBoxState(coverage: InvoiceCellCoverage): InvoiceBoxState {
  if (coverage.unpaid) return 'issued';
  return coverage.paid ? 'paid' : 'draft';
}

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

/** Total net of the invoices behind the box (each counted once), whatever share of it this row holds. */
export function documentTotal(coverage: InvoiceCellCoverage): number {
  return round2(Object.values(coverage.documentNets).reduce((total, net) => total + net, 0));
}

/** A line's net converted to EUR at its invoice's rate. */
export function invoiceLineAmountEur(invoice: Invoice, line: InvoiceLine): number {
  const amount = Number(line.amount) || 0;
  const rate = Number(invoice.fx_rate) || 1;
  return round2(invoice.currency && invoice.currency !== 'EUR' ? amount * rate : amount);
}

/** Months a line bills: its own period, else the invoice's. */
export function invoiceLineMonths(invoice: Invoice, line: InvoiceLine): string[] {
  const from = toMonthKey(line.period_from);
  const to = toMonthKey(line.period_to);
  if (from || to) return monthKeysBetween(from ?? (to as string), to ?? (from as string));
  return invoiceCoveredMonths(invoice);
}

/** One target's part of an invoice line, in EUR. */
export interface InvoiceLineShare {
  kind: 'contract' | 'project';
  id: string;
  amount: number;
}

/**
 * Splits invoice lines across what each bills, in EUR: in proportion to what every target expects
 * over the line's months — a change request with nothing scheduled there weighs its budget, as it is
 * often billed in one lump — and evenly when nothing is expected at all. A one-target line keeps its
 * whole amount, and the last share absorbs rounding so the shares always add up to the line.
 */
export function createInvoiceLineAllocator(
  contracts: Contract[],
  projects: Project[],
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = []
): (invoice: Invoice, line: InvoiceLine) => { months: string[]; shares: InvoiceLineShare[] } {
  const contractsById = new Map(contracts.map(contract => [contract.id, contract]));
  const projectsById = new Map(projects.map(project => [project.id, project]));
  const charges = new Map<string, Record<string, number>>();
  const projectMonths = new Map<string, Record<string, number>>();
  const chargesOf = (contractId: string) => {
    if (!charges.has(contractId)) {
      const contract = contractsById.get(contractId);
      charges.set(contractId, contract ? contractChargeMonths(contract, catalogModules, catalogItems) : {});
    }
    return charges.get(contractId)!;
  };
  const projectMonthsOf = (projectId: string) => {
    if (!projectMonths.has(projectId)) {
      const parent = contractsById.get(String(projectsById.get(projectId)?.contract_id || ''));
      (parent ? contractProjectSchedules(parent, projects) : []).forEach(entry => projectMonths.set(entry.project.id, entry.months));
      if (!projectMonths.has(projectId)) projectMonths.set(projectId, {});
    }
    return projectMonths.get(projectId)!;
  };
  const sumOver = (months: string[], amounts: Record<string, number>) =>
    months.reduce((total, month) => total + (amounts[month] || 0), 0);

  return (invoice, line) => {
    const months = invoiceLineMonths(invoice, line);
    const total = invoiceLineAmountEur(invoice, line);
    const { contractIds, projectIds } = invoiceLineTargets(line);
    const targets: Array<Omit<InvoiceLineShare, 'amount'>> = [
      ...contractIds.map(id => ({ kind: 'contract' as const, id })),
      ...projectIds.map(id => ({ kind: 'project' as const, id })),
    ];
    if (targets.length <= 1) return { months, shares: targets.map(target => ({ ...target, amount: total })) };

    const weights = targets.map(target => target.kind === 'contract'
      ? sumOver(months, chargesOf(target.id))
      : sumOver(months, projectMonthsOf(target.id)) || Number(projectsById.get(target.id)?.budget_value) || 0);
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    let allocated = 0;
    const shares = targets.map((target, index) => {
      const amount = index === targets.length - 1
        ? round2(total - allocated)
        : round2(weightTotal > 0 ? (total * weights[index]) / weightTotal : total / targets.length);
      allocated += amount;
      return { ...target, amount };
    });
    return { months, shares };
  };
}

/** The tooltip label of a line, saying when it is split across several agreements or projects. */
const lineLabel = (line: InvoiceLine, shares: number) =>
  `${line.description?.trim() || 'Invoice line'}${shares > 1 ? ` (split across ${shares})` : ''}`;

/** Every euro that covers the box: invoices plus receipts paid without a tax document. */
export function coverageTotal(coverage: InvoiceCellCoverage): number {
  return round2(coverage.invoiceTotal + coverage.receiptTotal);
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

/** Inclusive 'YYYY-MM' months a receipt covers — its stated period, else the month the money landed. */
export function receiptCoveredMonths(receipt: Pick<Receipt, 'period_from' | 'period_to' | 'received_on'>): string[] {
  const from = toMonthKey(receipt.period_from);
  const to = toMonthKey(receipt.period_to);
  if (from && to) {
    const months = monthKeysBetween(from, to);
    return months.length > 0 ? months : [from];
  }
  if (from || to) return [from ?? (to as string)];
  const received = toMonthKey(receipt.received_on);
  return received ? [received] : [];
}

/** Short label the schedule shows for a receipt: its bank reference, else the value date. */
export function receiptLabel(receipt: Pick<Receipt, 'bank_reference' | 'received_on'>): string {
  const reference = String(receipt.bank_reference ?? '').trim();
  return reference || `Receipt ${receipt.received_on}`;
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
  keyFor: (month: string) => string,
  share: { amount: number; line?: string | null } = { amount: invoiceAmountEur(invoice) }
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
  const isUnpaid = !isPaid && !isDraft;
  const issueDate = invoice.issue_date || '';
  const label = invoice.invoice_number || invoice.id;
  const amount = share.amount;
  const net = invoiceAmountEur(invoice);
  const lineLabel = share.line?.trim();

  months.forEach(month => {
    const key = keyFor(month);
    const existing = covered.get(key);
    if (!existing) {
      covered.set(key, {
        contractId: ownerId,
        paid: isPaid,
        draft: isDraft,
        unpaid: isUnpaid,
        firstMonth,
        lastMonth,
        markerMonth,
        markerPosition: invoiceMarkerPosition(markerMonth, firstMonth, lastMonth),
        invoices: [label],
        invoiceIds: [invoice.id],
        issueDate,
        invoiceTotal: amount,
        documentNets: { [invoice.id]: net },
        lines: lineLabel ? [lineLabel] : [],
        receiptTotal: 0,
        receipts: [],
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
      documentNets: { ...existing.documentNets, [invoice.id]: net },
      lines: lineLabel && !existing.lines.includes(lineLabel)
        ? [...existing.lines, lineLabel].slice(-MAX_INVOICE_LABELS)
        : existing.lines,
      paid: existing.paid && isPaid,
      draft: existing.draft && isDraft,
      unpaid: existing.unpaid || isUnpaid,
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
      receiptTotal: existing.receiptTotal,
      receipts: existing.receipts,
      contractTotal: 0,
      variance: 0,
    });
  });
}

/**
 * Paints a receipt — money that arrived without a tax document — into the same box model. Receipts
 * always mean cash in hand, so they force the box to `paid` even over a draft invoice, and their
 * amount is tracked separately so the badge can show invoiced vs. un-invoiced money.
 */
function paintReceiptBox(
  covered: InvoiceCoverageMap,
  receipt: Receipt,
  months: string[],
  ownerId: string,
  keyFor: (month: string) => string
): void {
  if (months.length === 0) return;
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const receivedMonth = toMonthKey(receipt.received_on);
  const markerMonth = !receivedMonth || receivedMonth < firstMonth
    ? firstMonth
    : receivedMonth > lastMonth
      ? lastMonth
      : receivedMonth;
  const label = receiptLabel(receipt);
  const amount = round2(Number(receipt.amount_eur) || 0);

  months.forEach(month => {
    const key = keyFor(month);
    const existing = covered.get(key);
    if (!existing) {
      covered.set(key, {
        contractId: ownerId,
        paid: true,
        draft: false,
        unpaid: false,
        firstMonth,
        lastMonth,
        markerMonth,
        markerPosition: invoiceMarkerPosition(markerMonth, firstMonth, lastMonth),
        invoices: [],
        invoiceIds: [],
        issueDate: '',
        invoiceTotal: 0,
        documentNets: {},
        lines: [],
        receiptTotal: amount,
        receipts: [label],
        contractTotal: 0,
        variance: 0,
      });
      return;
    }

    const mergedFirst = firstMonth < existing.firstMonth ? firstMonth : existing.firstMonth;
    const mergedLast = lastMonth > existing.lastMonth ? lastMonth : existing.lastMonth;
    const latestMarker = markerMonth >= existing.markerMonth ? markerMonth : existing.markerMonth;
    covered.set(key, {
      ...existing,
      paid: true,
      draft: false,
      unpaid: false,
      firstMonth: mergedFirst,
      lastMonth: mergedLast,
      markerMonth: latestMarker,
      markerPosition: invoiceMarkerPosition(latestMarker, mergedFirst, mergedLast),
      receipts: existing.receipts.includes(label)
        ? existing.receipts
        : [...existing.receipts, label].slice(-MAX_INVOICE_LABELS),
      receiptTotal: round2(existing.receiptTotal + amount),
    });
  });
}

/**
 * Builds `${contractId}:${month}` → coverage for every month an active outgoing invoice bills,
 * drafts included — a draft is money already reserved for those months, so the schedule shows it
 * separately from an issued bill. Overlapping invoices merge into one box: `paid` is only true when
 * every covering invoice is paid, `draft` only while every one of them is still a draft, `unpaid` as
 * soon as one issued invoice is unsettled, and the latest issue date drives the asterisk.
 */
export function buildInvoiceCoverage(
  invoices: Invoice[],
  contracts: Contract[],
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = [],
  projects: Project[] = [],
  receipts: Receipt[] = []
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

  const projectsById = new Map(projects.map(project => [project.id, project]));
  const projectMonthsByContract = new Map<string, Map<string, Record<string, number>>>();
  const projectMonths = (projectId: string): Record<string, number> => {
    const contract = contractsById.get(String(projectsById.get(projectId)?.contract_id || ''));
    if (!contract) return {};
    let schedules = projectMonthsByContract.get(contract.id);
    if (!schedules) {
      schedules = new Map(contractProjectSchedules(contract, projects).map(entry => [entry.project.id, entry.months]));
      projectMonthsByContract.set(contract.id, schedules);
    }
    return schedules.get(projectId) ?? {};
  };
  const sumOver = (months: string[], amounts: Record<string, number>) =>
    months.reduce((total, month) => total + (amounts[month] || 0), 0);
  const fees = (contractIds: string[], months: string[]) => contractIds.reduce((total, id) => {
    const contract = contractsById.get(id);
    return total + (contract ? sumOver(months, chargesFor(contract)) : 0);
  }, 0);

  /**
   * What an invoice (or receipt) bills: the agreements whose own fees it covers, and the part its
   * change requests account for. Contracts linked directly always count. A linked project's parent
   * agreement is added by the link picker on its own, so the links cannot say whether its fee is
   * billed too — the money can. A change request is billed either for its share of the months or in
   * one lump (its budget); the parents count when, once their fees are taken out, the rest matches
   * one of those better than it does with the fees left in.
   */
  // ponytail: amount heuristic — a budget-less (timesheet) change request billed for about its
  // agreement's fee can tip it; store an explicit fee / change-request flag on the link if that bites.
  const billedShares = (contractIds: string[], projectIds: string[], months: string[], amount: number) => {
    const share = projectIds.reduce((total, id) => total + sumOver(months, projectMonths(id)), 0);
    const budget = projectIds.reduce((total, id) => total + (Number(projectsById.get(id)?.budget_value) || 0), 0);
    const fit = (ids: string[]) => {
      const rest = amount - fees(ids, months);
      const projectAmount = projectIds.length === 0 ? 0 : Math.abs(rest - share) <= Math.abs(rest - budget) ? share : budget;
      return { contractIds: ids, projectAmount, miss: Math.abs(rest - projectAmount) };
    };
    const parents = new Set(projectIds.map(id => String(projectsById.get(id)?.contract_id || '')));
    const direct = fit(contractIds.filter(id => !parents.has(id)));
    if (direct.contractIds.length === contractIds.length) return direct;
    const all = fit(contractIds);
    return all.miss < direct.miss ? all : direct;
  };

  /** Per cell, what a box's money pays for besides its own agreement's fee (see contractTotal). */
  const otherBilled = new Map<string, number>();
  const noteOtherBilled = (contractIds: string[], ownerId: string, months: string[], projectAmount: number) => {
    const others = fees(contractIds.filter(id => id !== ownerId), months) + projectAmount;
    if (others === 0) return;
    months.forEach(month => {
      const key = invoiceCellKey(ownerId, month);
      otherBilled.set(key, (otherBilled.get(key) || 0) + others);
    });
  };

  const allocateLine = createInvoiceLineAllocator(contracts, projects, catalogModules, catalogItems);

  ordered.forEach(invoice => {
    // An invoice with lines says exactly what it bills: each line paints the agreements whose fee it
    // bills, for its own months, with each agreement's share of the line (project shares belong to
    // the change-request rows) — so every agreement is matched against its own charges alone.
    const lines = invoiceLines(invoice);
    if (lines.length > 0) {
      lines.forEach(line => {
        const { months, shares } = allocateLine(invoice, line);
        shares.forEach(share => {
          const contract = share.kind === 'contract' ? contractsById.get(share.id) : undefined;
          if (!contract) return;
          paintInvoiceBox(covered, invoice, months, contract.id, month => invoiceCellKey(contract.id, month), {
            amount: share.amount,
            line: lineLabel(line, shares.length),
          });
        });
      });
      return;
    }

    const months = invoiceCoveredMonths(invoice);
    if (months.length === 0) return;

    // A change-request invoice paints its project rows; the parent agreement only when the invoice
    // bills its fee too (see billedShares), or the same money would show twice.
    const billedThroughProjects = invoiceProjectIds(invoice).length > 0;
    const billed = billedShares(invoiceContractIds(invoice), invoiceProjectIds(invoice), months, invoiceAmountEur(invoice));
    const linkedContracts = billed.contractIds
      .map(contractId => contractsById.get(contractId))
      .filter((contract): contract is Contract => Boolean(contract));
    // Nothing linked at all: fall back to the counterparty contract the invoice actually mentions
    // or whose charged total matches. An invoice that bills projects is already placed.
    const inferred = linkedContracts.length > 0 || billedThroughProjects ? undefined : pickContract(
      invoice,
      months,
      contractsByCounterparty.get(invoice.counterparty_id) ?? [],
      catalogModules,
      catalogItems
    );
    const targets = linkedContracts.length > 0 ? linkedContracts : inferred ? [inferred] : [];
    if (targets.length === 0) return;

    const targetIds = targets.map(contract => contract.id);
    targets.forEach(contract => {
      paintInvoiceBox(covered, invoice, months, contract.id, month => invoiceCellKey(contract.id, month));
      noteOtherBilled(targetIds, contract.id, months, billed.projectAmount);
    });
  });

  // Receipts (intercompany transfers, deposits) are paid money with no tax document; they paint the
  // same boxes so the schedule shows them as settled even though nothing was invoiced.
  const invoicesById = new Map(invoices.map(invoice => [invoice.id, invoice]));
  receipts
    .filter(receipt => receipt.direction !== 'outgoing')
    .forEach(receipt => {
      const months = receiptCoveredMonths(receipt);
      if (months.length === 0) return;
      const linkedInvoice = receipt.invoice_id ? invoicesById.get(receipt.invoice_id) : undefined;
      const billedProjectIds = normalizeLinkIds([
        ...(receipt.project_ids ?? []),
        ...(linkedInvoice ? invoiceProjectIds(linkedInvoice) : []),
      ]);
      // Same rule as invoices: money that covers a change request belongs to that row, and to the
      // agreement it sits under only when the amount says its fee was paid too.
      const billed = billedShares(
        normalizeLinkIds([...(receipt.contract_ids ?? []), ...(linkedInvoice ? invoiceContractIds(linkedInvoice) : [])]),
        billedProjectIds,
        months,
        round2(Number(receipt.amount_eur) || 0)
      );
      const targetIds = billed.contractIds.filter(contractId => contractsById.has(contractId));
      targetIds.forEach(contractId => {
        paintReceiptBox(covered, receipt, months, contractId, month => invoiceCellKey(contractId, month));
        noteOtherBilled(targetIds, contractId, months, billed.projectAmount);
      });
    });

  // The comparison only makes sense once a box has absorbed every overlapping invoice, so the
  // contract side is summed over the final month range in a second pass.
  covered.forEach((entry, key) => {
    const contract = contractsById.get(entry.contractId);
    const charges = contract ? chargesFor(contract) : {};
    entry.contractTotal = round2(
      monthKeysBetween(entry.firstMonth, entry.lastMonth).reduce((total, month) => total + (charges[month] || 0), 0) +
        (otherBilled.get(key) || 0)
    );
    entry.variance = round2(coverageTotal(entry) - entry.contractTotal);
  });

  return covered;
}

/** Box colours per invoice state: paid (bold green), issued but unpaid (light magenta), draft (slate).
 *  Values are theme tokens so the boxes invert with the rest of the schedule in dark mode. */
export const INVOICE_BOX_COLORS = {
  paid: {
    line: 'color-mix(in srgb, var(--viz-paid) 85%, transparent)',
    fill: 'color-mix(in srgb, var(--viz-paid) 30%, transparent)',
    marker: 'var(--viz-paid)',
  },
  issued: {
    line: 'color-mix(in srgb, var(--viz-issued) 55%, transparent)',
    fill: 'color-mix(in srgb, var(--viz-issued) 14%, transparent)',
    marker: 'var(--viz-issued)',
  },
  draft: {
    line: 'color-mix(in srgb, var(--viz-draft) 70%, transparent)',
    fill: 'color-mix(in srgb, var(--viz-draft) 14%, transparent)',
    marker: 'var(--viz-draft)',
  },
} as const;

/** Colour of the issue-month asterisk, so it always agrees with its box. */
export function invoiceMarkerColor(coverage: InvoiceCellCoverage): string {
  return INVOICE_BOX_COLORS[invoiceBoxState(coverage)].marker;
}

/** Inline style painting one cell of the invoice box; contiguous cells share the box outline. */
export function invoiceCellStyle(coverage: InvoiceCellCoverage, month: string): Record<string, string> {
  const palette = INVOICE_BOX_COLORS[invoiceBoxState(coverage)];
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
 * A project line is compared with the project's scheduled share over the line's months (needs
 * `contracts` to know each project's window). An invoice without lines — or a receipt — is not
 * compared: a change request is often billed in one lump after its delivery months.
 */
export function buildProjectInvoiceCoverage(
  invoices: Invoice[],
  projects: Project[],
  receipts: Receipt[] = [],
  contracts: Contract[] = [],
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = []
): InvoiceCoverageMap {
  const parentByProject = new Map(projects.map(project => [project.id, String(project.contract_id || '')]));
  const allocateLine = createInvoiceLineAllocator(contracts, projects, catalogModules, catalogItems);
  const outgoing = invoices
    .filter(invoice => invoice.direction === 'outgoing')
    .filter(invoice => !INACTIVE_STATUSES.has(invoice.status))
    .filter(invoice => invoiceProjectIds(invoice).length > 0 || invoiceLines(invoice).some(line => invoiceLineTargets(line).projectIds.length > 0));

  const drafts = outgoing.filter(invoice => invoice.status === 'draft' && invoice.type !== 'credit_note');
  const issued = outgoing.filter(invoice => invoice.status !== 'draft');
  const ordered = [...netInvoices(issued).active, ...drafts].sort(
    (a, b) => String(a.issue_date || '').localeCompare(String(b.issue_date || '')) || a.id.localeCompare(b.id)
  );

  const covered: InvoiceCoverageMap = new Map();
  /** Cells holding money that is not compared (invoices without lines, receipts). */
  const uncompared = new Set<string>();
  ordered.forEach(invoice => {
    const lines = invoiceLines(invoice);
    if (lines.length > 0) {
      lines.forEach(line => {
        const { months, shares } = allocateLine(invoice, line);
        shares.forEach(share => {
          if (share.kind !== 'project' || !parentByProject.has(share.id)) return;
          paintInvoiceBox(covered, invoice, months, parentByProject.get(share.id) ?? '', month => projectInvoiceCellKey(share.id, month), {
            amount: share.amount,
            line: lineLabel(line, shares.length),
          });
        });
      });
      return;
    }
    const months = invoiceCoveredMonths(invoice);
    if (months.length === 0) return;
    invoiceProjectIds(invoice).forEach(projectId => {
      paintInvoiceBox(covered, invoice, months, parentByProject.get(projectId) ?? '', month => projectInvoiceCellKey(projectId, month));
      months.forEach(month => uncompared.add(projectInvoiceCellKey(projectId, month)));
    });
  });

  const invoicesById = new Map(invoices.map(invoice => [invoice.id, invoice]));
  receipts
    .filter(receipt => receipt.direction !== 'outgoing')
    .forEach(receipt => {
      const months = receiptCoveredMonths(receipt);
      if (months.length === 0) return;
      const linkedInvoice = receipt.invoice_id ? invoicesById.get(receipt.invoice_id) : undefined;
      const projectIds = normalizeLinkIds([
        ...(receipt.project_ids ?? []),
        ...(linkedInvoice ? invoiceProjectIds(linkedInvoice) : []),
      ]);
      projectIds
        .filter(projectId => parentByProject.has(projectId))
        .forEach(projectId => {
          paintReceiptBox(covered, receipt, months, parentByProject.get(projectId) ?? '', month => projectInvoiceCellKey(projectId, month));
          months.forEach(month => uncompared.add(projectInvoiceCellKey(projectId, month)));
        });
    });

  const contractsById = new Map(contracts.map(contract => [contract.id, contract]));
  const scheduleByProject = new Map<string, Record<string, number>>();
  contracts.forEach(contract => {
    contractProjectSchedules(contract, projects).forEach(entry => scheduleByProject.set(entry.project.id, entry.months));
  });
  covered.forEach((entry, key) => {
    const projectId = key.slice(0, key.lastIndexOf(':'));
    const schedule = scheduleByProject.get(projectId);
    entry.contractTotal = uncompared.has(key) || !schedule || !contractsById.has(entry.contractId)
      ? coverageTotal(entry)
      : round2(monthKeysBetween(entry.firstMonth, entry.lastMonth).reduce((total, month) => total + (schedule[month] || 0), 0));
    entry.variance = round2(coverageTotal(entry) - entry.contractTotal);
  });
  return covered;
}

/** Merge the boxes of every project on a change-request row into the one drawn on that cell. */
export function mergeProjectCoverage(cells: Array<InvoiceCellCoverage | undefined>): InvoiceCellCoverage | undefined {
  const entries = cells.filter((entry): entry is InvoiceCellCoverage => Boolean(entry));
  if (entries.length === 0) return undefined;

  const merged: InvoiceCellCoverage = entries.length === 1 ? { ...entries[0] } : {
    contractId: entries[0].contractId,
    paid: entries.every(entry => entry.paid),
    draft: entries.every(entry => entry.draft),
    unpaid: entries.some(entry => entry.unpaid),
    firstMonth: entries.map(entry => entry.firstMonth).sort()[0],
    lastMonth: entries.map(entry => entry.lastMonth).sort().slice(-1)[0],
    markerMonth: entries.map(entry => entry.markerMonth).sort().slice(-1)[0],
    markerPosition: 'middle',
    invoices: entries.flatMap(entry => entry.invoices).slice(-3),
    invoiceIds: entries.flatMap(entry => entry.invoiceIds).slice(-3),
    issueDate: entries.map(entry => entry.issueDate).sort().slice(-1)[0],
    invoiceTotal: Math.round(entries.reduce((sum, entry) => sum + entry.invoiceTotal, 0) * 100) / 100,
    documentNets: Object.assign({}, ...entries.map(entry => entry.documentNets)),
    lines: entries.flatMap(entry => entry.lines).slice(-3),
    receiptTotal: Math.round(entries.reduce((sum, entry) => sum + entry.receiptTotal, 0) * 100) / 100,
    receipts: entries.flatMap(entry => entry.receipts).slice(-3),
    // Each project's own comparison: project lines against their scheduled share, anything else
    // (an invoice without lines, usually raised after delivery) against itself.
    contractTotal: Math.round(entries.reduce((sum, entry) => sum + entry.contractTotal, 0) * 100) / 100,
    variance: 0,
  };
  merged.markerPosition = invoiceMarkerPosition(merged.markerMonth, merged.firstMonth, merged.lastMonth);
  merged.variance = Math.round((coverageTotal(merged) - merged.contractTotal) * 100) / 100;
  return merged;
}
