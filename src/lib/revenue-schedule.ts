import type { CatalogItem, CatalogModule, Contract, Project } from '@/lib/types';
import { calculateContractValuation, calculatePeriodAmountsForPeriods } from '@/lib/pricing-engine';

/**
 * Monthly revenue schedule used by the contract registry's "Revenue Schedule & MRR" grid.
 *
 * Every contract contributes two rows, mirroring the Excel revenue budget:
 *  - `contract` — the contract's own charges (stored `contract_schedule`, else the pricing lines);
 *  - `projects` — project-based change requests, i.e. each linked project's budget value spread
 *    evenly over the project's planned (or actual) delivery window.
 */

export type RevenueStreamKind = 'contract' | 'projects';

export interface RevenueScheduleRow {
  id: string;
  kind: RevenueStreamKind;
  contractId: string;
  contract: Contract;
  counterparty: string;
  reference: string;
  /** Contract product, used as the second line under the master agreement. */
  product: string;
  /** Change requests included in the `projects` row. */
  projectCount: number;
  /** Change requests that carry a budget value (the ones that produce monthly revenue). */
  budgetedProjectCount: number;
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

/** The contract's own monthly charges. */
export function contractChargeMonths(
  contract: Contract,
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = []
): Record<string, number> {
  const months: Record<string, number> = {};
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
  const lines = contract.lines || [];
  const billableLines = lines.filter(l => l.line_kind !== 'man_hours');

  if (billableLines.length > 0) {
    calculatePeriodAmountsForPeriods(
      billableLines,
      contract.discount_pct || 0,
      term,
      catalogModules,
      catalogItems,
      contract.groups || []
    ).forEach(({ period, amount }) => {
      const value = round2(amount);
      if (value !== 0) months[period] = value;
    });
    return months;
  }

  // Man-hours-only contracts are billed from timesheets (their change requests), never as a fixed value.
  if (lines.length > 0) return months;

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
 * Project-based change requests: each linked project's budget value is spread evenly across the
 * months it is planned (or actually ran) for, clamped to the contract's own effective window.
 * The last month absorbs the rounding remainder so the row total equals the project value.
 */
export function contractProjectMonths(
  contract: Contract,
  projects: Project[]
): { months: Record<string, number>; projectCount: number; budgetedProjectCount: number } {
  const months: Record<string, number> = {};
  const window = contractEffectiveWindow(contract);
  const linked = projects.filter(p => p.contract_id === contract.id && p.status !== 'archived');
  let budgetedProjectCount = 0;

  linked.forEach(project => {
    const value = Number(project.budget_value) || 0;
    if (value <= 0) return;
    budgetedProjectCount += 1;

    const projectStart = toMonthKey(project.starts_on) || toMonthKey(project.actual_start_on) || window.startKey;
    const projectEnd = toMonthKey(project.ends_on) || toMonthKey(project.actual_end_on) || window.endKey;
    const startKey = projectStart < window.startKey ? window.startKey : projectStart;
    const endKey = projectEnd > window.endKey ? window.endKey : projectEnd;
    const projectMonths = monthKeysBetween(startKey, endKey);
    if (projectMonths.length === 0) return;

    const perMonth = round2(value / projectMonths.length);
    projectMonths.forEach((key, index) => {
      const amount = index === projectMonths.length - 1
        ? round2(value - perMonth * (projectMonths.length - 1))
        : perMonth;
      months[key] = round2((months[key] || 0) + amount);
    });
  });

  return { months, projectCount: linked.length, budgetedProjectCount };
}

/** Builds the Excel-style grid: month columns, two rows per contract and month totals. */
export function buildRevenueSchedule(
  contracts: Contract[],
  projects: Project[],
  catalogModules: CatalogModule[] = [],
  catalogItems: CatalogItem[] = []
): RevenueSchedule {
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

    const charges = contractChargeMonths(contract, catalogModules, catalogItems);
    const projectBilling = contractProjectMonths(contract, projects);

    Object.keys(charges).forEach(key => effectiveMonths.add(key));
    Object.keys(projectBilling.months).forEach(key => effectiveMonths.add(key));

    rows.push({
      id: `${contract.id}::contract`,
      kind: 'contract',
      contractId: contract.id,
      contract,
      counterparty,
      reference: contract.reference,
      product: contract.product || contract.type || '',
      projectCount: projectBilling.projectCount,
      budgetedProjectCount: projectBilling.budgetedProjectCount,
      months: charges,
    });
    rows.push({
      id: `${contract.id}::projects`,
      kind: 'projects',
      contractId: contract.id,
      contract,
      counterparty,
      reference: contract.reference,
      product: contract.product || contract.type || '',
      projectCount: projectBilling.projectCount,
      budgetedProjectCount: projectBilling.budgetedProjectCount,
      months: projectBilling.months,
    });
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
