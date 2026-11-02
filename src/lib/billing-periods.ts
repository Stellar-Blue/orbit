/**
 * Single source of truth for "which billing periods does this contract owe, and how much do we
 * expect for each one?".
 *
 * Expected amounts come from the month-by-month schedule (calculatePeriodAmountsByTiming — the engine
 * behind the "Monthly Cash Landing & Revenue Recognition" panel), summed over the cycle's months and
 * split by invoicing timing, so a line billed in advance and a line billed in arrears yield their own
 * suggestion rows. calculateInvoiceAmountForPeriod is only a fallback for windows the schedule does not
 * cover.
 *
 * Cycles are anchored on the contract's start date, never on the calendar: a quarterly agreement
 * starting 15 Jan bills 15 Jan – 14 Apr, then 15 Apr – 14 Jul, …
 */
import {
  calculateContractValuation,
  calculateInvoiceAmountForPeriod,
  calculateManHoursCharge,
  calculatePeriodAmountsByTiming,
} from './pricing-engine';
import type { CatalogItem, CatalogModule, ContractLine, ContractLineGroup, Invoice } from './types';
import { formatDate } from './date';
import { netInvoices, type NettableInvoice } from './invoice-netting';
import { invoiceContractIds } from './invoice-links';

type InvoiceInsert = Omit<Invoice, 'id' | 'created_at' | 'counterparty' | 'contract' | 'documents' | 'payments' | 'allocations'>;

export interface BillingPeriodItem {
  /** Machine-comparable key: the cycle's start date, e.g. "2026-01-15".
   *  When a period is billed both in advance and in arrears the keys get an `@start` / `@end` suffix. */
  key: string;
  /** Human label — the service window, e.g. "15/01/2026 - 14/04/2026". */
  label: string;
  from: string;
  to: string;
  /** Contract amount charged for this window, excl. VAT — the draft invoice's net. */
  expectedAmount: number;
  /** When this part of the period is charged — the line's own timing, else the contract's. */
  timing: 'start_of_period' | 'end_of_period';
  /** The date the invoice for this period is raised: the service-window start in advance, its end in arrears. */
  billingDate: string;
  status: 'unbilled' | 'draft_created' | 'billed';
  invoiceId?: string;
}

export interface BillingPeriodContract {
  id: string;
  value?: number | null;
  schedule?: Array<{ period: string; amount: number }> | null;
  lines?: ContractLine[] | null;
  groups?: Array<Partial<ContractLineGroup>> | null;
  billing_cadence?: string | null;
  invoice_timing?: string | null;
  discount_pct?: number | null;
  term_years?: number | null;
  service_start_date?: string | null;
  starts_on?: string | null;
}

/** The invoice fields the period walk needs — a full Invoice satisfies this shape. */
export interface BillingPeriodInvoice extends NettableInvoice {
  id: string;
  contract_id?: string | null;
  status: string;
  reference_period?: string | null;
  period_from?: string | null;
  period_to?: string | null;
  issue_date?: string | null;
}

export interface BillingPeriodOptions {
  /** Defaults to today — injectable so the period walk is testable. */
  today?: Date;
  catalogModules?: CatalogModule[];
  catalogItems?: CatalogItem[];
  timesheets?: Array<{ contract_line_id?: string | null; work_date: string; hours: number }>;
  /** Contract line groups — needed so min_monthly_charge floors are priced into the schedule. */
  groups?: Array<Partial<ContractLineGroup>>;
  /** Linked invoices, used to mark a period as drafted/billed. Credit notes never mark a period. */
  invoices?: BillingPeriodInvoice[];
  /** Optimistic "draft created" marks from the hub, keyed `${contractId}::${periodKey}`. */
  generatedDraftIds?: Record<string, string>;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Months in one billing cycle for the fixed cadences; 0 for one-off / milestone settlements. */
const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };

/** Shifts a date by whole months, clamping the day to the target month (31 Jan + 1 month → 28/29 Feb). */
function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

/**
 * The calendar months a billing cycle's schedule lands in. Cycles are anchored on the contract start
 * date, not the calendar: a quarterly cycle starting 15 Jan bills Jan–Mar, the next one Apr–Jun.
 */
function cycleMonths(from: string, monthCount: number): string[] {
  const months: string[] = [];
  const cursor = new Date(from + 'T00:00:00');
  if (isNaN(cursor.getTime())) return months;
  cursor.setDate(1);
  for (let i = 0; i < monthCount; i++) {
    months.push(ym(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/** Every calendar month a billing window touches, e.g. Q1 → ['2026-01','2026-02','2026-03']. */
function monthsInWindow(from: string, to: string, cap = 240): string[] {
  const months: string[] = [];
  const cursor = new Date(from + 'T00:00:00');
  if (isNaN(cursor.getTime())) return months;
  cursor.setDate(1);
  const end = new Date(to + 'T00:00:00');
  while (!isNaN(end.getTime()) && cursor <= end && months.length < cap) {
    months.push(ym(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/**
 * Billing periods already due (in advance or in arrears) for a single contract, newest walk first,
 * each with its expected amount and whether an invoice already exists for it.
 * Returns [] when the contract has no start date or nothing is due yet.
 */
export function getContractBillingPeriods(
  contract: BillingPeriodContract,
  options: BillingPeriodOptions = {}
): BillingPeriodItem[] {
  const {
    today = new Date(),
    catalogModules = [],
    catalogItems = [],
    timesheets = [],
    groups = [],
    invoices = [],
    generatedDraftIds = {},
  } = options;

  const startDateStr = contract.service_start_date || contract.starts_on;
  if (!startDateStr) return [];

  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);

  // A credit note reverses an invoice instead of paying it: neither may mark a period as billed.
  const usableInvoices = netInvoices(invoices).active;
  const cadence = contract.billing_cadence || 'monthly';
  const timing = contract.invoice_timing || 'start_of_period';
  const lines = contract.lines || [];
  const startDate = new Date(startDateStr + 'T00:00:00');

  const valuation = calculateContractValuation(
    lines,
    contract.discount_pct || 0,
    contract.term_years || 1,
    startDateStr,
    catalogModules,
    catalogItems,
    contract.value || 0,
    cadence
  );

  // Month-by-month schedule — the very engine behind the "Monthly Cash Landing & Revenue Recognition"
  // panel — split by invoicing timing so advance and arrears lines are invoiced separately. A quarterly
  // or annual line billed in arrears lands on its own cycle's last month, so it is invoiced in the
  // billing cycle where that cycle closes (an annual fee on a quarterly agreement → its year-end quarter).
  const billableLines = lines.filter(l => (l as { line_kind?: string | null }).line_kind !== 'man_hours');
  const scheduleByMonth = new Map<string, { advance: number; arrears: number }>();
  calculatePeriodAmountsByTiming(
    billableLines,
    contract.discount_pct || 0,
    contract.term_years || 1,
    startDateStr,
    catalogModules,
    catalogItems,
    groups,
    timing,
    { arrearsAtCycleEnd: true }
  ).forEach(entry => scheduleByMonth.set(entry.period, { advance: Number(entry.advance) || 0, arrears: Number(entry.arrears) || 0 }));

  /**
   * The service window of one cycle: it starts on the contract anchor (start + n cycles) and ends the
   * day before the next cycle starts, so 15 Jan quarterly → 15 Jan – 14 Apr, 15 Apr – 14 Jul, …
   */
  const getPeriodInfo = (cycleStart: Date, nextCycleStart: Date | null): { key: string; label: string; from: string; to: string } => {
    const monthsPerCycle = CYCLE_MONTHS[cadence] || 0;
    if (monthsPerCycle === 0) {
      const key = ymd(startDate);
      return { key, label: cadence === 'one_off' ? 'One-off Delivery' : 'Milestone Settlement', from: startDateStr, to: ymd(todayStart) };
    }
    const from = ymd(cycleStart);
    const next = nextCycleStart || addMonths(cycleStart, monthsPerCycle);
    const to = ymd(new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1));
    return { key: from, label: `${formatDate(from)} - ${formatDate(to)}`, from, to };
  };

  const periods: Array<ReturnType<typeof getPeriodInfo>> = [];
  const seenKeys = new Set<string>();
  const monthsPerCycle = CYCLE_MONTHS[cadence] || 0;

  // Advance halves are due at the period start and arrears halves at the period end, so walk every
  // period that has STARTED and let the per-side check below decide which halves are billable yet.
  for (let cycle = 0; ; cycle++) {
    const cycleStart = monthsPerCycle > 0 ? addMonths(startDate, cycle * monthsPerCycle) : new Date(startDate);
    const nextCycleStart = monthsPerCycle > 0 ? addMonths(startDate, (cycle + 1) * monthsPerCycle) : null;
    const info = getPeriodInfo(cycleStart, nextCycleStart);
    if (seenKeys.has(info.key)) break;
    seenKeys.add(info.key);

    if (new Date(info.from + 'T00:00:00') > todayStart) break;

    periods.push(info);

    if (monthsPerCycle === 0) break; // one-off / milestone settle once
  }

  if (periods.length === 0) return [];

  /**
   * Sum of the scheduled advance/arrears halves across the cycle's months. The schedule is bucketed by
   * month, and a cycle anchored mid-month still owns the whole opening month, so the month list is
   * derived from the cycle start rather than from the window's end date.
   */
  const scheduledHalves = (period: { from: string; to: string }): { advance: number; arrears: number } => {
    let advance = 0;
    let arrears = 0;
    const months = monthsPerCycle > 0 ? cycleMonths(period.from, monthsPerCycle) : monthsInWindow(period.from, period.to);
    months.forEach(month => {
      const entry = scheduleByMonth.get(month);
      if (!entry) return;
      advance += entry.advance;
      arrears += entry.arrears;
    });
    return { advance, arrears };
  };

  /** Legacy single-amount fallback for windows the schedule does not cover (line-less contracts). */
  const fallbackAmountFor = (period: { from: string; to: string }): number => {
    const manHours = calculateManHoursCharge(lines, timesheets, period.from, period.to);
    const startDateForCalc = contract.service_start_date || contract.starts_on || period.from;
    let base = 0;
    if (lines.length > 0) {
      base = calculateInvoiceAmountForPeriod(
        lines,
        period.from,
        period.to,
        timing,
        cadence,
        startDateForCalc,
        contract.discount_pct || 0,
        catalogModules,
        catalogItems
      );
    }
    if (base > 0 || manHours > 0) return base + manHours;

    const schedItem = (contract.schedule || []).find(s => s.period === period.from.slice(0, 7));
    if (schedItem) return schedItem.amount;
    if (cadence === 'annual') return valuation.netARR || (contract.value || 0);
    if (cadence === 'quarterly') return (valuation.netARR / 4) || ((contract.value || 0) / 4);
    if (cadence === 'monthly') return valuation.netMonthlyMRR || ((contract.value || 0) / 12);
    return valuation.totalContractValue || (contract.value || 0);
  };

  /**
   * An invoice covers a cycle when its own service window overlaps the cycle's window. Date-range
   * overlap (rather than a period key) keeps this working now that cycles are anchored on the
   * contract start instead of the calendar — including invoices raised before that change.
   */
  const findExistingInvoice = (period: { key: string; label: string; from: string; to: string }) =>
    usableInvoices.find(i => {
      if (i.contract_id !== contract.id) return false;
      if (i.reference_period && i.reference_period.trim() !== '') {
        const ref = i.reference_period.trim().toLowerCase();
        if (ref === period.key.toLowerCase() || ref === period.label.toLowerCase()) return true;
      }
      const invFrom = (i.period_from || '').trim();
      const invTo = (i.period_to || '').trim() || invFrom;
      if (invFrom) return invFrom <= period.to && invTo >= period.from;
      const issued = (i.issue_date || '').trim();
      return !!issued && issued >= period.from && issued <= period.to;
    });

  /**
   * Split cycles invoice each timing side separately, so an existing invoice may only cover the side
   * it actually bills. Matching purely on window overlap let a one-off invoice raised at the cycle
   * start hide the recurring fee due at its end.
   */
  const assignSplitInvoices = (period: { key: string; label: string; from: string; to: string }) => {
    const sides = [
      { side: 'start_of_period' as const, key: `${period.key}@start`, date: period.from, label: `${period.label} · in advance` },
      { side: 'end_of_period' as const, key: `${period.key}@end`, date: period.to, label: `${period.label} · in arrears` },
    ];
    const assigned = new Map<'start_of_period' | 'end_of_period', BillingPeriodInvoice>();
    const daysApart = (a: string, b: string) => {
      const left = new Date(a + 'T00:00:00');
      const right = new Date(b + 'T00:00:00');
      if (isNaN(left.getTime()) || isNaN(right.getTime())) return Number.POSITIVE_INFINITY;
      return Math.abs(left.getTime() - right.getTime()) / 86_400_000;
    };

    usableInvoices.forEach(inv => {
      if (!invoiceContractIds(inv).includes(contract.id)) return;

      const reference = (inv.reference_period || '').trim().toLowerCase();
      if (reference) {
        const named = sides.find(s => reference === s.key.toLowerCase() || reference === s.label.toLowerCase());
        if (named) {
          if (!assigned.has(named.side)) assigned.set(named.side, inv);
          return;
        }
      }

      const invFrom = (inv.period_from || '').trim();
      const invTo = (inv.period_to || '').trim() || invFrom;
      const covers = (date: string) => !!invFrom && invFrom <= date && invTo >= date;
      let candidates = sides.filter(s => covers(s.date));

      if (candidates.length === 0) {
        const issued = (inv.issue_date || '').trim();
        const overlapsWindow = !!invFrom && invFrom <= period.to && invTo >= period.from;
        const raisedInWindow = !!issued && issued >= period.from && issued <= period.to;
        if (!overlapsWindow && !raisedInWindow) return;
        candidates = sides;
      }

      const raisedOn = (inv.issue_date || '').trim() || invFrom;
      const target = candidates
        .map(s => ({ s, distance: daysApart(raisedOn, s.date) }))
        .sort((a, b) => a.distance - b.distance)[0]?.s;
      if (target && !assigned.has(target.side)) assigned.set(target.side, inv);
    });

    return assigned;
  };

  const results: BillingPeriodItem[] = [];
  periods.forEach(period => {
    const { advance, arrears } = scheduledHalves(period);
    // Timesheet man-hours are always billed after the work, so they land in the arrears half.
    const manHours = calculateManHoursCharge(lines, timesheets, period.from, period.to);
    const advanceAmt = Number(advance.toFixed(2));
    const arrearsAmt = Number((arrears + manHours).toFixed(2));
    const splitRequired = advanceAmt > 0 && arrearsAmt > 0;
    const splitCoverage = splitRequired ? assignSplitInvoices(period) : null;

    const pushRow = (side: 'start_of_period' | 'end_of_period', amount: number) => {
      const key = splitRequired ? `${period.key}@${side === 'start_of_period' ? 'start' : 'end'}` : period.key;
      const label = splitRequired
        ? `${period.label} · ${side === 'start_of_period' ? 'in advance' : 'in arrears'}`
        : period.label;
      const lookup = { key, label, from: period.from, to: period.to };
      const existingInv = splitCoverage ? splitCoverage.get(side) : findExistingInvoice(lookup);
      const draftId = generatedDraftIds[`${contract.id}::${key}`];
      const status: BillingPeriodItem['status'] = existingInv
        ? (existingInv.status === 'draft' ? 'draft_created' : 'billed')
        : draftId ? 'draft_created' : 'unbilled';

      results.push({
        key,
        label,
        from: period.from,
        to: period.to,
        expectedAmount: Number(amount.toFixed(2)),
        timing: side,
        billingDate: side === 'end_of_period' ? period.to : period.from,
        status,
        invoiceId: existingInv?.id || draftId,
      });
    };

    if (advanceAmt > 0 && new Date(period.from + 'T00:00:00') <= todayStart) pushRow('start_of_period', advanceAmt);
    if (arrearsAmt > 0 && new Date(period.to + 'T00:00:00') <= todayStart) pushRow('end_of_period', arrearsAmt);

    if (advanceAmt === 0 && arrearsAmt === 0) {
      // With line items, the schedule is authoritative: a period where every line's window is dormant
      // genuinely owes nothing (falling back to netARR here would invent an invoice).
      if (lines.length > 0) return;
      // No line items at all — fall back to the legacy calculation for the whole period.
      const fallback = fallbackAmountFor(period);
      if (fallback <= 0 && !contract.value) return;
      const dueAt = timing === 'end_of_period' ? new Date(period.to + 'T00:00:00') : new Date(period.from + 'T00:00:00');
      if (dueAt > todayStart) return;
      pushRow(timing === 'end_of_period' ? 'end_of_period' : 'start_of_period', fallback);
    }
  });

  // Oldest period first within the same timing side, so the queue reads forwards in time.
  return results.sort((a, b) => a.key.localeCompare(b.key) || a.timing.localeCompare(b.timing));
}

/** VAT rate the register stores for a contract's treatment: only domestic supplies carry Greek VAT. */
export function vatRateForTreatment(treatment?: string | null): string {
  return !treatment || treatment === 'domestic_24' ? '24%' : '0%';
}

/** Numeric percentage behind a stored rate string: '24%' → 24, '0% (reverse charge)' → 0. */
export function vatPercentFromRate(rate?: string | null): number {
  const match = /(\d+(?:[.,]\d+)?)/.exec(String(rate ?? '24%'));
  const percent = match ? Number(match[1].replace(',', '.')) : 24;
  return Number.isFinite(percent) ? percent : 24;
}

/** Draft-invoice insert payload for a billing period — shared by the hub's quick create and the dossier. */
export function buildDraftInvoicePayload(args: {
  period: Pick<BillingPeriodItem, 'key' | 'label' | 'from' | 'to'> | { key: string; label: string; from: string; to: string };
  contractId: string;
  counterpartyId: string;
  direction: 'revenue' | 'cost';
  currency?: string | null;
  /** FX rate for the EUR reporting amount (`gross_eur`). Optional — see the note on `fx_rate` below. */
  fxRate?: number | null;
  /** Contract amount for the period, excl. VAT — it becomes the invoice's net. */
  netAmount: number;
  /** Register VAT rate for the contract, e.g. '24%'. Standard rate when omitted. */
  vatRate?: string | null;
  reference?: string | null;
  timing?: string | null;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
}): InvoiceInsert {
  const net = Number(args.netAmount.toFixed(2));
  const vatRate = args.vatRate || '24%';
  const vat = Number(((net * vatPercentFromRate(vatRate)) / 100).toFixed(2));
  const gross = Number((net + vat).toFixed(2));
  return {
    direction: args.direction === 'revenue' ? 'outgoing' : 'incoming',
    counterparty_id: args.counterpartyId,
    contract_id: args.contractId,
    type: 'invoice',
    invoice_number: args.invoiceNumber,
    issue_date: args.issueDate,
    due_date: args.dueDate,
    period_from: args.period.from,
    period_to: args.period.to,
    reference_period: args.period.key,
    currency: args.currency || 'EUR',
    // ponytail: no FX feed exists, so a draft only converts when the caller supplies a rate —
    // a non-EUR contract draft stays 1:1 until the operator corrects it in the invoice modal.
    // Upgrade path: plug a rate service into pricing-engine and pass it here.
    fx_rate: args.fxRate || 1.0,
    net,
    vat_rate: vatRate,
    vat_amount: vat,
    gross,
    gross_eur: Number((gross * (args.fxRate || 1)).toFixed(2)),
    status: 'draft',
    missing_document: false,
    notes: `Auto-generated draft for contract ${args.reference || args.contractId} (${args.period.label}${args.timing ? ` - ${args.timing}` : ''})`,
    created_via: 'ui',
  };
}

/** Next period still owed, if any — convenience for "fast create the next invoice" affordances. */
export const nextUnbilledPeriod = (periods: BillingPeriodItem[]): BillingPeriodItem | undefined =>
  periods.find(p => p.status === 'unbilled');
