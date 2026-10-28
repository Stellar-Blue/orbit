import type { CatalogItem, CatalogModule, Contract, Project } from '@/lib/types';
import {
  calculateContractValuation,
  calculatePeriodAmountsForPeriodsByTiming,
} from '@/lib/pricing-engine';

/**
 * Monthly revenue schedule used by the contract registry's "Revenue Schedule & MRR" grid.
 *
 * Every contract contributes a row for its own charges, mirroring the Excel revenue budget, plus a
 * single change-request row that rolls up every linked project: each project's budget value is
 * spread evenly over its own planned (or actual) delivery window, and the row keeps a per-month
 * breakdown so the grid can name the projects behind a cell. A contract without projects has no
 * change-request row.
 */

export type RevenueStreamKind = 'contract' | 'project';

/** One project's contribution to a change-request row's month. */
export interface ProjectMonthShare {
  project: Project;
  amount: number;
}

export interface RevenueScheduleRow {
  id: string;
  kind: RevenueStreamKind;
  contractId: string;
  contract: Contract;
  counterparty: string;
  reference: string;
  /** Contract product, used as the second line under the master agreement. */
  product: string;
  /** Set on change-request rows: every project behind the row, in start-date order. */
  projects?: Project[];
  /** Set on change-request rows: per month, the projects behind that cell and their amounts. */
  projectMonths?: Record<string, ProjectMonthShare[]>;
  /** 'YYYY-MM' → amount. Only charged months are present; missing months are zero. */
  months: Record<string, number>;
}

export interface RevenueSchedule {
  rows: RevenueScheduleRow[];
  /** Every month from the earliest effective date to the latest one, inclusive. */
  months: string[];
  startKey: string;
  endKey: string;
  /** Company-wide amount per month (both streams of every contract). */
  monthTotals: Record<string, number>;
}

const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const DAY_KEY = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Normalises a date (or 'YYYY-MM') to a 'YYYY-MM' month key, or null when unusable. */
export function toMonthKey(value?: string | null): string | null {
  const raw = String(value || '').trim();
  const match = MONTH_KEY.exec(raw) || DAY_KEY.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}`;
}

export function addMonths(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Inclusive list of 'YYYY-MM' keys between two month keys. */
export function monthKeysBetween(startKey: string, endKey: string): string[] {
  if (endKey < startKey) return [];
  const keys: string[] = [];
  let cursor = startKey;
  // Hard stop keeps malformed contract dates from generating thousands of columns.
  while (cursor <= endKey && keys.length < 1200) {
    keys.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return keys;
}

export interface ContractEffectiveWindow {
  startKey: string;
  endKey: string;
}

/**
 * The months a contract is effective: service start (or signature start) through `ends_on`, or a
 * full term when no explicit end date is recorded.
 */
export function contractEffectiveWindow(contract: Contract, now: Date = new Date()): ContractEffectiveWindow {
  const startKey =
    toMonthKey(contract.service_start_date) ||
    toMonthKey(contract.starts_on) ||
    toMonthKey(contract.signed_on) ||
    currentMonthKey(now);
  const endKey =
    toMonthKey(contract.ends_on) ||
    addMonths(startKey, Math.max(1, Math.round((Number(contract.term_years) || 1) * 12)) - 1);
  return endKey < startKey ? { startKey, endKey: startKey } : { startKey, endKey };
}

/** A month's money, attributed to the invoicing timing that produced it. */
export interface TimingSplitAmount {
  advance: number;
  arrears: number;
}

/**
 * The contract's line-derived charges split by invoicing timing, or null when the contract has no
 * billable lines (legacy / line-less agreements fall back to the total-only path).
 *
 * `arrearsAtCycleEnd` recognises a quarterly / annual charge billed in arrears on its cycle's last
 * service month (the month the invoice is raised) instead of the cycle's first month. Cashflow reads
 * the default split, because its own cycle bucketing already lands arrears money on the period end.
 */
export function contractChargeMonthsByTiming(
  contract: Contract,
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = [],
  options: { arrearsAtCycleEnd?: boolean } = {}
): Record<string, TimingSplitAmount> | null {
  const billableLines = (contract.lines || []).filter(l => l.line_kind !== 'man_hours');
  if (billableLines.length === 0) return null;

  const split: Record<string, TimingSplitAmount> = {};
  const window = contractEffectiveWindow(contract);
  calculatePeriodAmountsForPeriodsByTiming(
    billableLines,
    contract.discount_pct || 0,
    monthKeysBetween(window.startKey, window.endKey),
    catalogModules,
    catalogItems,
    contract.groups || [],
    contract.invoice_timing || 'start_of_period',
    { arrearsAtCycleEnd: options.arrearsAtCycleEnd === true }
  ).forEach(({ period, advance, arrears }) => {
    const adv = round2(advance);
    const arr = round2(arrears);
    if (adv !== 0 || arr !== 0) split[period] = { advance: adv, arrears: arr };
  });
  return split;
}

/**
 * The contract's own monthly charges — the revenue-recognition stream. A periodic charge billed in
 * arrears lands on its cycle's last service month, matching the month its invoice is raised.
 */
export function contractChargeMonths(
  contract: Contract,
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = []
): Record<string, number> {
  const months: Record<string, number> = {};
  const lines = contract.lines || [];

  // The price sheet is the source of truth: a persisted schedule is only a projection of it, so it
  // must never win over the current lines (a removed line or a moved term would keep charging).
  const split = contractChargeMonthsByTiming(contract, catalogModules, catalogItems, { arrearsAtCycleEnd: true });
  if (split) return totalChargesFromTiming(split);

  // Man-hours-only contracts are billed from timesheets (their change requests), never as a fixed value.
  if (lines.length > 0) return months;

  // Line-less legacy agreements: their saved projection is the only record of what was agreed.
  const schedule = contract.schedule || [];
  if (schedule.length > 0) {
    schedule.forEach(item => {
      const key = toMonthKey(item.period);
      const amount = round2(item.amount);
      if (key && amount !== 0) months[key] = round2((months[key] || 0) + amount);
    });
    return months;
  }

  const window = contractEffectiveWindow(contract);
  const term = monthKeysBetween(window.startKey, window.endKey);

  // Legacy agreements without structured lines: spread the recorded value across the term.
  const valuation = calculateContractValuation(
    [],
    contract.discount_pct || 0,
    contract.term_years || 1,
    `${window.startKey}-01`,
    catalogModules,
    catalogItems,
    contract.value || 0,
    contract.billing_cadence,
    contract.groups || []
  );

  if (contract.billing_cadence === 'one_off') {
    const amount = round2(valuation.oneTimeValue || valuation.netMonthlyMRR);
    if (amount !== 0) months[term[0]] = amount;
    return months;
  }

  const monthly = round2(valuation.netMonthlyMRR);
  if (monthly !== 0) term.forEach(key => { months[key] = monthly; });
  return months;
}

/**
 * Which lens the grid shows: `recognition` spreads each contract over the months the service is
 * delivered, `cashflow` lands the same money on the months it is actually billed.
 */
export type ScheduleBasis = 'recognition' | 'cashflow';

const CADENCE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };

/**
 * Re-buckets a monthly stream onto the contract's invoicing months. One value per billing cycle:
 * a quarterly agreement shows its quarter total once, on the period start (billed in advance) or the
 * period end (billed in arrears). One-off / milestone agreements keep the single month they land in.
 *
 * This is the total-only path: change-request rows and line-less legacy agreements. Contracts with
 * lines use resampleTimingToBillingMonths, which keeps advance and arrears money apart.
 */
export function resampleToBillingMonths(
  contract: Contract,
  monthly: Record<string, number>
): Record<string, number> {
  const billed: Record<string, number> = {};
  const chargeMonths = Object.keys(monthly).filter(key => Number(monthly[key]) !== 0).sort();
  if (chargeMonths.length === 0) return billed;

  const cycle = CADENCE_MONTHS[contract.billing_cadence || 'monthly'] ?? 0;
  if (cycle === 0) {
    // One-off / milestone: nothing to spread, the charge is billed where it lands.
    chargeMonths.forEach(key => { billed[key] = round2((billed[key] || 0) + monthly[key]); });
    return billed;
  }

  const billAtEnd = contract.invoice_timing === 'end_of_period';
  const window = contractEffectiveWindow(contract);
  const firstMonth = chargeMonths[0] < window.startKey ? chargeMonths[0] : window.startKey;
  // The last cycle has to reach its own end, or arrears money charged in its opening month would be
  // billed there instead of at the period end (second annual fee → January instead of December).
  const lastCharge = chargeMonths[chargeMonths.length - 1];
  const lastMonth = window.endKey > lastCharge ? window.endKey : lastCharge;
  const horizon = monthKeysBetween(firstMonth, lastMonth);

  // Cycles are anchored on the contract (not the calendar), exactly like getContractBillingPeriods.
  for (let index = 0; index < horizon.length; index += cycle) {
    const slice = horizon.slice(index, index + cycle);
    const total = slice.reduce((sum, key) => sum + (monthly[key] || 0), 0);
    if (total === 0) continue;
    const billingMonth = billAtEnd ? slice[slice.length - 1] : slice[0];
    billed[billingMonth] = round2((billed[billingMonth] || 0) + total);
  }
  return billed;
}

/** Collapses a timing split back into plain monthly charges (advance + arrears per month). */
export function totalChargesFromTiming(split: Record<string, TimingSplitAmount>): Record<string, number> {
  const months: Record<string, number> = {};
  Object.entries(split).forEach(([period, { advance, arrears }]) => {
    const value = round2(advance + arrears);
    if (value !== 0) months[period] = value;
  });
  return months;
}

/**
 * Cashflow for a contract whose lines bill on different timings. Each side of a cycle lands where it
 * is actually invoiced: in-advance money on the cycle's first month, arrears money on its last. A
 * one-off charged at activation therefore stays at the start of the term instead of being folded into
 * the quarter-end invoice with the recurring fees.
 */
export function resampleTimingToBillingMonths(
  contract: Contract,
  split: Record<string, TimingSplitAmount> | null
): Record<string, number> {
  const billed: Record<string, number> = {};
  if (!split) return billed;

  const chargeMonths = Object.keys(split)
    .filter(key => (split[key].advance || 0) !== 0 || (split[key].arrears || 0) !== 0)
    .sort();
  if (chargeMonths.length === 0) return billed;

  const cycle = CADENCE_MONTHS[contract.billing_cadence || 'monthly'] ?? 0;
  if (cycle === 0) {
    // One-off / milestone: the charge is billed where it lands, whichever timing it carries.
    chargeMonths.forEach(key => {
      const total = round2((split[key].advance || 0) + (split[key].arrears || 0));
      if (total !== 0) billed[key] = round2((billed[key] || 0) + total);
    });
    return billed;
  }

  const window = contractEffectiveWindow(contract);
  const firstMonth = chargeMonths[0] < window.startKey ? chargeMonths[0] : window.startKey;
  const lastCharge = chargeMonths[chargeMonths.length - 1];
  const lastMonth = window.endKey > lastCharge ? window.endKey : lastCharge;
  const horizon = monthKeysBetween(firstMonth, lastMonth);

  // Cycles are anchored on the contract, exactly like getContractBillingPeriods.
  for (let index = 0; index < horizon.length; index += cycle) {
    const slice = horizon.slice(index, index + cycle);
    const advance = round2(slice.reduce((sum, key) => sum + (split[key]?.advance || 0), 0));
    const arrears = round2(slice.reduce((sum, key) => sum + (split[key]?.arrears || 0), 0));
    if (advance !== 0) {
      const at = slice[0];
      billed[at] = round2((billed[at] || 0) + advance);
    }
    if (arrears !== 0) {
      const at = slice[slice.length - 1];
      billed[at] = round2((billed[at] || 0) + arrears);
    }
  }
  return billed;
}

export interface ContractProjectSchedule {
  project: Project;
  months: Record<string, number>;
}

/**
 * One entry per change request (project) under the contract. Each project's budget value is spread
 * evenly across the months it is planned (or actually ran) for, clamped to the contract's own
 * effective window; the last month absorbs the rounding remainder so the entry's total equals the
 * project value. A project without a budget value still gets an entry (with empty months) so the CR
 * is visible, and archived projects are dropped.
 */
export function contractProjectSchedules(
  contract: Contract,
  projects: Project[]
): ContractProjectSchedule[] {
  const window = contractEffectiveWindow(contract);
  const linked = projects.filter(p => p.contract_id === contract.id && p.status !== 'archived');

  return linked
    .sort((a, b) => {
      const startA = toMonthKey(a.starts_on) || toMonthKey(a.actual_start_on) || '';
      const startB = toMonthKey(b.starts_on) || toMonthKey(b.actual_start_on) || '';
      return startA.localeCompare(startB) || a.name.localeCompare(b.name);
    })
    .map(project => {
      const months: Record<string, number> = {};
      const value = Number(project.budget_value) || 0;
      if (value <= 0) return { project, months };

      const projectStart = toMonthKey(project.starts_on) || toMonthKey(project.actual_start_on) || window.startKey;
      const projectEnd = toMonthKey(project.ends_on) || toMonthKey(project.actual_end_on) || window.endKey;
      const startKey = projectStart < window.startKey ? window.startKey : projectStart;
      const endKey = projectEnd > window.endKey ? window.endKey : projectEnd;
      const projectMonths = monthKeysBetween(startKey, endKey);
      if (projectMonths.length === 0) return { project, months };

      const perMonth = round2(value / projectMonths.length);
      projectMonths.forEach((key, index) => {
        months[key] = index === projectMonths.length - 1
          ? round2(value - perMonth * (projectMonths.length - 1))
          : perMonth;
      });
      return { project, months };
    });
}

/** Builds the Excel-style grid: month columns, one CR row per project and month totals. */
export function buildRevenueSchedule(
  contracts: Contract[],
  projects: Project[],
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = [],
  options: { basis?: ScheduleBasis } = {}
): RevenueSchedule {
  const basis = options.basis || 'recognition';
  const rows: RevenueScheduleRow[] = [];
  const effectiveMonths = new Set<string>();

  const ordered = [...contracts].sort((a, b) => {
    const byCounterparty = (a.counterparty?.legal_name || '').localeCompare(b.counterparty?.legal_name || '');
    if (byCounterparty !== 0) return byCounterparty;
    return a.reference.localeCompare(b.reference);
  });

  ordered.forEach(contract => {
    const counterparty = contract.counterparty?.legal_name || 'Unassigned counterparty';
    const window = contractEffectiveWindow(contract);
    monthKeysBetween(window.startKey, window.endKey).forEach(key => effectiveMonths.add(key));

    // Cashflow re-buckets the raw split onto the contract's billing cycles; recognition reads the
    // monthly stream, where periodic arrears charges already sit on their cycle's last month.
    const timingSplit = basis === 'cashflow' ? contractChargeMonthsByTiming(contract, catalogModules, catalogItems) : null;
    const charges = timingSplit
      ? resampleTimingToBillingMonths(contract, timingSplit)
      : basis === 'cashflow'
        ? resampleToBillingMonths(contract, contractChargeMonths(contract, catalogModules, catalogItems))
        : contractChargeMonths(contract, catalogModules, catalogItems);
    const projectSchedules = contractProjectSchedules(contract, projects);

    Object.keys(charges).forEach(key => effectiveMonths.add(key));

    rows.push({
      id: `${contract.id}::contract`,
      kind: 'contract',
      contractId: contract.id,
      contract,
      counterparty,
      reference: contract.reference,
      product: contract.product || contract.type || '',
      months: charges,
    });

    // One row for all of the contract's change requests. Each month keeps the projects behind it,
    // so a cell that mixes several CRs can still say which ones it sums.
    if (projectSchedules.length > 0) {
      const months: Record<string, number> = {};
      const projectMonths: Record<string, ProjectMonthShare[]> = {};
      projectSchedules.forEach(({ project, months: projectMonthly }) => {
        const spread = basis === 'cashflow' ? resampleToBillingMonths(contract, projectMonthly) : projectMonthly;
        Object.entries(spread).forEach(([key, amount]) => {
          if (!amount) return;
          months[key] = round2((months[key] || 0) + amount);
          (projectMonths[key] ||= []).push({ project, amount });
        });
      });
      Object.keys(months).forEach(key => effectiveMonths.add(key));
      rows.push({
        id: `${contract.id}::projects`,
        kind: 'project',
        contractId: contract.id,
        contract,
        counterparty,
        reference: contract.reference,
        product: contract.product || contract.type || '',
        projects: projectSchedules.map(entry => entry.project),
        projectMonths,
        months,
      });
    }
  });

  const now = currentMonthKey();
  const months = Array.from(effectiveMonths).sort();
  const fallback = monthKeysBetween(`${now.slice(0, 4)}-01`, `${now.slice(0, 4)}-12`);
  const resolvedMonths = months.length > 0 ? months : fallback;

  const monthTotals: Record<string, number> = {};
  rows.forEach(row => {
    Object.entries(row.months).forEach(([key, amount]) => {
      monthTotals[key] = round2((monthTotals[key] || 0) + amount);
    });
  });

  return {
    rows,
    months: resolvedMonths,
    startKey: resolvedMonths[0],
    endKey: resolvedMonths[resolvedMonths.length - 1],
    monthTotals,
  };
}

/** Sum of one row's months inside a calendar year. */
export function yearTotalOf(months: Record<string, number>, year: number): number {
  const prefix = `${year}-`;
  return round2(
    Object.entries(months).reduce((total, [key, amount]) => (key.startsWith(prefix) ? total + amount : total), 0)
  );
}

export function groupMonthsByYear(months: string[]): Array<{ year: number; months: string[] }> {
  const groups: Array<{ year: number; months: string[] }> = [];
  months.forEach(key => {
    const year = Number(key.slice(0, 4));
    const current = groups[groups.length - 1];
    if (current && current.year === year) current.months.push(key);
    else groups.push({ year, months: [key] });
  });
  return groups;
}

export interface ScheduleExportRow {
  /** Counterparty, master agreement, stream and detail — the four identifying columns. */
  identity: [string, string, string, string];
  /** 'YYYY-MM' → amount, same source the grid renders. */
  months: Record<string, number>;
  /** Calendar year → total, so the workbook is self-contained without the frozen column. */
  yearTotals: Record<number, number>;
}

export interface ScheduleExportTable {
  /** Month columns in order, grouped by calendar year. */
  years: Array<{ year: number; months: string[] }>;
  rows: ScheduleExportRow[];
  totals: ScheduleExportRow;
}

const STREAM_LABELS: Record<RevenueStreamKind, string> = {
  contract: 'Contract charges',
  project: 'Change request',
};

/**
 * Flattens the grid into the table the Excel export writes: one line per stream (contract charges,
 * then its change requests), one column per month plus a total column per calendar year, and the
 * portfolio line at the bottom. Values stay numbers so Excel can sum them.
 */
export function scheduleExportTable(schedule: RevenueSchedule): ScheduleExportTable {
  const years = groupMonthsByYear(schedule.months);
  const toRow = (row: RevenueScheduleRow): ScheduleExportRow => ({
    identity: [
      row.counterparty,
      row.reference,
      STREAM_LABELS[row.kind] ?? row.kind,
      row.kind === 'project'
        ? (row.projects ?? []).map(project => project.code ? `${project.code} · ${project.name}` : project.name).join(' | ')
        : row.product,
    ],
    months: row.months,
    yearTotals: Object.fromEntries(years.map(group => [group.year, yearTotalOf(row.months, group.year)])),
  });

  return {
    years,
    rows: schedule.rows.map(toRow),
    totals: {
      identity: ['Portfolio total', '', '', ''],
      months: schedule.monthTotals,
      yearTotals: Object.fromEntries(years.map(group => [group.year, yearTotalOf(schedule.monthTotals, group.year)])),
    },
  };
}
