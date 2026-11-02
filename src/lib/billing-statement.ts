import type { CatalogItem, CatalogModule, Contract, Invoice, Project, Receipt } from '@/lib/types';
import { buildRevenueSchedule, type RevenueScheduleRow } from '@/lib/revenue-schedule';
import {
  buildInvoiceCoverage,
  buildProjectInvoiceCoverage,
  coverageTotal,
  invoiceCellKey,
  invoiceVarianceTone,
  mergeProjectCoverage,
  projectInvoiceCellKey,
  type InvoiceCellCoverage,
} from '@/lib/invoice-coverage';
import { buildInvoiceSuggestions, pendingInvoiceSuggestions, type InvoiceSuggestion } from '@/lib/invoice-suggestions';

/**
 * The Billing check statement for one client or one agreement: every stream of the agreements in
 * scope (their own charges, their change requests) with what it should earn each month, one block
 * per invoice box compared with that stream, and the periods still to invoice. Built from the same
 * coverage and suggestions as the portfolio schedules, so the two views always agree.
 */

export type StatementBlock =
  | { kind: 'invoice'; firstMonth: string; lastMonth: string; coverage: InvoiceCellCoverage }
  | { kind: 'due'; firstMonth: string; lastMonth: string; suggestion: InvoiceSuggestion };

export interface StatementStream {
  row: RevenueScheduleRow;
  blocks: StatementBlock[];
}

export interface BillingStatement {
  streams: StatementStream[];
  /** Calendar years the statement has anything in, ascending. */
  years: number[];
}

/** Splits sorted 'YYYY-MM' keys into runs of consecutive months. */
function monthRuns(months: string[]): string[][] {
  const runs: string[][] = [];
  [...months].sort().forEach(month => {
    const run = runs[runs.length - 1];
    const previous = run?.[run.length - 1];
    if (previous) {
      const [year, m] = previous.split('-').map(Number);
      const next = m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
      if (next === month) { run.push(month); return; }
    }
    runs.push([month]);
  });
  return runs;
}

export function buildBillingStatement(args: {
  /** The agreements the statement is about. */
  scope: Contract[];
  /** Every agreement — an invoice spanning several is measured against all of them. */
  contracts: Contract[];
  projects: Project[];
  invoices: Invoice[];
  receipts?: Receipt[];
  catalogModules?: CatalogModule[];
  catalogItems?: CatalogItem[];
  draftInvoiceIds?: Record<string, string>;
  today?: Date;
}): BillingStatement {
  const { scope, contracts, projects, invoices, receipts = [], catalogModules = [], catalogItems = [] } = args;
  const schedule = buildRevenueSchedule(scope, projects, catalogModules, catalogItems);
  const coverage = buildInvoiceCoverage(invoices, contracts, catalogModules, catalogItems, projects, receipts);
  const projectCoverage = buildProjectInvoiceCoverage(invoices, projects, receipts, contracts);
  const suggestions = pendingInvoiceSuggestions(
    buildInvoiceSuggestions(scope, { catalogModules, catalogItems, invoices, draftInvoiceIds: args.draftInvoiceIds, today: args.today }),
    (contractId, month) => coverage.has(invoiceCellKey(contractId, month))
  );

  const years = new Set(schedule.months.map(month => Number(month.slice(0, 4))));

  const streams = schedule.rows.map(row => {
    // Every month an invoice box touches on this row, wherever it lies against the schedule.
    const boxMonths = new Set<string>();
    const ownKeys = row.kind === 'contract' ? [row.contractId] : (row.projects ?? []).map(project => project.id);
    const source = row.kind === 'contract' ? coverage : projectCoverage;
    source.forEach((_, key) => {
      const split = key.lastIndexOf(':');
      if (ownKeys.includes(key.slice(0, split))) boxMonths.add(key.slice(split + 1));
    });
    const cellAt = (month: string) => row.kind === 'contract'
      ? coverage.get(invoiceCellKey(row.contractId, month))
      : mergeProjectCoverage((row.projects ?? []).map(project => projectCoverage.get(projectInvoiceCellKey(project.id, month))));

    // A box is listed once, from the cell that opens it (the one the schedule's badge sits on).
    const blocks: StatementBlock[] = [];
    const seen = new Set<string>();
    [...boxMonths].sort().forEach(month => {
      const cell = cellAt(month);
      if (!cell || cell.firstMonth !== month) return;
      const id = `${cell.firstMonth}|${cell.lastMonth}|${cell.invoiceIds.join(',')}|${cell.receipts.join(',')}`;
      if (seen.has(id)) return;
      seen.add(id);
      blocks.push({ kind: 'invoice', firstMonth: cell.firstMonth, lastMonth: cell.lastMonth, coverage: cell });
    });

    if (row.kind === 'contract') {
      suggestions
        .filter(suggestion => suggestion.contractId === row.contractId)
        .forEach(suggestion => monthRuns(suggestion.months).forEach(run => {
          blocks.push({ kind: 'due', firstMonth: run[0], lastMonth: run[run.length - 1], suggestion });
        }));
    }

    blocks.sort((a, b) => a.firstMonth.localeCompare(b.firstMonth));
    blocks.forEach(block => {
      years.add(Number(block.firstMonth.slice(0, 4)));
      years.add(Number(block.lastMonth.slice(0, 4)));
    });
    return { row, blocks };
  });

  return { streams, years: [...years].filter(Number.isFinite).sort((a, b) => a - b) };
}

export interface StatementSummary {
  /** Everything due to invoice now (each due period once), and how many periods that is. */
  toInvoice: number;
  duePeriods: number;
  /** Invoiced money (each row's share) in boxes opening in the year, against the year's expected charges. */
  invoiced: number;
  expected: number;
  /** Boxes opening in the year whose amount differs from what the agreement expects. */
  short: { count: number; amount: number };
  over: { count: number; amount: number };
}

export function statementSummary(statement: BillingStatement, year: number): StatementSummary {
  const prefix = `${year}-`;
  const dueIds = new Set<string>();
  const summary: StatementSummary = {
    toInvoice: 0, duePeriods: 0, invoiced: 0, expected: 0,
    short: { count: 0, amount: 0 }, over: { count: 0, amount: 0 },
  };

  statement.streams.forEach(({ row, blocks }) => {
    Object.entries(row.months).forEach(([month, amount]) => {
      if (month.startsWith(prefix)) summary.expected += amount;
    });
    blocks.forEach(block => {
      if (block.kind === 'due') {
        if (dueIds.has(block.suggestion.id)) return;
        dueIds.add(block.suggestion.id);
        summary.toInvoice += block.suggestion.amount;
        summary.duePeriods += 1;
        return;
      }
      if (!block.firstMonth.startsWith(prefix)) return;
      summary.invoiced += coverageTotal(block.coverage);
      const tone = invoiceVarianceTone(block.coverage);
      if (tone === 'under') { summary.short.count += 1; summary.short.amount += -block.coverage.variance; }
      if (tone === 'over') { summary.over.count += 1; summary.over.amount += block.coverage.variance; }
    });
  });

  const round2 = (value: number) => Math.round(value * 100) / 100;
  summary.toInvoice = round2(summary.toInvoice);
  summary.invoiced = round2(summary.invoiced);
  summary.expected = round2(summary.expected);
  summary.short.amount = round2(summary.short.amount);
  summary.over.amount = round2(summary.over.amount);
  return summary;
}
