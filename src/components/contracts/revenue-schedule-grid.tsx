"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  type BodyScrollEvent,
  type ColDef,
  type ColGroupDef,
  type DefaultMenuItem,
  type GetContextMenuItemsParams,
  type GridApi,
  type MenuItemDef,
  type GridReadyEvent,
  type IHeaderParams,
  type ICellRendererParams,
} from 'ag-grid-community';
import { useOrbitGridTheme, HAS_AG_GRID_LICENSE } from '@/lib/ag-grid-setup';
import type { CatalogItem, CatalogModule, Contract, Invoice, Project, Receipt } from '@/lib/types';
import { calculateContractValuation } from '@/lib/pricing-engine';
import { isSubcontract, primeFeeAmount } from '@/lib/subcontracts';
import { buildRevenueSchedule, explainScheduleCell, groupMonthsByYear, scheduleExportTable, yearTotalOf, type CellExplanation, type CellExplanationItem, type ProjectMonthShare, type ScheduleBasis, type RevenueScheduleRow } from '@/lib/revenue-schedule';
import {
  buildInvoiceCoverage,
  buildProjectInvoiceCoverage,
  coverageTotal,
  invoiceCellKey,
  invoiceCellStyle,
  invoiceMarkerColor,
  invoiceMarkerPosition,
  invoiceVarianceTone,
  projectInvoiceCellKey,
  type InvoiceCellCoverage,
  type InvoiceCoverageMap,
  type InvoiceVarianceTone,
} from '@/lib/invoice-coverage';
import {
  buildInvoiceSuggestions,
  suggestionCellKey,
  suggestionCellStyle,
  type InvoiceSuggestion,
} from '@/lib/invoice-suggestions';
import type { BillingPeriodItem } from '@/lib/billing-periods';
import Link from 'next/link';
import { Modal, Badge } from '@/components/ui/primitives';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { Search, CalendarClock, TrendingUp, Layers, ArrowRight, ArrowUpRight, Maximize2, Minimize2, Users, AlertTriangle, X, Plus, BarChart3, Banknote, Download, Building2, Rows3 } from 'lucide-react';

interface RevenueScheduleGridProps {
  contracts: Contract[];
  projects: Project[];
  catalogModules: CatalogModule[];
  catalogItems: CatalogItem[];
  invoices?: Invoice[];
  /** Receipts (money paid without a tax document) also paint the months they cover. */
  receipts?: Receipt[];
  /** Optimistic "draft created" marks keyed `${contractId}::${periodKey}` — hides the suggestion at once. */
  draftInvoiceIds?: Record<string, string>;
  /** Creates the draft invoice for a suggested billing period (same path as the contract dossier). */
  onCreateInvoice?: (contract: Contract, period: BillingPeriodItem) => void | Promise<void>;
  onOpenContract?: (contract: Contract) => void;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_WIDTH = 84;

const monthLabel = (key: string) => MONTH_LABELS[Number(key.slice(5, 7)) - 1] || key;

const formatAmount = (value: number | null | undefined) => {
  const amount = Number(value) || 0;
  if (amount === 0) return '—';
  return `€${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

const formatTotal = (value: number | null | undefined) =>
  `€${(Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const formatSignedAmount = (value: number) => `${value < 0 ? '−' : '+'}${formatTotal(Math.abs(value))}`;

/** Badge colours for the invoiced-vs-contract comparison: short, exact, or over-billed. */
/** Month cells carry a badge above the amount, so they keep a slimmer padding than AG Grid's default. */
const MONTH_CELL_PADDING = { paddingLeft: 2, paddingRight: 6 };

const VARIANCE_TONES: Record<InvoiceVarianceTone, { background: string; color: string }> = {
  // Theme tokens: the chip keeps its hue but takes the shade that reads on the active scheme.
  match: { background: 'color-mix(in srgb, var(--positive) 18%, transparent)', color: 'var(--positive)' },
  under: { background: 'color-mix(in srgb, var(--danger) 18%, transparent)', color: 'var(--danger)' },
  over: { background: 'color-mix(in srgb, var(--warning) 22%, transparent)', color: 'var(--warning)' },
};

/** A draft is not a billing mismatch yet, so it gets one neutral tone whatever the variance. */
const DRAFT_TONE = {
  background: 'color-mix(in srgb, var(--ink-3) 18%, transparent)',
  color: 'var(--ink-2)',
};

function suggestionTooltip(suggestion: InvoiceSuggestion): string {
  return [
    `Suggested invoice ${formatTotal(suggestion.amount)}`,
    suggestion.period.label,
    suggestion.timing === 'end_of_period' ? 'billed in arrears (period end)' : 'billed in advance (period start)',
    `invoice date ${suggestion.invoiceDate}`,
  ].join(' · ');
}

function coverageTooltip(coverage: InvoiceCellCoverage): string {
  const tone = invoiceVarianceTone(coverage);
  const comparison = tone === 'match'
    ? 'matches the contract'
    : `variance ${formatSignedAmount(coverage.variance)}`;
  return [
    coverage.invoices.length > 0 ? `Invoiced ${formatTotal(coverage.invoiceTotal)}` : undefined,
    coverage.receipts.length > 0
      ? `Received ${formatTotal(coverage.receiptTotal)} (${coverage.receipts.join(', ')})${
          coverage.invoiceTotal > 0 ? '' : ' without a tax invoice'
        }`
      : undefined,
    `covered ${formatTotal(coverageTotal(coverage))}`,
    `expected ${formatTotal(coverage.contractTotal)}`,
    comparison,
    coverage.invoices.join(', '),
    coverage.issueDate ? `issued ${coverage.issueDate}` : undefined,
    coverage.draft ? 'draft, not issued yet' : coverage.paid ? 'paid' : 'not paid yet',
  ].filter(Boolean).join(' · ');
}

/** Stored VAT rates appear as '24%' (register) or '24' (older auto-drafts) — print one form. */
const formatVatRate = (rate?: string | null) => {
  const raw = String(rate ?? '').trim();
  return raw.includes('%') ? raw : raw ? `${raw}%` : '24%';
};

/** Merge every covered project of a change-request row into the box drawn on that cell. */
function projectCellCoverage(
  row: RevenueScheduleRow,
  month: string,
  coverage: InvoiceCoverageMap
): InvoiceCellCoverage | undefined {
  const entries = (row.projects ?? [])
    .map(project => coverage.get(projectInvoiceCellKey(project.id, month)))
    .filter((entry): entry is InvoiceCellCoverage => Boolean(entry));
  if (entries.length === 0) return undefined;

  const merged: InvoiceCellCoverage = entries.length === 1 ? { ...entries[0] } : {
    contractId: entries[0].contractId,
    paid: entries.every(entry => entry.paid),
    draft: entries.every(entry => entry.draft),
    firstMonth: entries.map(entry => entry.firstMonth).sort()[0],
    lastMonth: entries.map(entry => entry.lastMonth).sort().slice(-1)[0],
    markerMonth: entries.map(entry => entry.markerMonth).sort().slice(-1)[0],
    markerPosition: 'middle',
    invoices: entries.flatMap(entry => entry.invoices).slice(-3),
    invoiceIds: entries.flatMap(entry => entry.invoiceIds).slice(-3),
    issueDate: entries.map(entry => entry.issueDate).sort().slice(-1)[0],
    invoiceTotal: Math.round(entries.reduce((sum, entry) => sum + entry.invoiceTotal, 0) * 100) / 100,
    receiptTotal: Math.round(entries.reduce((sum, entry) => sum + entry.receiptTotal, 0) * 100) / 100,
    receipts: entries.flatMap(entry => entry.receipts).slice(-3),
    contractTotal: 0,
    variance: 0,
  };
  merged.markerPosition = invoiceMarkerPosition(merged.markerMonth, merged.firstMonth, merged.lastMonth);
  // A change-request invoice is usually raised after the delivery months, so comparing it with the
  // row's charges inside the invoice window would flag a variance that is not a billing error.
  merged.contractTotal = coverageTotal(merged);
  merged.variance = 0;
  return merged;
}

/** Short badge label for a project: its code when it has one, else its name. */
const projectBadgeLabel = (project: Project) => project.code?.trim() || project.name;

/** Mouse-over text for a change-request cell: the money and the projects that make it up. */
function projectCellTooltip(key: string, shares: ProjectMonthShare[]): string {
  const total = shares.reduce((sum, share) => sum + share.amount, 0);
  return [
    `${monthLabel(key)} ${key.slice(0, 4)} · change requests ${formatTotal(total)}`,
    ...shares.map(share => `${projectBadgeLabel(share.project)} · ${share.project.name} — ${formatTotal(share.amount)}`),
  ].join('\n');
}

/** Searchable text for a row: counterparty, agreement, product and every project behind it. */
function quickFilterText(data?: RevenueScheduleRow): string {
  if (!data) return '';
  return [
    data.counterparty,
    data.endCustomer,
    data.reference,
    data.product,
    ...(data.projects ?? []).flatMap(project => [project.code || '', project.name]),
  ].join(' ');
}

/** How the schedule's rows are grouped: by payer, by the client the work serves, or not at all. */
type ScheduleGrouping = 'counterparty' | 'endCustomer' | 'flat';

interface YearStore {
  getYear: () => number;
  setYear: (year: number) => void;
  subscribe: (listener: (year: number) => void) => () => void;
}

function createYearStore(initial: number): YearStore {
  let year = initial;
  const listeners = new Set<(year: number) => void>();
  return {
    getYear: () => year,
    setYear: next => {
      if (next === year) return;
      year = next;
      listeners.forEach(listener => listener(next));
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * The frozen right-hand total follows the calendar year at the centre of the month area, so a
 * wide (full-screen) viewport that still shows December of the previous year keeps totalling the
 * year most of it displays. Keeping the year in a store (rather than in the column definitions)
 * means crossing a year boundary never recreates the columns or resets the horizontal scroll.
 */
function YearTotalHeader(props: IHeaderParams & { yearStore?: YearStore }) {
  const yearStore = props.yearStore;
  const [year, setYear] = useState<number>(() => yearStore?.getYear() ?? new Date().getFullYear());

  useEffect(() => {
    if (!yearStore) return;
    return yearStore.subscribe(setYear);
  }, [yearStore]);

  return (
    <span className="inline-flex items-baseline gap-1 font-black tracking-wide">
      {year}
      <span className="text-[9px] uppercase tracking-widest opacity-70">Total</span>
    </span>
  );
}

/**
 * First-column renderer. Used directly for flat rows and as the auto group column's inner cell
 * renderer, where `params.value` carries the counterparty for both group and leaf rows.
 */
function CounterpartyStreamRenderer(params: ICellRendererParams<RevenueScheduleRow>) {
  if (params.node?.rowPinned) {
    return <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">Portfolio total</span>;
  }
  if (params.node?.group) {
    return <span className="text-[11px] font-extrabold text-slate-800 truncate">{String(params.value ?? '')}</span>;
  }
  const isContractRow = params.data?.kind === 'contract';
  return (
    <div className="leading-[1.15]">
      <div className="text-[11px] font-bold text-slate-800 truncate">
        {String(params.value ?? params.data?.counterparty ?? '')}
      </div>
      <div className={`text-[9px] font-semibold flex items-center gap-1 ${isContractRow ? 'text-[var(--accent)]' : 'text-amber-600'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isContractRow ? 'bg-[var(--accent)]' : 'bg-amber-500'}`} />
        {isContractRow ? 'Contract charges' : 'Change request'}
      </div>
    </div>
  );
}

const INVOICE_STATUS_LABELS: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
  draft: { label: 'Draft', variant: 'neutral' },
  registered: { label: 'Registered', variant: 'info' },
  sent_received: { label: 'Sent', variant: 'info' },
  partially_paid: { label: 'Partially paid', variant: 'warning' },
  paid: { label: 'Paid', variant: 'success' },
  disputed: { label: 'Disputed', variant: 'error' },
  resolved: { label: 'Resolved', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

/**
 * Read-only peek at the invoices behind a green box. Opened from the amount badge so the schedule
 * stays on screen — the register is never navigated away from.
 */
function InvoicePeekModal({ invoices, contract, onClose }: {
  invoices: Invoice[];
  contract?: Contract;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (invoices.length === 0) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="md"
      title={invoices.length === 1 ? `Invoice ${invoices[0].invoice_number}` : `${invoices.length} invoices`}
    >
      <div className="space-y-3">
        {invoices.map(invoice => {
          const status = INVOICE_STATUS_LABELS[invoice.status] || { label: invoice.status, variant: 'neutral' as const };
          return (
            <div key={invoice.id} className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-black text-slate-900 truncate">{invoice.invoice_number}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {invoice.counterparty?.legal_name || '—'}
                    {contract ? ` · ${contract.reference}` : ''}
                  </div>
                </div>
                <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <div>
                  <dt className="font-bold uppercase tracking-wider text-[9px] text-slate-400">Issued</dt>
                  <dd className="font-mono text-slate-800">{formatDate(invoice.issue_date)}</dd>
                </div>
                <div>
                  <dt className="font-bold uppercase tracking-wider text-[9px] text-slate-400">Due</dt>
                  <dd className="font-mono text-slate-800">{formatDate(invoice.due_date)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="font-bold uppercase tracking-wider text-[9px] text-slate-400">Service period</dt>
                  <dd className="font-mono text-slate-800">
                    {formatDate(invoice.period_from)} → {formatDate(invoice.period_to)}
                  </dd>
                </div>
              </dl>

              <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 border border-slate-200/70 p-2 text-center">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Net</div>
                  <div className="font-mono text-xs font-bold text-slate-800">{formatMoney(invoice.net, invoice.currency)}</div>
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">VAT {formatVatRate(invoice.vat_rate)}</div>
                  <div className="font-mono text-xs font-bold text-slate-800">{formatMoney(invoice.vat_amount, invoice.currency)}</div>
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Gross</div>
                  <div className="font-mono text-xs font-black text-slate-900">{formatMoney(invoice.gross, invoice.currency)}</div>
                </div>
              </div>

              {invoice.currency !== 'EUR' && (
                <div className="text-[10px] text-slate-500 font-mono text-right">
                  EUR reporting amount {formatMoney(invoice.gross_eur, 'EUR')} @ {invoice.fx_rate}
                </div>
              )}

              <div className="flex justify-end">
                <Link
                  href={`/invoices/${invoice.id}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                >
                  Open invoice <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** One contributor to an explained cell; a pricing group nests its own lines under its floor steps. */
function ExplanationItemCard({ item }: { item: CellExplanationItem }) {
  const isGroup = Boolean(item.children);
  return (
    <div className={`rounded-xl border p-3 ${isGroup ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-bold text-slate-800 truncate">{item.label}</span>
        <span className="font-mono text-[12px] font-bold text-slate-900 shrink-0">{formatTotal(item.amount)}</span>
      </div>
      <ol className={`mt-1.5 space-y-0.5 border-l-2 pl-2 text-[11px] tabular-nums ${isGroup ? 'border-amber-300 text-amber-800' : 'border-slate-200 text-slate-500'}`}>
        {item.steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}
      </ol>
      {item.children && (
        <div className="mt-2 space-y-2">
          {item.children.map((child, index) => <ExplanationItemCard key={`${child.label}-${index}`} item={child} />)}
        </div>
      )}
    </div>
  );
}

/** Right-click explanation of a month cell: which price lines (or CRs) land there and how each is priced. */
function CellExplanationModal({ row, month, basis, explanation, onClose }: {
  row: RevenueScheduleRow;
  month: string;
  basis: ScheduleBasis;
  explanation: CellExplanation;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      eyebrow={`${basis === 'cashflow' ? 'Cashflow' : 'Revenue'} · ${row.kind === 'contract' ? 'Contract charges' : 'Change requests'} · ${row.counterparty}`}
      title={`${monthLabel(month)} ${month.slice(0, 4)} · ${row.reference}`}
    >
      <div className="space-y-1.5 text-[12px] text-slate-500">
        {explanation.method.map(text => <p key={text}>{text}</p>)}
      </div>

      {explanation.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-3 text-[12px] text-slate-500">Nothing is charged on this month.</p>
      ) : (
        <div className="space-y-2">
          {explanation.items.map((item, index) => <ExplanationItemCard key={`${item.label}-${index}`} item={item} />)}
        </div>
      )}

      <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cell value</span>
        <span className="font-mono text-sm font-black text-slate-900">{formatTotal(explanation.total)}</span>
      </div>
    </Modal>
  );
}

interface CellSelectionStats {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

/**
 * Aggregates the numeric cells in the current cell selection (Shift+click or drag). Group rows use
 * their aggregated values, leaf rows their month amounts (blank months are skipped), and the
 * frozen year-total column follows the visible year.
 */
function computeSelectionStats(api: GridApi<RevenueScheduleRow>, year: number): CellSelectionStats | null {
  const ranges = api.getCellRanges();
  if (!ranges || ranges.length === 0) return null;

  const seen = new Set<string>();
  let count = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  ranges.forEach(range => {
    if (!range.startRow || !range.endRow || range.startRow.rowPinned || range.endRow.rowPinned) return;
    const start = Math.min(range.startRow.rowIndex, range.endRow.rowIndex);
    const end = Math.max(range.startRow.rowIndex, range.endRow.rowIndex);

    for (let rowIndex = start; rowIndex <= end; rowIndex++) {
      const node = api.getDisplayedRowAtIndex(rowIndex);
      if (!node) continue;
      const data = node.data as RevenueScheduleRow | undefined;
      const aggData = node.aggData as Record<string, number> | undefined;

      range.columns.forEach(column => {
        const colId = column.getColId();
        let value: number | undefined;
        if (colId === 'year-total') {
          value = node.group ? aggData?.[colId] : (data?.months ? yearTotalOf(data.months, year) : undefined);
        } else if (colId.startsWith('m-')) {
          value = node.group ? aggData?.[colId] : data?.months?.[colId.slice(2)];
        }
        if (value === undefined || value === null) return;
        const amount = Number(value);
        if (!Number.isFinite(amount)) return;

        const cellKey = `${rowIndex}:${colId}`;
        if (seen.has(cellKey)) return;
        seen.add(cellKey);

        count += 1;
        sum += amount;
        if (amount < min) min = amount;
        if (amount > max) max = amount;
      });
    }
  });

  if (count === 0) return null;
  return {
    count,
    sum: Math.round(sum * 100) / 100,
    avg: Math.round((sum / count) * 100) / 100,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
  };
}

export const RevenueScheduleGrid: React.FC<RevenueScheduleGridProps> = ({
  contracts,
  projects,
  catalogModules,
  catalogItems,
  invoices = [],
  receipts = [],
  draftInvoiceIds,
  onCreateInvoice,
  onOpenContract,
}) => {
  const gridTheme = useOrbitGridTheme();
  const gridApiRef = useRef<GridApi<RevenueScheduleRow> | null>(null);
  const [gridApi, setGridApi] = useState<GridApi<RevenueScheduleRow> | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [quickFilter, setQuickFilter] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [groupBy, setGroupBy] = useState<ScheduleGrouping>(HAS_AG_GRID_LICENSE ? 'counterparty' : 'flat');
  const isGrouped = groupBy !== 'flat';
  /** Recognition = money spread over the service months; cashflow = money on the months it is billed. */
  const [scheduleBasis, setScheduleBasis] = useState<ScheduleBasis>('recognition');
  const [pendingSuggestions, setPendingSuggestions] = useState<Record<string, true>>({});
  const [isExporting, setIsExporting] = useState(false);
  const [peek, setPeek] = useState<{ contract: Contract; invoiceIds: string[] } | null>(null);
  const [explain, setExplain] = useState<{ row: RevenueScheduleRow; month: string } | null>(null);
  const currentYear = new Date().getFullYear();
  const yearStore = useMemo(() => createYearStore(currentYear), [currentYear]);
  const visibleYear = useSyncExternalStore(yearStore.subscribe, yearStore.getYear, yearStore.getYear);
  const autoScrolledRef = useRef(false);

  const schedule = useMemo(
    () => buildRevenueSchedule(contracts, projects, catalogModules, catalogItems, { basis: scheduleBasis }),
    [contracts, projects, catalogModules, catalogItems, scheduleBasis]
  );
  // The grid's cell selection lives outside React: `selectionVersion` (bumped by AG Grid's
  // selection event) and `schedule.rows` are deliberate invalidation keys for this memo.
  const selectionStats = useMemo(
    () => (gridApi ? computeSelectionStats(gridApi, visibleYear) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gridApi, selectionVersion, visibleYear, schedule.rows]
  );
  // Invoiced months are read inside AG Grid callbacks, so the map lives in a ref: refreshing the
  // cells (below) picks up new invoices without rebuilding the column definitions and losing scroll.
  // The end-customer column only earns its width once a subcontract is on the schedule.
  const hasSubcontracts = useMemo(() => schedule.rows.some(row => row.supply !== 'prime'), [schedule.rows]);

  const invoiceCoverage = useMemo(
    () => buildInvoiceCoverage(invoices, contracts, catalogModules, catalogItems, projects, receipts),
    [invoices, contracts, catalogModules, catalogItems, projects, receipts]
  );
  const draftCoverageCount = useMemo(
    () => Array.from(invoiceCoverage.values()).filter(entry => entry.draft).length,
    [invoiceCoverage]
  );
  const receiptCoverageCount = useMemo(
    () => Array.from(invoiceCoverage.values()).filter(entry => entry.receiptTotal > 0).length,
    [invoiceCoverage]
  );
  const invoiceCoverageRef = useRef<InvoiceCoverageMap>(new Map());
  useEffect(() => {
    invoiceCoverageRef.current = invoiceCoverage;
    gridApiRef.current?.redrawRows();
  }, [invoiceCoverage]);

  // Change-request rows show the invoices their projects are billed by.
  const projectCoverage = useMemo(
    () => buildProjectInvoiceCoverage(invoices, projects, receipts),
    [invoices, projects, receipts]
  );
  const projectCoverageRef = useRef<InvoiceCoverageMap>(new Map());
  useEffect(() => {
    projectCoverageRef.current = projectCoverage;
    gridApiRef.current?.redrawRows();
  }, [projectCoverage]);

  // Suggested invoices: billing periods already due under the contract's cadence and invoicing
  // timing that still have no invoice. Months already invoiced drop out of the suggestion box.
  const invoiceSuggestions = useMemo(() => {
    const byCell = new Map<string, InvoiceSuggestion>();
    const list: InvoiceSuggestion[] = [];

    buildInvoiceSuggestions(contracts, {
      catalogModules,
      catalogItems,
      invoices,
      draftInvoiceIds,
    }).forEach(suggestion => {
      const months = suggestion.months.filter(
        month => !invoiceCoverage.has(invoiceCellKey(suggestion.contractId, month))
      );
      if (months.length === 0) return;
      const pending = { ...suggestion, months, actionMonth: months[0] };
      list.push(pending);
      months.forEach(month => byCell.set(suggestionCellKey(suggestion.contractId, month), pending));
    });

    return { list, byCell };
  }, [contracts, catalogModules, catalogItems, invoices, draftInvoiceIds, invoiceCoverage]);

  const suggestionRef = useRef<Map<string, InvoiceSuggestion>>(new Map());
  useEffect(() => {
    suggestionRef.current = invoiceSuggestions.byCell;
    gridApiRef.current?.redrawRows();
  }, [invoiceSuggestions]);

  const pendingSuggestionsRef = useRef<Record<string, true>>({});
  useEffect(() => {
    pendingSuggestionsRef.current = pendingSuggestions;
    gridApiRef.current?.redrawRows();
  }, [pendingSuggestions]);

  // Invoice details for the peek modal are resolved from the loaded register, kept in a ref so the
  // AG Grid cell renderer can open it without the column definitions depending on the invoice list.
  const invoicesById = useMemo(() => new Map(invoices.map(invoice => [invoice.id, invoice])), [invoices]);
  const invoicesByIdRef = useRef(invoicesById);
  useEffect(() => { invoicesByIdRef.current = invoicesById; }, [invoicesById]);

  const openPeekRef = useRef<(contract: Contract, invoiceIds: string[]) => void>(() => {});
  useEffect(() => {
    openPeekRef.current = (contract, invoiceIds) => {
      if (invoiceIds.some(id => invoicesByIdRef.current.has(id))) setPeek({ contract, invoiceIds });
    };
  }, []);

  const explanation = useMemo(
    () => (explain ? explainScheduleCell(explain.row, explain.month, scheduleBasis, catalogModules, catalogItems) : null),
    [explain, scheduleBasis, catalogModules, catalogItems]
  );

  // Licensed grids keep AG Grid's own menu (copy, export) and gain the explanation on month cells.
  const getContextMenuItems = useCallback(
    (params: GetContextMenuItemsParams<RevenueScheduleRow>): (DefaultMenuItem | MenuItemDef<RevenueScheduleRow>)[] => {
      const colId = params.column?.getColId() ?? '';
      const row = params.node?.data;
      const defaults = params.defaultItems ?? [];
      if (!colId.startsWith('m-') || !row || params.node?.rowPinned || params.node?.group) return defaults;
      return [
        { name: 'How is this value calculated?', action: () => setExplain({ row, month: colId.slice(2) }) },
        'separator',
        ...defaults,
      ];
    },
    []
  );

  const peekInvoices = peek
    ? peek.invoiceIds.map(id => invoicesById.get(id)).filter((invoice): invoice is Invoice => Boolean(invoice))
    : [];

  const createInvoiceRef = useRef(onCreateInvoice);
  useEffect(() => { createInvoiceRef.current = onCreateInvoice; }, [onCreateInvoice]);

  const createDraft = useCallback(async (suggestion: InvoiceSuggestion) => {
    if (!createInvoiceRef.current || pendingSuggestionsRef.current[suggestion.id]) return;
    setPendingSuggestions(previous => ({ ...previous, [suggestion.id]: true }));
    try {
      await createInvoiceRef.current(suggestion.contract, suggestion.period);
    } finally {
      setPendingSuggestions(previous => {
        const next = { ...previous };
        delete next[suggestion.id];
        return next;
      });
    }
  }, []);

  const createDraftRef = useRef(createDraft);
  useEffect(() => { createDraftRef.current = createDraft; }, [createDraft]);

  const yearGroups = useMemo(() => groupMonthsByYear(schedule.months), [schedule.months]);
  const years = useMemo(() => yearGroups.map(group => group.year), [yearGroups]);
  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  /** Generated first column when grouping: expand/collapse + the counterparty, then its sublabel. */
  const autoGroupColumnDef = useMemo<ColDef<RevenueScheduleRow>>(() => ({
    headerName: groupBy === 'endCustomer' ? 'End customer' : 'Counterparty',
    pinned: 'left',
    width: 220,
    minWidth: 180,
    suppressMovable: true,
    sortable: false,
    filter: false,
    resizable: false,
    cellClass: 'cursor-pointer',
    cellRendererParams: {
      suppressCount: true,
      innerRenderer: CounterpartyStreamRenderer,
    },
  }), [groupBy]);

  const portfolioMRR = useMemo(
    () => contracts.reduce((total, contract) => {
      const valuation = calculateContractValuation(
        contract.lines || [],
        contract.discount_pct || 0,
        contract.term_years || 1,
        contract.service_start_date || contract.starts_on,
        catalogModules,
        catalogItems,
        contract.value || 0,
        contract.billing_cadence,
        contract.groups || []
      );
      return total + valuation.netMonthlyMRR;
    }, 0),
    [contracts, catalogModules, catalogItems]
  );

  // Subcontracts are billed gross and the prime keeps a fee; MRR stays gross, the header states
  // what actually lands with us once those fees are taken off.
  const primeFees = useMemo(
    () => contracts.reduce((total, contract) => {
      if (!isSubcontract(contract)) return total;
      const valuation = calculateContractValuation(
        contract.lines || [],
        contract.discount_pct || 0,
        contract.term_years || 1,
        contract.service_start_date || contract.starts_on,
        catalogModules,
        catalogItems,
        contract.value || 0,
        contract.billing_cadence,
        contract.groups || []
      );
      return total + primeFeeAmount(contract, valuation.netMonthlyMRR);
    }, 0),
    [contracts, catalogModules, catalogItems]
  );

  const reflectYear = useCallback((year: number) => {
    if (year === yearStore.getYear()) return;
    yearStore.setYear(year);
    gridApiRef.current?.refreshCells({ columns: ['year-total'], force: true });
    // Group rows hold the year total in their aggregated data, so it must be recomputed too.
    if (isGrouped) {
      gridApiRef.current?.refreshClientSideRowModel('aggregate');
      setSelectionVersion(version => version + 1);
    }
  }, [yearStore, isGrouped]);

  // Escape leaves the maximised card, unless a dossier modal (z-50) is on top and owns the key.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.fixed.inset-0.z-50')) return;
      setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  // Keep the frozen total inside the rendered range even when the data (or the clock) moves on.
  useEffect(() => {
    if (years.length === 0) return;
    const current = yearStore.getYear();
    if (years.includes(current)) return;
    yearStore.setYear(Math.min(Math.max(current, years[0]), years[years.length - 1]));
    gridApiRef.current?.refreshCells({ columns: ['year-total'], force: true });
    if (isGrouped) gridApiRef.current?.refreshClientSideRowModel('aggregate');
  }, [years, yearStore, isGrouped]);

  const scrollToCurrentYear = useCallback((api: GridApi<RevenueScheduleRow>) => {
    if (years.length === 0) return;
    const targetYear = currentYear < years[0] ? years[0] : currentYear > years[years.length - 1] ? years[years.length - 1] : currentYear;
    reflectYear(targetYear);
    const columnId = `m-${targetYear}-01`;
    if (api.getColumn(columnId)) api.ensureColumnVisible(columnId, 'start');
  }, [years, currentYear, reflectYear]);

  useEffect(() => {
    if (autoScrolledRef.current || !gridApiRef.current || schedule.months.length === 0) return;
    autoScrolledRef.current = true;
    scrollToCurrentYear(gridApiRef.current);
  }, [schedule.startKey, schedule.endKey, schedule.months.length, scrollToCurrentYear]);

  const handleGridReady = useCallback((event: GridReadyEvent<RevenueScheduleRow>) => {
    gridApiRef.current = event.api;
    setGridApi(event.api);
    if (!autoScrolledRef.current && schedule.months.length > 0) {
      autoScrolledRef.current = true;
      scrollToCurrentYear(event.api);
    }
  }, [scrollToCurrentYear, schedule.months.length]);

  /** Reads the year under the centre of the visible month area and keeps the frozen total on it. */
  const syncVisibleYear = useCallback((api: GridApi<RevenueScheduleRow>) => {
    const centerColumns = api.getDisplayedCenterColumns();
    const range = api.getHorizontalPixelRange();
    const midpoint = Math.max(0, (range.left + range.right) / 2);
    let year: number | null = null;

    for (const column of centerColumns) {
      const columnLeft = column.getLeft() ?? 0;
      if (columnLeft + column.getActualWidth() > midpoint) {
        const columnId = column.getColId();
        if (columnId.startsWith('m-')) year = Number(columnId.slice(2, 6));
        break;
      }
    }

    if (year != null && Number.isFinite(year)) reflectYear(year);
  }, [reflectYear]);

  const handleBodyScroll = useCallback((event: BodyScrollEvent<RevenueScheduleRow>) => {
    syncVisibleYear(event.api);
  }, [syncVisibleYear]);

  /**
   * Excel export of exactly what the grid shows: one line per contract charge stream and change
   * request, a column per month with a total column per calendar year, and the portfolio line.
   * `xlsx` is loaded on demand so the schedule screen stays light.
   */
  const exportToExcel = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const XLSX = await import('xlsx');
      const table = scheduleExportTable(schedule);
      const fixedHeaders = ['Counterparty', 'Master agreement', 'Stream', 'Detail'];
      const yearHeader = new Array<string>(fixedHeaders.length).fill('');
      const columnHeader = [...fixedHeaders];
      table.years.forEach(({ year, months }) => {
        yearHeader.push(String(year));
        months.slice(1).forEach(() => yearHeader.push(''));
        yearHeader.push('');
        months.forEach(month => columnHeader.push(monthLabel(month)));
        columnHeader.push(`${year} total`);
      });

      const body: Array<Array<string | number>> = table.rows.map(row => {
        const cells: Array<string | number> = [...row.identity];
        table.years.forEach(({ year, months }) => {
          months.forEach(month => cells.push(row.months[month] ?? 0));
          cells.push(row.yearTotals[year] ?? 0);
        });
        return cells;
      });
      const totalRow: Array<string | number> = [...table.totals.identity];
      table.years.forEach(({ year, months }) => {
        months.forEach(month => totalRow.push(table.totals.months[month] ?? 0));
        totalRow.push(table.totals.yearTotals[year] ?? 0);
      });

      const sheet = XLSX.utils.aoa_to_sheet([yearHeader, columnHeader, ...body, totalRow]);
      const lastColumn = columnHeader.length - 1;
      sheet['!merges'] = table.years.reduce<Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>>((merges, { months }, index) => {
        const start = fixedHeaders.length + table.years
          .slice(0, index)
          .reduce((columns, group) => columns + group.months.length + 1, 0);
        merges.push({ s: { r: 0, c: start }, e: { r: 0, c: start + months.length } });
        return merges;
      }, []);
      sheet['!cols'] = columnHeader.map((_, index) => {
        if (index === 0) return { wch: 30 };
        if (index === 1) return { wch: 22 };
        if (index === 2) return { wch: 17 };
        if (index === 3) return { wch: 34 };
        return { wch: String(columnHeader[index]).includes('total') ? 14 : 10 };
      });
      // Money cells carry a format so the workbook totals and reads like the grid.
      Object.keys(sheet).forEach(address => {
        if (address.startsWith('!')) return;
        const cell = sheet[address];
        if (!cell || typeof cell.v !== 'number') return;
        cell.z = '#,##0.00';
      });
      const bold = (row: number) => {
        for (let column = 0; column <= lastColumn; column++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (cell) cell.s = { font: { bold: true } };
        }
      };
      bold(1);
      bold(body.length + 2);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, scheduleBasis === 'cashflow' ? 'Cashflow Schedule' : 'Revenue Schedule');
      XLSX.writeFile(workbook, `orbit-${scheduleBasis === 'cashflow' ? 'cashflow' : 'revenue'}-schedule-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, schedule, scheduleBasis]);

  const columnDefs = useMemo<(ColDef<RevenueScheduleRow> | ColGroupDef<RevenueScheduleRow>)[]>(() => {
    const monthColumn = (key: string): ColDef<RevenueScheduleRow> => ({
      headerName: monthLabel(key),
      colId: `m-${key}`,
      width: MONTH_WIDTH,
      minWidth: 64,
      suppressMovable: true,
      sortable: false,
      filter: false,
      resizable: false,
      type: 'rightAligned',
      headerTooltip: `${monthLabel(key)} ${key.slice(0, 4)}`,
      headerClass: key === currentMonthKey ? 'orbit-schedule-current-header' : undefined,
      cellClass: key === currentMonthKey ? 'orbit-schedule-current-cell font-mono' : 'font-mono',
      cellClassRules: { 'font-black': params => params.node?.rowPinned === 'bottom' },
      getQuickFilterText: () => '',
      aggFunc: 'sum',
      valueGetter: params => (params.data ? Number(params.data.months[key]) || 0 : 0),
      valueFormatter: params => formatAmount(params.value),
      cellStyle: params => {
        const data = params.data;
        if (!data) return MONTH_CELL_PADDING;
        const coverage = data.kind === 'contract'
          ? invoiceCoverageRef.current.get(invoiceCellKey(data.contractId, key))
          : projectCellCoverage(data, key, projectCoverageRef.current);
        if (coverage) return { ...MONTH_CELL_PADDING, ...invoiceCellStyle(coverage, key) };
        if (data.kind !== 'contract') return MONTH_CELL_PADDING;
        const suggestion = suggestionRef.current.get(suggestionCellKey(data.contractId, key));
        return suggestion ? { ...MONTH_CELL_PADDING, ...suggestionCellStyle(suggestion, key) } : MONTH_CELL_PADDING;
      },
      cellRenderer: (params: ICellRendererParams<RevenueScheduleRow>) => {
        const data = params.data;
        const contractRow = data && data.kind === 'contract' ? data : undefined;
        const coverage = data
          ? data.kind === 'contract'
            ? invoiceCoverageRef.current.get(invoiceCellKey(data.contractId, key))
            : projectCellCoverage(data, key, projectCoverageRef.current)
          : undefined;
        const suggestion = contractRow ? suggestionRef.current.get(suggestionCellKey(contractRow.contractId, key)) : undefined;
        const projectShares = data && data.kind === 'project' ? data.projectMonths?.[key] : undefined;
        const text = formatAmount(Number(params.value) || 0);

        const tone = coverage ? invoiceVarianceTone(coverage) : null;
        const showBadge = Boolean(coverage && key === coverage.firstMonth);
        const showMarker = Boolean(coverage && coverage.markerMonth === key);
        const showProjects = Boolean(projectShares && projectShares.length > 0);
        const markerAlign = coverage?.markerPosition === 'start'
          ? 'flex-start'
          : coverage?.markerPosition === 'end'
            ? 'flex-end'
            : 'center';
        const showAction = Boolean(suggestion && suggestion.actionMonth === key);
        const creating = Boolean(suggestion && pendingSuggestionsRef.current[suggestion.id]);

        // Every month cell reserves the same slim top strip, so amounts stay on one baseline whether
        // the cell carries an invoice badge, an issue-date marker, a suggestion action, or nothing.
        return (
          <span
            title={
              coverage
                ? data?.kind === 'project'
                  ? `${coverageTooltip(coverage)} · ${
                      (data.projects ?? [])
                        .filter(project => projectCoverageRef.current.has(projectInvoiceCellKey(project.id, key)))
                        .map(projectBadgeLabel)
                        .join(', ')
                    }`
                  : coverageTooltip(coverage)
                : suggestion
                  ? suggestionTooltip(suggestion)
                  : projectShares && projectShares.length > 0
                    ? projectCellTooltip(key, projectShares)
                    : undefined
            }
            style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1, height: '100%' }}
            // Without a licence there is no grid menu, so a right-click opens the explanation directly.
            onContextMenu={HAS_AG_GRID_LICENSE || !data ? undefined : event => {
              event.preventDefault();
              setExplain({ row: data, month: key });
            }}
          >
            <span
              style={{
                display: 'flex', alignItems: 'center', height: 10, lineHeight: '10px',
                justifyContent: showBadge
                  ? (showMarker ? 'space-between' : 'flex-start')
                  : showAction || showProjects ? 'flex-start' : markerAlign,
              }}
            >
              {showProjects && projectShares && !showBadge && (
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 2, maxWidth: '100%', padding: '0 3px',
                    borderRadius: 3, background: 'color-mix(in srgb, var(--warning) 18%, transparent)', color: 'var(--warning)',
                    fontSize: 8, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{projectBadgeLabel(projectShares[0].project)}</span>
                  {projectShares.length > 1 && <span style={{ flexShrink: 0, opacity: 0.85 }}>+{projectShares.length - 1}</span>}
                </span>
              )}
              {coverage && showBadge && (
                <button
                  type="button"
                  data-invoice-peek
                  title={coverage.invoiceIds.length > 0 ? `${coverageTooltip(coverage)} · click for invoice details` : coverageTooltip(coverage)}
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation();
                    if (data && coverage.invoiceIds.length > 0) openPeekRef.current(data.contract, coverage.invoiceIds);
                  }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: coverage.draft ? 4 : 2, padding: '0 3px', borderRadius: 3,
                    border: 0, fontSize: 8, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                    cursor: coverage.invoiceIds.length > 0 ? 'pointer' : 'default',
                    ...(coverage.draft ? DRAFT_TONE : VARIANCE_TONES[tone as InvoiceVarianceTone]),
                  }}
                >
                  {coverage.draft && <span style={{ letterSpacing: '0.02em', opacity: 0.8 }}>Draft</span>}
                  {coverage.invoices.length === 0 && coverage.receipts.length > 0 && (
                    <span style={{ letterSpacing: '0.02em', opacity: 0.8 }}>Paid</span>
                  )}
                  <span>{formatTotal(coverageTotal(coverage))}</span>
                  {tone !== 'match' && <span>{formatSignedAmount(coverage.variance)}</span>}
                </button>
              )}
              {coverage && showMarker && coverage.invoiceIds.length > 0 && (
                <span
                  aria-hidden
                  style={{
                    fontSize: 10, lineHeight: 1, fontWeight: 900,
                    color: invoiceMarkerColor(coverage),
                  }}
                >
                  *
                </span>
              )}
              {!coverage && showAction && suggestion && (
                <button
                  type="button"
                  data-invoice-action
                  disabled={creating}
                  title={`Create a draft invoice for ${suggestion.period.label} · ${formatTotal(suggestion.amount)}`}
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation();
                    void createDraftRef.current(suggestion);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 2, width: '100%', height: 10, padding: '0 3px',
                    border: 0, borderRadius: 3, background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent-ink)',
                    fontSize: 8, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                    overflow: 'hidden', cursor: creating ? 'wait' : 'pointer',
                  }}
                >
                  <Plus className="w-2 h-2 shrink-0" />
                  <span className="truncate">{creating ? 'Creating…' : formatTotal(suggestion.amount)}</span>
                </button>
              )}
            </span>
            <span style={{ display: 'block', textAlign: 'right', lineHeight: '13px' }}>{text}</span>
          </span>
        );
      },
    });

    return [
      {
        headerName: 'Counterparty',
        colId: 'counterparty',
        field: 'counterparty',
        rowGroup: groupBy === 'counterparty',
        hide: groupBy === 'counterparty',
        pinned: 'left',
        width: 200,
        minWidth: 160,
        suppressMovable: true,
        sortable: false,
        cellClass: 'cursor-pointer',
        getQuickFilterText: params => quickFilterText(params.data),
        cellRenderer: (params: ICellRendererParams<RevenueScheduleRow>) =>
          // Grouped by end customer the group column already carries the portfolio label.
          params.node?.rowPinned && groupBy !== 'flat' ? null : <CounterpartyStreamRenderer {...params} />,
      },
      {
        headerName: 'End customer',
        colId: 'end-customer',
        field: 'endCustomer',
        // Hidden while it *is* the group column (the name would repeat) or when nothing is subcontracted.
        hide: !hasSubcontracts || groupBy === 'endCustomer',
        pinned: 'left',
        width: 170,
        minWidth: 140,
        suppressMovable: true,
        sortable: false,
        getQuickFilterText: params => quickFilterText(params.data),
        cellRenderer: (params: ICellRendererParams<RevenueScheduleRow>) => {
          if (params.node?.rowPinned || !params.data) return null;
          if (params.data.supply === 'prime') return <span className="ui-meta">—</span>;
          return (
            <span className="text-[10px] font-semibold text-amber-700 truncate" title={`End customer: ${params.data.endCustomer}`}>
              for {params.data.endCustomer}
            </span>
          );
        },
      },
      {
        // Grouping needs its own column: the schedule reads the same value, but only one of the two
        // may be visible at a time or the customer name repeats on every row.
        headerName: 'End customer',
        colId: 'end-customer-group',
        field: 'endCustomer',
        rowGroup: groupBy === 'endCustomer',
        hide: true,
        suppressColumnsToolPanel: true,
      },
      {
        headerName: 'Master Agreement',
        colId: 'agreement',
        pinned: 'left',
        width: 220,
        minWidth: 180,
        suppressMovable: true,
        sortable: false,
        cellClass: 'cursor-pointer',
        getQuickFilterText: params => quickFilterText(params.data),
        cellRenderer: (params: ICellRendererParams<RevenueScheduleRow>) => {
          if (params.node?.rowPinned) {
            return <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Monthly totals</span>;
          }
          if (!params.data) return null;
          const isContractRow = params.data.kind === 'contract';
          const rowProjects = params.data.projects ?? [];
          // A single CR keeps its own label; several share the row and are listed on hover.
          const projectLabel = rowProjects.length === 1
            ? `${rowProjects[0].code ? `${rowProjects[0].code} · ` : ''}${rowProjects[0].name}`
            : `${rowProjects.length} change requests`;
          const hasBudget = rowProjects.some(project => (Number(project.budget_value) || 0) > 0);
          return (
            <div className="leading-[1.15]" title="Double-click to open the contract dossier">
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] font-extrabold text-slate-900 font-mono truncate">{params.data.reference}</span>
                {params.data.supply !== 'prime' && (
                  <span
                    className="shrink-0 rounded-[2px] bg-amber-100 px-1 text-[8px] font-black uppercase tracking-[0.04em] text-amber-900"
                    title={`${params.data.supply === 'intercompany' ? 'Intercompany resale' : 'Subcontract'} · billed by ${params.data.counterparty} · for ${params.data.endCustomer}`}
                  >
                    Sub
                  </span>
                )}
              </div>
              <div
                className={`text-[9px] font-semibold ${!isContractRow && !hasBudget ? 'text-amber-600' : 'text-slate-500'}`}
                title={
                  isContractRow
                    ? params.data.product || 'Recurring contract'
                    : `${projectLabel}${hasBudget ? '' : ' · no budget value'}${rowProjects.length > 1 ? `\n${rowProjects.map(project => project.name).join('\n')}` : ''}`
                }
              >
                {isContractRow ? (
                  <span className="block truncate">{params.data.product || 'Recurring contract'}</span>
                ) : (
                  <span className="flex items-center gap-1 min-w-0">
                    {!hasBudget && <AlertTriangle className="w-2.5 h-2.5 shrink-0" />}
                    <span className="truncate">{projectLabel}</span>
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      ...yearGroups.map(group => ({
        headerName: String(group.year),
        colId: `y-${group.year}`,
        marryChildren: true,
        headerStyle: {
          backgroundColor: 'var(--viz-schedule-band)',
          color: 'var(--accent-ink)',
          fontWeight: '800',
          textAlign: 'center' as const,
        },
        children: group.months.map(monthColumn),
      })),
      {
        headerName: 'Year total',
        colId: 'year-total',
        pinned: 'right',
        width: 136,
        minWidth: 120,
        suppressMovable: true,
        sortable: false,
        filter: false,
        resizable: false,
        type: 'rightAligned',
        headerComponent: YearTotalHeader,
        headerComponentParams: { yearStore },
        headerStyle: { backgroundColor: 'var(--viz-schedule-band-strong)', color: 'var(--accent-ink)', fontWeight: '800' },
        cellStyle: { backgroundColor: 'var(--viz-schedule-cell)', fontWeight: 800 },
        cellClassRules: { 'font-black': params => params.node?.rowPinned === 'bottom' },
        getQuickFilterText: () => '',
        aggFunc: 'sum',
        valueGetter: params => (params.data ? yearTotalOf(params.data.months, yearStore.getYear()) : 0),
        valueFormatter: params => formatTotal(params.value),
      },
    ];
  }, [yearGroups, currentMonthKey, yearStore, groupBy, hasSubcontracts]);

  const pinnedBottomRowData = useMemo(
    () => [{ id: '__portfolio-total__', months: schedule.monthTotals }],
    [schedule.monthTotals]
  );

  const changeRequestCount = useMemo(
    () => schedule.rows.reduce((count, row) => count + (row.projects?.length ?? 0), 0),
    [schedule.rows]
  );
  const visibleYearTotal = yearTotalOf(schedule.monthTotals, visibleYear);
  const currentMonthTotal = Number(schedule.monthTotals[currentMonthKey]) || 0;
  const horizonLabel = schedule.months.length > 0
    ? `${monthLabel(schedule.startKey)} ${schedule.startKey.slice(0, 4)} → ${monthLabel(schedule.endKey)} ${schedule.endKey.slice(0, 4)}`
    : '—';

  return (
    <div className={isFullscreen ? 'fixed inset-0 z-40 flex bg-slate-900/60 p-3 sm:p-5' : ''}>
      <div className={`bg-white border border-slate-200 overflow-hidden shadow-xs flex flex-col w-full ${isFullscreen ? 'flex-1 rounded-2xl shadow-2xl' : 'rounded-xl'}`}>
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-sm font-extrabold text-slate-800">{scheduleBasis === 'cashflow' ? 'Cashflow Schedule' : 'Revenue Schedule & MRR'}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {contracts.length} contract{contracts.length === 1 ? '' : 's'} · {changeRequestCount} change request{changeRequestCount === 1 ? '' : 's'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {scheduleBasis === 'cashflow'
              ? 'What actually gets invoiced: each contract’s charges land once per billing cycle (monthly, quarterly or annual, at the period start or end), alongside the invoices issued, paid or suggested.'
              : 'Month-by-month revenue mirroring the budget workbook — contract charges and project-based change requests per master agreement. A quarterly or annual charge billed in arrears sits on the period it closes.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right">
            <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Portfolio MRR</span>
            <span className="text-sm font-mono font-black text-emerald-700">{formatTotal(portfolioMRR)}</span>
            {primeFees > 0 && (
              <span
                className="block text-[9px] font-semibold text-rose-700"
                title="Portfolio MRR minus the share subcontracted work pays the prime contractor"
              >
                {formatTotal(portfolioMRR - primeFees)} net of prime fees
              </span>
            )}
          </div>
          <div className="text-right">
            <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">This month</span>
            <span className="text-sm font-mono font-black text-slate-800">{formatTotal(currentMonthTotal)}</span>
          </div>
          <div className="text-right">
            <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">{visibleYear} total</span>
            <span className="text-sm font-mono font-black text-[var(--accent)]">{formatTotal(visibleYearTotal)}</span>
          </div>
          <button
            type="button"
            onClick={() => setIsFullscreen(value => !value)}
            title={isFullscreen ? 'Exit full screen (Esc)' : 'Open the revenue schedule in full screen'}
            aria-label={isFullscreen ? 'Exit full screen' : 'Open in full screen'}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 cursor-pointer shrink-0"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="px-4 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search counterparty or agreement…"
              value={quickFilter}
              onChange={event => setQuickFilter(event.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] placeholder:text-slate-400"
            />
          </div>
          <button
            type="button"
            onClick={() => { if (gridApiRef.current) scrollToCurrentYear(gridApiRef.current); }}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-white hover:bg-[var(--surface-muted)] text-[12px] font-semibold text-[var(--ink-2)] cursor-pointer"
          >
            <CalendarClock className="w-3.5 h-3.5 text-[var(--accent)]" /> {currentYear}
            <ArrowRight className="w-3 h-3 text-slate-400" />
          </button>
          <div className="ui-segmented shrink-0" role="group" aria-label="Schedule view">
            <button
              type="button"
              onClick={() => setScheduleBasis('recognition')}
              title="Spread each contract over the months the service is delivered — a charge billed in arrears lands on the period it closes"
              aria-pressed={scheduleBasis === 'recognition'}
            >
              <BarChart3 className="w-3 h-3" /> Revenue
            </button>
            <button
              type="button"
              onClick={() => setScheduleBasis('cashflow')}
              title="Show one value per billing cycle — what will be invoiced"
              aria-pressed={scheduleBasis === 'cashflow'}
            >
              <Banknote className="w-3 h-3" /> Cashflow
            </button>
          </div>
          {HAS_AG_GRID_LICENSE && (
            <div className="ui-segmented shrink-0" role="group" aria-label="Schedule grouping">
              <button
                type="button"
                onClick={() => { setGroupBy('counterparty'); setSelectionVersion(version => version + 1); }}
                title="Group the schedule by the counterparty that pays us"
                aria-pressed={groupBy === 'counterparty'}
              >
                <Users className="w-3 h-3" /> Counterparty
              </button>
              <button
                type="button"
                onClick={() => { setGroupBy('endCustomer'); setSelectionVersion(version => version + 1); }}
                title="Group by the client the work really serves — subcontracts sit under the end customer, not the prime"
                aria-pressed={groupBy === 'endCustomer'}
              >
                <Building2 className="w-3 h-3" /> End customer
              </button>
              <button
                type="button"
                onClick={() => { setGroupBy('flat'); setSelectionVersion(version => version + 1); }}
                title="One flat list, no groups"
                aria-pressed={groupBy === 'flat'}
              >
                <Rows3 className="w-3 h-3" /> Flat
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void exportToExcel()}
          disabled={isExporting}
          title="Download this schedule as an Excel workbook"
          className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-white hover:bg-[var(--surface-muted)] text-[12px] font-semibold text-[var(--ink-2)] disabled:opacity-60 disabled:cursor-wait cursor-pointer shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-[var(--ink-3)]" /> {isExporting ? 'Exporting…' : 'Excel'}
        </button>
        {selectionStats ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-2.5 py-1 text-[10px] font-bold text-slate-600">
            <span className="uppercase tracking-wider text-[var(--accent)]">Selection</span>
            <span>Σ <span className="font-mono text-slate-900">{formatTotal(selectionStats.sum)}</span></span>
            <span>Avg <span className="font-mono text-slate-900">{formatTotal(selectionStats.avg)}</span></span>
            <span>Min <span className="font-mono text-slate-900">{formatTotal(selectionStats.min)}</span></span>
            <span>Max <span className="font-mono text-slate-900">{formatTotal(selectionStats.max)}</span></span>
            <span className="text-slate-400">{selectionStats.count} cells</span>
            <button
              type="button"
              onClick={() => { gridApi?.clearCellSelection(); }}
              title="Clear cell selection"
              aria-label="Clear cell selection"
              className="inline-flex items-center justify-center w-4 h-4 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" /> Contract charges</span>
            <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Change requests</span>
            <span className="inline-flex items-center gap-1"><Layers className="w-3 h-3 text-slate-400" /> {horizonLabel}</span>
            {invoiceSuggestions.list.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/40" />
                {invoiceSuggestions.list.length} suggested invoice{invoiceSuggestions.list.length === 1 ? '' : 's'} · click ＋ to draft
              </span>
            )}
            {invoiceCoverage.size > 0 && (
              <>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-fuchsia-500/10 ring-1 ring-fuchsia-700/50" /> Invoiced
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/30 ring-1 ring-emerald-700/60" /> Paid
                </span>
                {draftCoverageCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-slate-500/10 ring-1 ring-slate-500/50" /> Draft
                  </span>
                )}
                <span className="text-slate-400">badge: invoice € vs contract</span>
                {receiptCoverageCount > 0 && (
                  <span className="inline-flex items-center gap-1" title="Money received without a tax invoice — the box is paid, the badge says Paid">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/30 ring-1 ring-dashed ring-emerald-700/60" /> {receiptCoverageCount} receipt{receiptCoverageCount === 1 ? '' : 's'}
                  </span>
                )}
              </>
            )}
            {HAS_AG_GRID_LICENSE && <span className="text-slate-400">Shift+click to sum cells</span>}
            <span className="text-slate-400">Right-click a month to see how it is calculated</span>
          </div>
        )}
      </div>

      <div className={isFullscreen ? 'flex-1 min-h-0' : 'h-[560px]'}>
        <AgGridReact<RevenueScheduleRow>
          theme={gridTheme}
          rowData={schedule.rows}
          columnDefs={columnDefs}
          autoGroupColumnDef={autoGroupColumnDef}
          pinnedBottomRowData={pinnedBottomRowData}
          getRowId={params => params.data.id}
          getContextMenuItems={getContextMenuItems}
          defaultColDef={{ sortable: false, filter: false, resizable: true, suppressMovable: true, minWidth: 60 }}
          quickFilterText={quickFilter}
          cellSelection={HAS_AG_GRID_LICENSE}
          onCellSelectionChanged={() => setSelectionVersion(version => version + 1)}
          getRowHeight={params => (params.node?.group ? 30 : 32)}
          headerHeight={32}
          groupDisplayType="singleColumn"
          groupDefaultExpanded={-1}
          suppressAggFuncInHeader={true}
          onGridReady={handleGridReady}
          onBodyScroll={handleBodyScroll}
          onGridSizeChanged={event => syncVisibleYear(event.api)}
          onRowDoubleClicked={event => {
            if ((event.event?.target as HTMLElement | null)?.closest('[data-invoice-action], [data-invoice-peek]')) return;
            if (event.node.rowPinned) return;
            if (event.node.group) { event.node.setExpanded(!event.node.expanded); return; }
            if (!event.data || !onOpenContract) return;
            onOpenContract(event.data.contract);
          }}
          suppressCellFocus={true}
          animateRows={false}
        />
      </div>
      </div>

      {explain && explanation && (
        <CellExplanationModal
          row={explain.row}
          month={explain.month}
          basis={scheduleBasis}
          explanation={explanation}
          onClose={() => setExplain(null)}
        />
      )}

      {peek && (
        <InvoicePeekModal
          invoices={peekInvoices}
          contract={peek.contract}
          onClose={() => setPeek(null)}
        />
      )}
    </div>
  );
};
