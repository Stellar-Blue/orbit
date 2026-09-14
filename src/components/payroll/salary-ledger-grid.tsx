"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS, HAS_AG_GRID_LICENSE } from '@/lib/ag-grid-setup';
import { formatDate } from '@/lib/date';
import { SalaryRecord, Profile } from '@/lib/types';
import { loadedMonthlyCost } from '@/lib/compensation';
import { Badge, Button } from '@/components/ui/primitives';
import { Search, Edit, Zap } from 'lucide-react';

interface SalaryRow {
  sal: SalaryRecord;
  employee: string;
  from: string;
  to: string;
  basis: string;
  gross: number;
  loaded: number;
  active: boolean;
  note: string;
}

interface SalaryLedgerGridProps {
  salaries: SalaryRecord[];
  profiles: Profile[];
  /** Salary record currently generating its past payment rows (disables the button). */
  backfillingId: string | null;
  onEdit: (sal: SalaryRecord) => void;
  onBackfill: (sal: SalaryRecord) => void;
}

const BASIS_LABELS: Record<string, string> = {
  monthly_gross: 'Monthly Gross',
  daily_rate: 'Daily Rate',
  fixed_fee: 'Fixed Fee',
  fee: 'Fee'
};

/**
 * Effective-dated salary ledger. Rows are grouped per employee (row grouping — requires the
 * AG Grid Enterprise key; without it the grid simply renders flat), so every raise / rate
 * change stays together with its person, newest rate first.
 */
export const SalaryLedgerGrid: React.FC<SalaryLedgerGridProps> = ({ salaries, profiles, backfillingId, onEdit, onBackfill }) => {
  const [quickFilter, setQuickFilter] = useState('');

  const rowData = useMemo<SalaryRow[]>(() => {
    return salaries
      .map(sal => {
        const prof = profiles.find(p => p.id === sal.profile_id);
        return {
          sal,
          employee: prof ? `${prof.first_name} ${prof.last_name}` : 'Unknown Team Member',
          from: sal.valid_from || '',
          to: sal.valid_to || '',
          basis: BASIS_LABELS[sal.basis] || sal.basis,
          gross: Number(sal.gross_amount) || 0,
          loaded: loadedMonthlyCost(sal),
          active: !sal.valid_to,
          note: sal.note || ''
        };
      })
      // Data order drives group order: alphabetical per employee, newest rate change first.
      .sort((a, b) => a.employee.localeCompare(b.employee) || b.from.localeCompare(a.from));
  }, [salaries, profiles]);

  const columnDefs = useMemo<ColDef<SalaryRow>[]>(() => [
    {
      // Used as the row-group key. With the group column showing the name, repeating it on
      // every leaf would be noise — but without a licence the grid is flat, so keep it then.
      headerName: 'Employee', field: 'employee', minWidth: 220, sortable: true, ...excelSetFilter(),
      rowGroup: true, hide: HAS_AG_GRID_LICENSE
    },
    {
      headerName: 'Rate Change', field: 'from', width: 130, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      // Group rows carry no row data — never format their placeholder value.
      valueFormatter: (p) => (p.data ? formatDate(p.value) : ''),
      cellClass: 'font-mono text-xs font-bold text-slate-800'
    },
    {
      headerName: 'Until', field: 'to', width: 115, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      valueFormatter: (p) => (!p.data ? '' : p.value ? formatDate(p.value) : 'Present'),
      cellClass: 'font-mono text-xs text-slate-600'
    },
    {
      headerName: 'Basis', field: 'basis', width: 145, sortable: true, ...excelSetFilter(),
      cellClass: 'text-xs font-semibold text-slate-700'
    },
    {
      headerName: 'Gross Base', field: 'gross', width: 130, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      valueFormatter: (p) => (!p.data || p.value == null ? '' : `€${Number(p.value).toLocaleString()}`),
      cellClass: 'font-mono font-bold text-slate-800'
    },
    {
      headerName: 'Fully-Loaded Cost', field: 'loaded', width: 170, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      valueFormatter: (p) => (!p.data || p.value == null ? '' : `€${Number(p.value).toLocaleString()}/mo`),
      cellClass: 'font-mono font-extrabold text-emerald-700'
    },
    {
      headerName: 'Status', field: 'active', width: 140, sortable: true, ...excelSetFilter(['Active rate', 'Past history']),
      valueGetter: (p) => (p.data ? (p.data.active ? 'Active rate' : 'Past history') : ''),
      cellRenderer: (p: ICellRendererParams<SalaryRow, string>) => (
        !p.value ? <span /> : p.value === 'Active rate'
          ? <Badge variant="success" className="font-extrabold">ACTIVE RATE</Badge>
          : <Badge variant="neutral" className="font-extrabold">PAST HISTORY</Badge>
      )
    },
    {
      headerName: 'Note', field: 'note', minWidth: 200, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<SalaryRow, string>) => (
        p.value ? <span className="text-xs text-slate-500 italic">“{p.value}”</span> : <span className="text-xs text-slate-300">—</span>
      )
    },
    {
      headerName: '', field: 'sal.id', width: 265, sortable: false, filter: false, pinned: 'right',
      valueGetter: (p) => p.data?.sal.id,
      cellRenderer: (p: ICellRendererParams<SalaryRow, string>) => {
        const row = p.data;
        if (!row) return <span />;
        const busy = backfillingId === row.sal.id;
        return (
          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); onBackfill(row.sal); }}
              className="text-[#3D87D3] border-[#3D87D3]/30 hover:bg-[#3D87D3]/5 cursor-pointer shrink-0"
            >
              <Zap className={`w-3.5 h-3.5 mr-1 ${busy ? 'animate-pulse' : ''}`} />
              {busy ? 'Producing…' : 'Past Payments'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); onEdit(row.sal); }}
              className="text-slate-600 border-slate-200 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              <Edit className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
          </div>
        );
      }
    }
  ], [backfillingId, onEdit, onBackfill]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search salary records across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {rowData.length} rate records · grouped per employee · use column filters for Excel-style options
        </span>
      </div>
      <div className="h-[520px]">
        <AgGridReact<SalaryRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
          quickFilterText={quickFilter}
          rowHeight={48}
          headerHeight={36}
          autoGroupColumnDef={{ headerName: 'Employee', minWidth: 260, cellClass: 'font-bold text-slate-800' }}
          {...GROUPING_OPTIONS}
          groupDefaultExpanded={-1}
          onRowDoubleClicked={e => { if (e.data) onEdit(e.data.sal); }}
        />
      </div>
    </div>
  );
};
