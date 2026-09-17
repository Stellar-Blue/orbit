/**
 * Single source of truth for "which billing periods does this contract owe, and how much do we
 * expect for each one?".
 *
 * Extracted verbatim from the Contract Invoicing & Revenue Action Center so the contract dossier can
 * offer the same fast-create rows without a second copy of the cadence/timing math. Behaviour is
 * intentionally identical to the Action Center: expected amount = fixed contract amount for the period
 * (via calculateInvoiceAmountForPeriod) + man-hours from linked timesheets, falling back to the stored
 * schedule / net ARR when the engine yields nothing.
 */
import {
  calculateContractValuation,
  calculateInvoiceAmountForPeriod,
  calculateManHoursCharge,
  calculatePeriodAmounts,
} from './pricing-engine';
import type { CatalogItem, CatalogModule, ContractLine, ContractLineGroup, Invoice } from './types';

type InvoiceInsert = Omit<Invoice, 'id' | 'created_at' | 'counterparty' | 'contract' | 'documents' | 'payments' | 'allocations'>;

export interface BillingPeriodItem {
  /** Machine-comparable period key: "2026-01" (monthly), "2026-Q1" (quarterly), "2026" (annual). */
  key: string;
  label: string;
  from: string;
  to: string;
  expectedAmount: number;
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

export interface BillingPeriodOptions {
  /** Defaults to today — injectable so the period walk is testable. */
  today?: Date;
  catalogModules?: CatalogModule[];
  catalogItems?: CatalogItem[];
  timesheets?: Array<{ contract_line_id?: string | null; work_date: string; hours: number }>;
  /** Contract line groups — needed so min_monthly_charge floors are priced into the schedule. */
  groups?: Array<Partial<ContractLineGroup>>;
  /** Linked invoices, used to mark a period as drafted/billed. */
  invoices?: Array<{
    id: string; contract_id?: string | null; status: string;
    reference_period?: string | null; period_from?: string | null; issue_date?: string | null;
  }>;
  /** Optimistic "draft created" marks from the hub, keyed `${contractId}::${periodKey}`. */
  generatedDraftIds?: Record<string, string>;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

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
  // panel, so a suggested invoice always equals what that panel shows for the same window.
  const billableLines = lines.filter(l => (l as { line_kind?: string | null }).line_kind !== 'man_hours');
  const scheduleByMonth = new Map<string, number>();
  calculatePeriodAmounts(
    billableLines,
    contract.discount_pct || 0,
    contract.term_years || 1,
    startDateStr,
    catalogModules,
    catalogItems,
    groups
  ).forEach(entry => scheduleByMonth.set(entry.period, Number(entry.amount) || 0));

  const getPeriodInfo = (cursor: Date): { key: string; label: string; from: string; to: string } => {
    if (cadence === 'monthly') {
      const key = ym(cursor);
      const from = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      const to = ymd(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
      return { key, label: `Monthly (${key})`, from, to };
    }
    if (cadence === 'quarterly') {
      const q = Math.floor(cursor.getMonth() / 3);
      const year = cursor.getFullYear();
      const key = `${year}-Q${q + 1}`;
      const from = ymd(new Date(year, q * 3, 1));
      const to = ymd(new Date(year, q * 3 + 3, 0));
      return { key, label: `Q${q + 1} ${year}`, from, to };
    }
    if (cadence === 'annual') {
      const year = cursor.getFullYear();
      return { key: `${year}`, label: `${year} Annual Term`, from: ymd(new Date(year, 0, 1)), to: ymd(new Date(year, 11, 31)) };
    }
    const key = ymd(startDate);
    return { key, label: cadence === 'one_off' ? 'One-off Delivery' : 'Milestone Settlement', from: startDateStr, to: ymd(todayStart) };
  };

  const advanceCursor = (cursor: Date): Date => {
    const next = new Date(cursor);
    if (cadence === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (cadence === 'quarterly') next.setMonth(next.getMonth() + 3);
    else if (cadence === 'annual') next.setFullYear(next.getFullYear() + 1);
    else return new Date(todayStart.getTime() + 1);
    return next;
  };

  const periods: Array<ReturnType<typeof getPeriodInfo>> = [];
  const seenKeys = new Set<string>();
  let cursor = new Date(startDate);
  const timingIsEnd = timing === 'end_of_period';

  while (true) {
    const info = getPeriodInfo(cursor);
    if (seenKeys.has(info.key)) break;
    seenKeys.add(info.key);

    const dueAt = timingIsEnd ? new Date(info.to + 'T00:00:00') : new Date(info.from + 'T00:00:00');
    if (dueAt > todayStart) break;

    periods.push(info);

    if (cadence === 'one_off' || cadence === 'milestone') break;
    cursor = advanceCursor(cursor);
    if (cursor > todayStart && cursor.getTime() - todayStart.getTime() > 366 * 86400000) break;
  }

  if (periods.length === 0) return [];

  const expectedFor = (period: { from: string; to: string }): number => {
    // The suggested invoice mirrors the month-by-month revenue schedule the pricing builder shows, so
    // per-month quantity overrides and group min_monthly_charge floors are priced in. Man-hours lines are
    // excluded here (their charge comes from logged timesheets) to avoid billing a rate × quantity stub.
    const scheduled = monthsInWindow(period.from, period.to).reduce(
      (sum, month) => sum + (scheduleByMonth.get(month) ?? 0),
      0
    );
    const manHours = calculateManHoursCharge(lines, timesheets, period.from, period.to);
    if (scheduled > 0 || manHours > 0) return scheduled + manHours;

    // Nothing in the schedule for this window (line-less or non-scheduled contract) — legacy fallbacks.
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

  const findExistingInvoice = (period: { key: string; label: string; from: string; to: string }) =>
    invoices.find(i => {
      if (i.contract_id !== contract.id) return false;
      if (i.reference_period && i.reference_period.trim() !== '') {
        const ref = i.reference_period.trim().toLowerCase();
        return ref === period.key.toLowerCase() || ref === period.label.toLowerCase();
      }
      if (cadence === 'monthly') {
        if (i.period_from && i.period_from.trim() !== '') return i.period_from.startsWith(period.key);
        return (i.issue_date || '').startsWith(period.key);
      }
      if (cadence === 'quarterly') {
        if (i.period_from && i.period_from.trim() !== '') return i.period_from >= period.from && i.period_from <= period.to;
        return (i.issue_date || '') >= period.from && (i.issue_date || '') <= period.to;
      }
      if (cadence === 'annual') {
        if (i.period_from && i.period_from.trim() !== '') return i.period_from.startsWith(period.key.slice(0, 4));
        return (i.issue_date || '').startsWith(period.key.slice(0, 4));
      }
      return true;
    });

  const results: BillingPeriodItem[] = [];
  periods.forEach(period => {
    const expectedAmt = expectedFor(period);
    if (expectedAmt <= 0 && !contract.value) return;

    const existingInv = findExistingInvoice(period);
    const draftId = generatedDraftIds[`${contract.id}::${period.key}`];
    const status: BillingPeriodItem['status'] = existingInv
      ? (existingInv.status === 'draft' ? 'draft_created' : 'billed')
      : draftId ? 'draft_created' : 'unbilled';

    results.push({
      key: period.key,
      label: period.label,
      from: period.from,
      to: period.to,
      expectedAmount: Number(expectedAmt.toFixed(2)),
      status,
      invoiceId: existingInv?.id || draftId,
    });
  });

  return results;
}

/** Draft-invoice insert payload for a billing period — shared by the hub's quick create and the dossier. */
export function buildDraftInvoicePayload(args: {
  period: Pick<BillingPeriodItem, 'key' | 'label' | 'from' | 'to'> | { key: string; label: string; from: string; to: string };
  contractId: string;
  counterpartyId: string;
  direction: 'revenue' | 'cost';
  currency?: string | null;
  expectedAmount: number;
  reference?: string | null;
  timing?: string | null;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
}): InvoiceInsert {
  const gross = Number(args.expectedAmount.toFixed(2));
  const net = Number((gross / 1.24).toFixed(2));
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
    fx_rate: 1.0,
    net,
    vat_rate: '24',
    vat_amount: Number((gross - net).toFixed(2)),
    gross,
    gross_eur: gross,
    status: 'draft',
    missing_document: false,
    notes: `Auto-generated draft for contract ${args.reference || args.contractId} (${args.period.label}${args.timing ? ` - ${args.timing}` : ''})`,
    created_via: 'ui',
  };
}

/** Next period still owed, if any — convenience for "fast create the next invoice" affordances. */
export const nextUnbilledPeriod = (periods: BillingPeriodItem[]): BillingPeriodItem | undefined =>
  periods.find(p => p.status === 'unbilled');
