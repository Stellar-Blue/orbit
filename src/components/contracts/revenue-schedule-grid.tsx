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
import { orbitGridTheme } from '@/lib/ag-grid-setup';
import type { CatalogItem, CatalogModule, Contract, Project } from '@/lib/types';
import { calculateContractValuation } from '@/lib/pricing-engine';
import { buildRevenueSchedule, groupMonthsByYear, yearTotalOf, type RevenueScheduleRow } from '@/lib/revenue-schedule';
import { Search, CalendarClock, TrendingUp, Layers, ArrowRight } from 'lucide-react';

interface RevenueScheduleGridProps {
  contracts: Contract[];
  projects: Project[];
  catalogModules: CatalogModule[];
  catalogItems: CatalogItem[];
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
 * The frozen right-hand total follows the calendar year occupying the left edge of the month
 * area, so scrolling past December switches it to the next year's totals. Keeping the year in a
 * store (rather than in the column definitions) means crossing a year boundary never recreates
 * the columns or resets the horizontal scroll.
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

export const RevenueScheduleGrid: React.FC<RevenueScheduleGridProps> = ({
  contracts,
  projects,
  catalogModules,
  catalogItems,
  onOpenContract,
}) => {
  const gridApiRef = useRef<GridApi<RevenueScheduleRow> | null>(null);
  const [quickFilter, setQuickFilter] = useState('');
  const currentYear = new Date().getFullYear();
  const yearStore = useMemo(() => createYearStore(currentYear), [currentYear]);
  const visibleYear = useSyncExternalStore(yearStore.subscribe, yearStore.getYear, yearStore.getYear);
  const autoScrolledRef = useRef(false);

  const schedule = useMemo(
    () => buildRevenueSchedule(contracts, projects, catalogModules, catalogItems),
    [contracts, projects, catalogModules, catalogItems]
  );
  const yearGroups = useMemo(() => groupMonthsByYear(schedule.months), [schedule.months]);
  const years = useMemo(() => yearGroups.map(group => group.year), [yearGroups]);
  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

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
  }, [yearStore]);

  // Keep the frozen total inside the rendered range even when the data (or the clock) moves on.
  useEffect(() => {
    if (years.length === 0) return;
    const current = yearStore.getYear();
    if (years.includes(current)) return;
    yearStore.setYear(Math.min(Math.max(current, years[0]), years[years.length - 1]));
    gridApiRef.current?.refreshCells({ columns: ['year-total'], force: true });
  }, [years, yearStore]);

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
    if (!autoScrolledRef.current && schedule.months.length > 0) {
      autoScrolledRef.current = true;
      scrollToCurrentYear(event.api);
    }
  }, [scrollToCurrentYear, schedule.months.length]);

  const handleBodyScroll = useCallback((event: BodyScrollEvent<RevenueScheduleRow>) => {
    const centerColumns = event.api.getDisplayedCenterColumns();
    const left = Math.max(0, event.left);
    let year: number | null = null;

    for (const column of centerColumns) {
      const columnLeft = column.getLeft() ?? 0;
      if (columnLeft + column.getActualWidth() > left + 1) {
        const columnId = column.getColId();
        if (columnId.startsWith('m-')) year = Number(columnId.slice(2, 6));
        break;
      }
    }

    if (year != null && Number.isFinite(year)) reflectYear(year);
  }, [reflectYear]);

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
      valueGetter: params => (params.data ? Number(params.data.months[key]) || 0 : 0),
      valueFormatter: params => formatAmount(params.value),
    });

    return [
      {
        headerName: 'Counterparty',
        colId: 'counterparty',
        pinned: 'left',
        width: 200,
        minWidth: 160,
        suppressMovable: true,
        sortable: false,
        cellClass: 'cursor-pointer',
        getQuickFilterText: params => (
          params.data ? `${params.data.counterparty} ${params.data.reference} ${params.data.product}` : ''
        ),
        cellRenderer: (params: ICellRendererParams<RevenueScheduleRow>) => {
          if (params.node?.rowPinned) {
            return <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">Portfolio total</span>;
          }
          if (!params.data) return null;
          const isContractRow = params.data.kind === 'contract';
          return (
            <div className="leading-tight">
              <div className="text-[12px] font-bold text-slate-800 truncate">{params.data.counterparty}</div>
              <div className={`text-[10px] font-semibold flex items-center gap-1 ${isContractRow ? 'text-[#3D87D3]' : 'text-amber-600'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isContractRow ? 'bg-[#3D87D3]' : 'bg-amber-500'}`} />
                {isContractRow ? 'Contract charges' : 'Change requests'}
              </div>
            </div>
          );
        },
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
          params.data ? `${params.data.counterparty} ${params.data.reference} ${params.data.product}` : ''
        ),
        cellRenderer: (params: ICellRendererParams<RevenueScheduleRow>) => {
          if (params.node?.rowPinned) {
            return <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Monthly totals</span>;
          }
          if (!params.data) return null;
          const isContractRow = params.data.kind === 'contract';
          return (
            <div className="leading-tight">
              <div className="text-[12px] font-extrabold text-slate-900 font-mono">{params.data.reference}</div>
              <div className="text-[10px] text-slate-500 font-semibold truncate">
                {isContractRow
                  ? params.data.product || 'Recurring contract'
                  : params.data.projectCount === 0
                    ? 'No change requests'
                    : params.data.budgetedProjectCount === 0
                      ? `${params.data.projectCount} project${params.data.projectCount === 1 ? '' : 's'} · add a budget value`
                      : `${params.data.projectCount} project${params.data.projectCount === 1 ? '' : 's'} · change requests`}
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
        valueGetter: params => (params.data ? yearTotalOf(params.data.months, yearStore.getYear()) : 0),
        valueFormatter: params => formatTotal(params.value),
      },
    ];
  }, [yearGroups, currentMonthKey, yearStore]);

  const pinnedBottomRowData = useMemo(
    () => [{ id: '__portfolio-total__', months: schedule.monthTotals }],
    [schedule.monthTotals]
  );

  const visibleYearTotal = yearTotalOf(schedule.monthTotals, visibleYear);
  const currentMonthTotal = Number(schedule.monthTotals[currentMonthKey]) || 0;
  const horizonLabel = schedule.months.length > 0
    ? `${monthLabel(schedule.startKey)} ${schedule.startKey.slice(0, 4)} → ${monthLabel(schedule.endKey)} ${schedule.endKey.slice(0, 4)}`
    : '—';

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#3D87D3]" />
            <span className="text-sm font-extrabold text-slate-800">Revenue Schedule & MRR</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {contracts.length} contract{contracts.length === 1 ? '' : 's'} · {schedule.rows.length} rows
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
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#3D87D3]" /> Contract charges</span>
          <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Change requests</span>
          <span className="inline-flex items-center gap-1"><Layers className="w-3 h-3 text-slate-400" /> {horizonLabel}</span>
        </div>
      </div>

      <div className="h-[560px]">
        <AgGridReact<RevenueScheduleRow>
          theme={orbitGridTheme}
          rowData={schedule.rows}
          columnDefs={columnDefs}
          pinnedBottomRowData={pinnedBottomRowData}
          getRowId={params => params.data.id}
          defaultColDef={{ sortable: false, filter: false, resizable: true, suppressMovable: true, minWidth: 60 }}
          quickFilterText={quickFilter}
          rowHeight={44}
          headerHeight={34}
          onGridReady={handleGridReady}
          onBodyScroll={handleBodyScroll}
          onRowClicked={event => {
            if (event.node.rowPinned || !event.data || !onOpenContract) return;
            onOpenContract(event.data.contract);
          }}
          suppressCellFocus={true}
          animateRows={false}
        />
      </div>
    </div>
  );
};
