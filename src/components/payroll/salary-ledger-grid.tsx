"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS, HAS_AG_GRID_LICENSE } from '@/lib/ag-grid-setup';
import { formatDate } from '@/lib/date';
import { SalaryRecord, SalaryBonus, PaymentType, Profile } from '@/lib/types';
import { loadedMonthlyCost, employerCostRatio } from '@/lib/compensation';
import { Badge, Button } from '@/components/ui/primitives';
import { Search, Edit, Zap, Trash2 } from 'lucide-react';

interface LedgerRow {
  kind: 'salary' | 'extra';
  id: string;
  sal?: SalaryRecord;
  extra?: SalaryBonus;
  employee: string;
  entry: string;
  entrySub: string;
  category: string;
  from: string;
  to: string;
  basis: string;
  gross: number;
  loaded: number;
  status: string;
  note: string;
}

interface SalaryLedgerGridProps {
  salaries: SalaryRecord[];
  /** Contractual recurring monthly extras (salary_bonuses, kind=recurring, frequency=monthly) — any status. */
  extras: SalaryBonus[];
  profiles: Profile[];
  paymentTypes: PaymentType[];
  /** Salary record currently generating its past payment rows (disables the button). */
  backfillingId: string | null;
  onEdit: (sal: SalaryRecord) => void;
  onBackfill: (sal: SalaryRecord) => void;
  onDelete: (sal: SalaryRecord) => void;
  onToggleExtra: (extra: SalaryBonus) => void;
  onDeleteExtra: (extra: SalaryBonus) => void;
}

const BASIS_LABELS: Record<string, string> = {
  monthly_gross: 'Monthly Gross',
  daily_rate: 'Daily Rate',
  fixed_fee: 'Fixed Fee',
  fee: 'Fee'
};

const STATUS_FILTER_VALUES = ['Active rate', 'Past history', 'Active extra', 'Paused extra'];

/** Extras are month-based (YYYY-MM); anchor to the 1st so dates sort/filter consistently. */
const monthToDate = (ym?: string | null) => (ym ? `${ym}-01` : '');

/** Money in the ledger is whole euros — ratios produce cents (60 × 1.24 = 74.4) that read as noise. */
const euro = (v: unknown) => `€${Math.round(Number(v) || 0).toLocaleString()}`;

/**
 * Effective-dated salary ledger. Rows are grouped per employee (row grouping — requires the
 * AG Grid Enterprise key; without it the grid simply renders flat) and carry BOTH the salary
 * records and the contractual recurring monthly extras (the Dynamic Payment Types paid on
 * top of the base salary), so one employee's monthly cost picture sits in one group.
 */
export const SalaryLedgerGrid: React.FC<SalaryLedgerGridProps> = ({
  salaries,
  extras,
  profiles,
  paymentTypes,
  backfillingId,
  onEdit,
  onBackfill,
  onDelete,
  onToggleExtra,
  onDeleteExtra
}) => {
  const [quickFilter, setQuickFilter] = useState('');

  const rowData = useMemo<LedgerRow[]>(() => {
    // Employer-cost ratio driving an extra's fully-loaded cost (mirrors what payroll does).
    const activeSalaryByProfile = new Map<string, SalaryRecord>();
    salaries.filter(s => !s.valid_to).forEach(s => activeSalaryByProfile.set(s.profile_id, s));
    const loadedExtraCost = (profileId: string, amount: number) => {
      const active = activeSalaryByProfile.get(profileId);
      const ratio = active ? employerCostRatio(active) : 1;
      return Number((amount * ratio).toFixed(2));
    };
    const employeeName = (profileId: string) => {
      const prof = profiles.find(p => p.id === profileId);
      return prof ? `${prof.first_name} ${prof.last_name}` : 'Unknown Team Member';
    };

    const salaryRows: LedgerRow[] = salaries.map(sal => ({
      kind: 'salary',
      id: sal.id,
      sal,
      employee: employeeName(sal.profile_id),
      entry: 'Base Salary',
      entrySub: '',
      category: 'Salary',
      from: sal.valid_from || '',
      to: sal.valid_to || '',
      basis: BASIS_LABELS[sal.basis] || sal.basis,
      gross: Number(sal.gross_amount) || 0,
      loaded: loadedMonthlyCost(sal),
      status: !sal.valid_to ? 'Active rate' : 'Past history',
      note: sal.note || ''
    }));

    const extraRows: LedgerRow[] = extras.map(b => {
      const pt = b.payment_type_id ? paymentTypes.find(t => t.id === b.payment_type_id) : undefined;
      const amount = Number(b.amount) || 0;
      return {
        kind: 'extra',
        id: b.id,
        extra: b,
        employee: employeeName(b.profile_id),
        entry: 'Recurring Extra',
        entrySub: b.name,
        category: pt ? `${pt.name_el} · ${pt.name_en}` : 'Generic Bonus category',
        from: monthToDate(b.start_period),
        to: monthToDate(b.end_period),
        basis: 'Monthly',
        gross: amount,
        loaded: loadedExtraCost(b.profile_id, amount),
        status: b.status === 'active' ? 'Active extra' : 'Paused extra',
        note: b.note || ''
      };
    });

    // Group order = employee (A→Z); inside a group: salary records first (newest rate first),
    // then the extras (active ahead of paused).
    return [...salaryRows, ...extraRows].sort((a, b) =>
      a.employee.localeCompare(b.employee) ||
      (a.kind === b.kind ? 0 : a.kind === 'salary' ? -1 : 1) ||
      (a.status === b.status ? 0 : a.status.startsWith('Active') ? -1 : 1) ||
      b.from.localeCompare(a.from)
    );
  }, [salaries, extras, profiles, paymentTypes]);

  const columnDefs = useMemo<ColDef<LedgerRow>[]>(() => [
    {
      // Used as the row-group key. With the group column showing the name, repeating it on
      // every leaf would be noise — but without a licence the grid is flat, so keep it then.
      headerName: 'Employee', field: 'employee', minWidth: 220, sortable: true, ...excelSetFilter(),
      rowGroup: true, hide: HAS_AG_GRID_LICENSE
    },
    {
      headerName: 'Entry', field: 'entry', width: 195, sortable: true, ...excelSetFilter(['Base Salary', 'Recurring Extra']),
      cellRenderer: (p: ICellRendererParams<LedgerRow, string>) => (
        <div>
          <Badge variant={p.value === 'Recurring Extra' ? 'info' : 'neutral'} className="font-extrabold">
            {p.value === 'Recurring Extra' ? '◆ RECURRING EXTRA' : '● BASE SALARY'}
          </Badge>
          {p.data?.entrySub && <div className="text-[11px] text-slate-500 font-semibold mt-0.5 truncate">{p.data.entrySub}</div>}
        </div>
      )
    },
    {
      headerName: 'Payment Category', field: 'category', width: 185, sortable: true, ...excelSetFilter(),
      cellClass: 'text-xs text-slate-600',
      tooltipField: 'category'
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
      valueFormatter: (p) => (!p.data || p.value == null ? '' : euro(p.value)),
      cellClass: 'font-mono font-bold text-slate-800'
    },
    {
      headerName: 'Fully-Loaded Cost', field: 'loaded', width: 170, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      valueFormatter: (p) => (!p.data || p.value == null ? '' : `${euro(p.value)}/mo`),
      cellClass: 'font-mono font-extrabold text-emerald-700'
    },
    {
      headerName: 'Status', field: 'status', width: 150, sortable: true, ...excelSetFilter(STATUS_FILTER_VALUES),
      cellRenderer: (p: ICellRendererParams<LedgerRow, string>) => {
        if (!p.value) return <span />;
        if (p.value === 'Past history') return <Badge variant="neutral" className="font-extrabold">PAST HISTORY</Badge>;
        if (p.value === 'Paused extra') return <Badge variant="warning" className="font-extrabold">PAUSED</Badge>;
        return <Badge variant="success" className="font-extrabold">{p.value.toUpperCase()}</Badge>;
      }
    },
    {
      headerName: 'Note', field: 'note', minWidth: 200, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<LedgerRow, string>) => (
        p.value ? <span className="text-xs text-slate-500 italic">“{p.value}”</span> : <span className="text-xs text-slate-300">—</span>
      )
    },
    {
      headerName: '', field: 'id', width: 320, sortable: false, filter: false, pinned: 'right',
      valueGetter: (p) => p.data?.id,
      cellRenderer: (p: ICellRendererParams<LedgerRow, string>) => {
        const row = p.data;
        if (!row) return <span />;
        if (row.kind === 'extra' && row.extra) {
          const b = row.extra;
          return (
            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); onToggleExtra(b); }}
                title={b.status === 'active' ? 'Stop paying this extra (history is kept)' : 'Resume paying this extra'}
                className="cursor-pointer shrink-0"
              >
                {b.status === 'active' ? 'Pause' : 'Resume'}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={(e) => { e.stopPropagation(); onDeleteExtra(b); }}
                title="Delete this recurring extra"
                className="cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        }
        const busy = backfillingId === row.sal?.id;
        return (
          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); if (row.sal) onBackfill(row.sal); }}
              className="text-[#3D87D3] border-[#3D87D3]/30 hover:bg-[#3D87D3]/5 cursor-pointer shrink-0"
            >
              <Zap className={`w-3.5 h-3.5 mr-1 ${busy ? 'animate-pulse' : ''}`} />
              {busy ? 'Producing…' : 'Past Payments'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); if (row.sal) onEdit(row.sal); }}
              className="text-slate-600 border-slate-200 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              <Edit className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={(e) => { e.stopPropagation(); if (row.sal) onDelete(row.sal); }}
              title="Delete this salary record"
              className="cursor-pointer shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        );
      }
    }
  ], [backfillingId, onEdit, onBackfill, onDelete, onToggleExtra, onDeleteExtra]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search salaries & extras across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {rowData.filter(r => r.kind === 'salary').length} salary record(s) · {rowData.filter(r => r.kind === 'extra').length} recurring extra(s) · grouped per employee
        </span>
      </div>
      <div className="h-[520px]">
        <AgGridReact<LedgerRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
          quickFilterText={quickFilter}
          rowHeight={52}
          headerHeight={36}
          autoGroupColumnDef={{ headerName: 'Employee', minWidth: 260, cellClass: 'font-bold text-slate-800' }}
          {...GROUPING_OPTIONS}
          groupDefaultExpanded={-1}
          onRowDoubleClicked={e => { if (e.data?.sal) onEdit(e.data.sal); }}
        />
      </div>
    </div>
  );
};
