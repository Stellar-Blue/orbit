"use client";

import React, { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { useOrbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { useGridFilterControls, ClearFiltersButton } from '@/components/ui/grid-filter-controls';
import { formatDate } from '@/lib/date';
import { Contract, CatalogModule, CatalogItem } from '@/lib/types';
import { calculateContractValuation } from '@/lib/pricing-engine';
import { contractEndCustomerName, isSubcontract } from '@/lib/subcontracts';
import { Badge } from '@/components/ui/primitives';
import { Layers, Trash2, Search } from 'lucide-react';

interface RevenueRow {
  contract: Contract;
  reference: string;
  entity: string;
  /** Set for subcontracts: the client the work really serves. */
  endCustomer: string;
  tier: string;
  tierClass: string;
  type: string;
  term: string;
  start: string;
  discount: string;
  arr: number;
  oneOff: number;
  tcv: number;
  lineCount: number;
}

interface RevenueGridProps {
  contracts: Contract[];
  catalogModules: CatalogModule[];
  catalogItems: CatalogItem[];
  isAdmin: boolean;
  onEditPricing: (c: Contract) => void;
  onDelete: (c: Contract) => void;
}

const eur2 = (value: number) => `€${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const RevenueGrid: React.FC<RevenueGridProps> = ({
  contracts,
  catalogModules,
  catalogItems,
  isAdmin,
  onEditPricing,
  onDelete
}) => {
  const gridTheme = useOrbitGridTheme();
  const gridFilters = useGridFilterControls();
  const { quickFilter, setQuickFilter } = gridFilters;

  const rowData = useMemo<RevenueRow[]>(() => {
    return contracts.map(c => {
      const val = calculateContractValuation(
        c.lines || [], c.discount_pct || 0, c.term_years || 1,
        c.service_start_date || c.starts_on, catalogModules, catalogItems,
        c.value || 0, c.billing_cadence
      );
      return {
        contract: c,
        reference: c.reference,
        entity: c.counterparty?.legal_name || 'Client Entity',
        endCustomer: isSubcontract(c) ? contractEndCustomerName(c) : '',
        tier: val.tierInfo.label,
        tierClass: val.tierInfo.badgeClass,
        type: c.direction === 'revenue' ? 'Revenue' : 'Spend',
        term: c.term_years ? `${c.term_years} Year(s)` : 'Standard Term',
        start: c.service_start_date || c.starts_on,
        discount: c.discount_pct ? `${c.discount_pct}% Off` : 'None (0%)',
        arr: val.netARR,
        oneOff: val.oneTimeValue,
        tcv: val.totalContractValue,
        lineCount: (c.lines || []).length
      };
    });
  }, [contracts, catalogModules, catalogItems]);

  const columnDefs = useMemo<ColDef<RevenueRow>[]>(() => [
    {
      headerName: 'Ref / Entity', field: 'reference', minWidth: 210, sortable: true, ...excelSetFilter(), pinned: 'left',
      cellRenderer: (p: ICellRendererParams<RevenueRow, string>) => (
        <div>
          <div className="font-extrabold text-slate-900">{p.value}</div>
          <div className="text-xs text-slate-500 font-normal">{p.data?.entity}</div>
          {p.data?.endCustomer && (
            <div className="text-[10px] font-semibold text-amber-700">for {p.data.endCustomer}</div>
          )}
        </div>
      )
    },
    {
      headerName: 'Tier Rating', field: 'tier', width: 220, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<RevenueRow, string>) => (
        <span className={`px-2 py-0.5 rounded text-[10px] font-black border inline-block ${p.data?.tierClass || ''}`}>{p.value}</span>
      )
    },
    {
      headerName: 'Type', field: 'type', width: 105, sortable: true, ...excelSetFilter(['Revenue', 'Spend']),
      cellRenderer: (p: ICellRendererParams<RevenueRow, string>) => (
        <Badge variant={p.value === 'Revenue' ? 'success' : 'warning'}>{p.value}</Badge>
      )
    },
    {
      headerName: 'Term', field: 'term', width: 120, sortable: true, ...excelSetFilter(),
      cellClass: 'text-xs font-semibold text-slate-700'
    },
    {
      headerName: 'Start', field: 'start', width: 105, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      valueFormatter: (p) => formatDate(p.value),
      cellClass: 'text-[11px] font-mono text-slate-400'
    },
    {
      headerName: 'Discount', field: 'discount', width: 105, sortable: true, ...excelSetFilter(),
      cellClass: 'text-xs font-bold text-amber-600'
    },
    {
      headerName: 'Net ARR (Recurring)', field: 'arr', width: 150, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono font-black text-emerald-700',
      valueFormatter: (p) => `${eur2(p.value)}/yr`
    },
    {
      headerName: 'One-Off Additions', field: 'oneOff', width: 135, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono font-bold text-amber-600',
      valueFormatter: (p) => (p.value > 0 ? `+${eur2(p.value)}` : '€0.00')
    },
    {
      headerName: 'Real Deal TCV', field: 'tcv', width: 140, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono font-black text-slate-900',
      valueFormatter: (p) => eur2(p.value)
    },
    {
      headerName: '', field: 'contract.id', width: 200, sortable: false, filter: false, pinned: 'right',
      valueGetter: (p) => p.data?.contract.id,
      cellRenderer: (p: ICellRendererParams<RevenueRow, string>) => (
        <div className="flex items-center justify-center space-x-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (p.data) onEditPricing(p.data.contract); }}
            className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs inline-flex items-center transition-colors cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 mr-1 text-indigo-600" />
            {p.data && p.data.lineCount > 0 ? `Edit Rate Sheet (${p.data.lineCount})` : 'Build Rate Sheet'}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (p.data) onDelete(p.data.contract); }}
              className="text-slate-400 hover:text-rose-600 transition-colors p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer"
              title="Delete Contract"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )
    }
  ], [isAdmin, onEditPricing, onDelete]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search revenue schedule across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] placeholder:text-slate-400"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ClearFiltersButton controls={gridFilters} />
          <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
            {contracts.length} contracts · use column filters for Excel-style options
          </span>
        </div>
      </div>
      <div className="h-[480px]">
        <AgGridReact<RevenueRow>
          theme={gridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
          {...gridFilters.gridProps}
          quickFilterText={quickFilter}
          rowHeight={54}
          headerHeight={36}
          {...GROUPING_OPTIONS}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
        />
      </div>
    </div>
  );
};
