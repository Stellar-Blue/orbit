"use client";

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { Badge } from '@/components/ui/primitives';
import { AlertCircle, Clock, CheckCircle, Zap, FileCheck, Search } from 'lucide-react';

export interface BillingActionItem {
  contractId: string;
  periodKey: string;
  counterpartyName: string;
  reference: string;
  direction: 'revenue' | 'cost';
  cadence: string;
  timing: string;
  periodLabel: string;
  expectedAmount: number;
  status: 'unbilled' | 'draft_created' | 'invoiced' | 'billed';
  [key: string]: unknown;
}

interface BillingActionRow {
  item: BillingActionItem;
  counterparty: string;
  reference: string;
  direction: string;
  cadence: string;
  timingLabel: string;
  periodLabel: string;
  expectedAmount: number;
  status: string;
}

interface BillingActionGridProps {
  items: BillingActionItem[];
  onQuickCreate: (item: BillingActionItem) => void;
}

const timingLabel = (timing: string) => {
  if (timing === 'end_of_period') return '⏳ Arrears (End of period)';
  if (timing === 'upon_milestone') return '🎯 Upon Milestone';
  return '🚀 In Advance (Start of period)';
};

export const BillingActionGrid: React.FC<BillingActionGridProps> = ({ items, onQuickCreate }) => {
  const [quickFilter, setQuickFilter] = useState('');

  const rowData = useMemo<BillingActionRow[]>(() => {
    return items.map(item => ({
      item,
      counterparty: item.counterpartyName,
      reference: item.reference,
      direction: item.direction,
      cadence: item.cadence,
      timingLabel: timingLabel(item.timing),
      periodLabel: item.periodLabel,
      expectedAmount: item.expectedAmount,
      status: item.status
    }));
  }, [items]);

  const columnDefs = useMemo<ColDef<BillingActionRow>[]>(() => [
    {
      headerName: 'Contract / Counterparty', field: 'counterparty', minWidth: 220, sortable: true, ...excelSetFilter(), pinned: 'left',
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => (
        <div>
          <Link href={`/contracts/${p.data?.item.contractId}`} onClick={(e) => e.stopPropagation()} className="font-bold text-slate-900 hover:text-blue-600 transition-colors block">
            {p.value}
          </Link>
          <span className="text-xs text-slate-500 font-mono">Ref: {p.data?.reference}</span>
        </div>
      )
    },
    {
      headerName: 'Direction', field: 'direction', width: 110, sortable: true, ...excelSetFilter(['revenue', 'cost']),
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => (
        <Badge variant={p.value === 'revenue' ? 'success' : 'warning'}>
          {p.value === 'revenue' ? 'Revenue' : 'Spend'}
        </Badge>
      )
    },
    {
      headerName: 'Cadence', field: 'cadence', width: 110, sortable: true, ...excelSetFilter(),
      cellClass: 'font-bold text-slate-800 capitalize'
    },
    {
      headerName: 'Invoicing Timing', field: 'timingLabel', width: 190, sortable: true, ...excelSetFilter(),
      cellClass: 'text-xs text-slate-500'
    },
    {
      headerName: 'Billing Horizon', field: 'periodLabel', width: 150, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => (
        <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold">{p.value}</span>
      )
    },
    {
      headerName: 'Expected Rate (€)', field: 'expectedAmount', width: 140, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono font-black text-slate-900',
      valueFormatter: (p) => `€${Number(p.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    },
    {
      headerName: 'Billing Status', field: 'status', width: 140, sortable: true, ...excelSetFilter(['unbilled', 'draft_created', 'invoiced', 'billed']),
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => {
        if (p.value === 'unbilled') {
          return (
            <span className="inline-flex items-center text-xs font-extrabold text-rose-700 bg-rose-100 px-2.5 py-1 rounded-full border border-rose-300">
              <AlertCircle className="w-3.5 h-3.5 mr-1 text-rose-600" /> Unbilled
            </span>
          );
        }
        if (p.value === 'draft_created') {
          return (
            <span className="inline-flex items-center text-xs font-extrabold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-full border border-amber-300">
              <Clock className="w-3.5 h-3.5 mr-1 text-amber-600" /> Draft Created
            </span>
          );
        }
        return (
          <span className="inline-flex items-center text-xs font-extrabold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-full border border-emerald-300">
            <CheckCircle className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Invoiced
          </span>
        );
      }
    },
    {
      headerName: 'Action', field: 'status', width: 160, sortable: false, filter: false, pinned: 'right',
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => (
        p.value === 'unbilled' ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (p.data) onQuickCreate(p.data.item); }}
            className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-extrabold shadow-sm hover:shadow transition-all cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span>Create Draft</span>
          </button>
        ) : (
          <Link
            href="/invoices"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all"
          >
            <FileCheck className="w-3.5 h-3.5 text-blue-600" />
            <span>View in Ledger →</span>
          </Link>
        )
      )
    }
  ], [onQuickCreate]);

  return (
    <div className="overflow-x-auto max-h-[480px] overflow-y-auto border border-slate-200/80 rounded-xl shadow-inner">
      <div className="sticky top-0 z-10 px-4 py-2.5 border-b border-slate-200 bg-slate-50/95 backdrop-blur flex items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search billing queue across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {items.length} billing actions · use column filters for Excel-style options
        </span>
      </div>
      <div className="h-[420px]">
        <AgGridReact<BillingActionRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
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
