"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  type BodyScrollEvent,
  type ColDef,
  type ColGroupDef,
  type GridApi,
  type GridReadyEvent,
  type IHeaderParams,
  type ICellRendererParams,
} from 'ag-grid-community';
import { orbitGridTheme, HAS_AG_GRID_LICENSE } from '@/lib/ag-grid-setup';
import type { CatalogItem, CatalogModule, Contract, Invoice, Project } from '@/lib/types';
import { calculateContractValuation } from '@/lib/pricing-engine';
import { buildRevenueSchedule, groupMonthsByYear, yearTotalOf, type RevenueScheduleRow } from '@/lib/revenue-schedule';
import {
  buildInvoiceCoverage,
  invoiceCellKey,
  invoiceCellStyle,
  invoiceVarianceTone,
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
import { Modal, Badge } from '@/components/ui/primitives';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { Search, CalendarClock, TrendingUp, Layers, ArrowRight, Maximize2, Minimize2, Users, AlertTriangle, X, Plus } from 'lucide-react';

interface RevenueScheduleGridProps {
  contracts: Contract[];
  projects: Project[];
  catalogModules: CatalogModule[];
  catalogItems: CatalogItem[];
  invoices?: Invoice[];
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
  match: { background: 'rgba(21, 128, 61, 0.16)', color: '#14532d' },
  under: { background: 'rgba(244, 63, 94, 0.16)', color: '#9f1239' },
  over: { background: 'rgba(245, 158, 11, 0.22)', color: '#92400e' },
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
    `Invoiced ${formatTotal(coverage.invoiceTotal)}`,
    `contract ${formatTotal(coverage.contractTotal)}`,
    comparison,
    coverage.invoices.join(', '),
    `issued ${coverage.issueDate || '—'}`,
    coverage.paid ? 'paid' : 'not paid yet',
  ].join(' · ');
}

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
      <div className={`text-[9px] font-semibold flex items-center gap-1 ${isContractRow ? 'text-[#3D87D3]' : 'text-amber-600'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isContractRow ? 'bg-[#3D87D3]' : 'bg-amber-500'}`} />
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
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">VAT {invoice.vat_rate}%</div>
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
            </div>
          );
        })}
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
  draftInvoiceIds,
  onCreateInvoice,
  onOpenContract,
}) => {
  const gridApiRef = useRef<GridApi<RevenueScheduleRow> | null>(null);
  const [gridApi, setGridApi] = useState<GridApi<RevenueScheduleRow> | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [quickFilter, setQuickFilter] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [groupByCounterparty, setGroupByCounterparty] = useState(HAS_AG_GRID_LICENSE);
  const [pendingSuggestions, setPendingSuggestions] = useState<Record<string, true>>({});
  const [peek, setPeek] = useState<{ contract: Contract; invoiceIds: string[] } | null>(null);
  const currentYear = new Date().getFullYear();
  const yearStore = useMemo(() => createYearStore(currentYear), [currentYear]);
  const visibleYear = useSyncExternalStore(yearStore.subscribe, yearStore.getYear, yearStore.getYear);
  const autoScrolledRef = useRef(false);

  const schedule = useMemo(
    () => buildRevenueSchedule(contracts, projects, catalogModules, catalogItems),
    [contracts, projects, catalogModules, catalogItems]
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
  const invoiceCoverage = useMemo(
    () => buildInvoiceCoverage(invoices, contracts, catalogModules, catalogItems),
    [invoices, contracts, catalogModules, catalogItems]
  );
  const invoiceCoverageRef = useRef<InvoiceCoverageMap>(new Map());
  useEffect(() => {
    invoiceCoverageRef.current = invoiceCoverage;
    gridApiRef.current?.redrawRows();
  }, [invoiceCoverage]);

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
    headerName: 'Counterparty',
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
  }), []);

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

  const reflectYear = useCallback((year: number) => {
    if (year === yearStore.getYear()) return;
    yearStore.setYear(year);
    gridApiRef.current?.refreshCells({ columns: ['year-total'], force: true });
    // Group rows hold the year total in their aggregated data, so it must be recomputed too.
    if (groupByCounterparty) {
      gridApiRef.current?.refreshClientSideRowModel('aggregate');
      setSelectionVersion(version => version + 1);
    }
  }, [yearStore, groupByCounterparty]);

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
    if (groupByCounterparty) gridApiRef.current?.refreshClientSideRowModel('aggregate');
  }, [years, yearStore, groupByCounterparty]);

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
        if (!data || data.kind !== 'contract') return MONTH_CELL_PADDING;
        const coverage = invoiceCoverageRef.current.get(invoiceCellKey(data.contractId, key));
        if (coverage) return { ...MONTH_CELL_PADDING, ...invoiceCellStyle(coverage, key) };
        const suggestion = suggestionRef.current.get(suggestionCellKey(data.contractId, key));
        return suggestion ? { ...MONTH_CELL_PADDING, ...suggestionCellStyle(suggestion, key) } : MONTH_CELL_PADDING;
      },
      cellRenderer: (params: ICellRendererParams<RevenueScheduleRow>) => {
        const data = params.data;
        const contractRow = data && data.kind === 'contract' ? data : undefined;
        const coverage = contractRow ? invoiceCoverageRef.current.get(invoiceCellKey(contractRow.contractId, key)) : undefined;
        const suggestion = contractRow ? suggestionRef.current.get(suggestionCellKey(contractRow.contractId, key)) : undefined;
        const text = formatAmount(Number(params.value) || 0);

        const tone = coverage ? invoiceVarianceTone(coverage) : null;
        const showBadge = Boolean(coverage && key === coverage.firstMonth);
        const showMarker = Boolean(coverage && coverage.markerMonth === key);
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
            title={coverage ? coverageTooltip(coverage) : suggestion ? suggestionTooltip(suggestion) : undefined}
            style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1, height: '100%' }}
          >
            <span
              style={{
                display: 'flex', alignItems: 'center', height: 10, lineHeight: '10px',
                justifyContent: showBadge ? (showMarker ? 'space-between' : 'flex-start') : showAction ? 'flex-start' : markerAlign,
              }}
            >
              {coverage && showBadge && (
                <button
                  type="button"
                  data-invoice-peek
                  title={`${coverageTooltip(coverage)} · click for invoice details`}
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation();
                    if (contractRow) openPeekRef.current(contractRow.contract, coverage.invoiceIds);
                  }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 2, padding: '0 3px', borderRadius: 3,
                    border: 0, fontSize: 8, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                    cursor: 'pointer', ...VARIANCE_TONES[tone as InvoiceVarianceTone],
                  }}
                >
                  <span>{formatTotal(coverage.invoiceTotal)}</span>
                  {tone !== 'match' && <span>{formatSignedAmount(coverage.variance)}</span>}
                </button>
              )}
              {coverage && showMarker && (
                <span
                  aria-hidden
                  style={{
                    fontSize: 10, lineHeight: 1, fontWeight: 900,
                    color: coverage.paid ? '#14532d' : '#15803d',
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
                    border: 0, borderRadius: 3, background: 'rgba(61, 135, 211, 0.18)', color: '#1d4e79',
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
        rowGroup: groupByCounterparty,
        hide: groupByCounterparty,
        pinned: 'left',
        width: 200,
        minWidth: 160,
        suppressMovable: true,
        sortable: false,
        cellClass: 'cursor-pointer',
        getQuickFilterText: params => (
          params.data
            ? `${params.data.counterparty} ${params.data.reference} ${params.data.product} ${params.data.project?.name ?? ''} ${params.data.project?.code ?? ''}`
            : ''
        ),
        cellRenderer: CounterpartyStreamRenderer,
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
        getQuickFilterText: params => (
          params.data
            ? `${params.data.counterparty} ${params.data.reference} ${params.data.product} ${params.data.project?.name ?? ''} ${params.data.project?.code ?? ''}`
            : ''
        ),
        cellRenderer: (params: ICellRendererParams<RevenueScheduleRow>) => {
          if (params.node?.rowPinned) {
            return <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Monthly totals</span>;
          }
          if (!params.data) return null;
          const isContractRow = params.data.kind === 'contract';
          const project = params.data.project;
          const projectLabel = project ? `${project.code ? `${project.code} · ` : ''}${project.name}` : '';
          const hasBudget = (Number(project?.budget_value) || 0) > 0;
          return (
            <div className="leading-[1.15]" title="Double-click to open the contract dossier">
              <div className="text-[11px] font-extrabold text-slate-900 font-mono truncate">{params.data.reference}</div>
              <div
                className={`text-[9px] font-semibold ${!isContractRow && !hasBudget ? 'text-amber-600' : 'text-slate-500'}`}
                title={isContractRow ? params.data.product || 'Recurring contract' : `${projectLabel}${hasBudget ? '' : ' · no budget value'}`}
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
          backgroundColor: '#e8f1fb',
          color: '#1d4e79',
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
        headerStyle: { backgroundColor: '#dbeafe', color: '#1d4e79', fontWeight: '800' },
        cellStyle: { backgroundColor: '#eef6ff', fontWeight: 800 },
        cellClassRules: { 'font-black': params => params.node?.rowPinned === 'bottom' },
        getQuickFilterText: () => '',
        aggFunc: 'sum',
        valueGetter: params => (params.data ? yearTotalOf(params.data.months, yearStore.getYear()) : 0),
        valueFormatter: params => formatTotal(params.value),
      },
    ];
  }, [yearGroups, currentMonthKey, yearStore, groupByCounterparty]);

  const pinnedBottomRowData = useMemo(
    () => [{ id: '__portfolio-total__', months: schedule.monthTotals }],
    [schedule.monthTotals]
  );

  const changeRequestCount = useMemo(
    () => schedule.rows.filter(row => row.kind === 'project').length,
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
            <TrendingUp className="w-4 h-4 text-[#3D87D3]" />
            <span className="text-sm font-extrabold text-slate-800">Revenue Schedule & MRR</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {contracts.length} contract{contracts.length === 1 ? '' : 's'} · {changeRequestCount} change request{changeRequestCount === 1 ? '' : 's'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Month-by-month revenue mirroring the budget workbook — contract charges and project-based change requests per master agreement.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right">
            <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">Portfolio MRR</span>
            <span className="text-sm font-mono font-black text-emerald-700">{formatTotal(portfolioMRR)}</span>
          </div>
          <div className="text-right">
            <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">This month</span>
            <span className="text-sm font-mono font-black text-slate-800">{formatTotal(currentMonthTotal)}</span>
          </div>
          <div className="text-right">
            <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">{visibleYear} total</span>
            <span className="text-sm font-mono font-black text-[#3D87D3]">{formatTotal(visibleYearTotal)}</span>
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
              className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
            />
          </div>
          <button
            type="button"
            onClick={() => { if (gridApiRef.current) scrollToCurrentYear(gridApiRef.current); }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-600 cursor-pointer"
          >
            <CalendarClock className="w-3.5 h-3.5 text-[#3D87D3]" /> {currentYear}
            <ArrowRight className="w-3 h-3 text-slate-400" />
          </button>
          {HAS_AG_GRID_LICENSE && (
            <button
              type="button"
              onClick={() => {
                setGroupByCounterparty(value => !value);
                setSelectionVersion(version => version + 1);
              }}
              title={groupByCounterparty ? 'Show a flat list instead of counterparty groups' : 'Group the schedule by counterparty'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                groupByCounterparty
                  ? 'border-[#3D87D3]/40 bg-[#3D87D3]/10 text-[#3D87D3]'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              {groupByCounterparty ? 'Grouped by counterparty' : 'Group by counterparty'}
            </button>
          )}
        </div>
        {selectionStats ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#3D87D3]/30 bg-[#3D87D3]/5 px-2.5 py-1 text-[10px] font-bold text-slate-600">
            <span className="uppercase tracking-wider text-[#3D87D3]">Selection</span>
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
            <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#3D87D3]" /> Contract charges</span>
            <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Change requests</span>
            <span className="inline-flex items-center gap-1"><Layers className="w-3 h-3 text-slate-400" /> {horizonLabel}</span>
            {invoiceSuggestions.list.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#3D87D3]/10 ring-1 ring-[#3D87D3]/40" />
                {invoiceSuggestions.list.length} suggested invoice{invoiceSuggestions.list.length === 1 ? '' : 's'} · click ＋ to draft
              </span>
            )}
            {invoiceCoverage.size > 0 && (
              <>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/15 ring-1 ring-emerald-500/40" /> Invoiced
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/30 ring-1 ring-emerald-700/60" /> Paid
                </span>
                <span className="text-slate-400">badge: invoiced € vs contract</span>
              </>
            )}
            {HAS_AG_GRID_LICENSE && <span className="text-slate-400">Shift+click to sum cells</span>}
          </div>
        )}
      </div>

      <div className={isFullscreen ? 'flex-1 min-h-0' : 'h-[560px]'}>
        <AgGridReact<RevenueScheduleRow>
          theme={orbitGridTheme}
          rowData={schedule.rows}
          columnDefs={columnDefs}
          autoGroupColumnDef={autoGroupColumnDef}
          pinnedBottomRowData={pinnedBottomRowData}
          getRowId={params => params.data.id}
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
