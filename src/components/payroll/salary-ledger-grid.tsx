"use client";

import React, { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { useOrbitGridTheme, excelSetFilter, GROUPING_OPTIONS, HAS_AG_GRID_LICENSE } from '@/lib/ag-grid-setup';
import { useGridFilterControls, ClearFiltersButton } from '@/components/ui/grid-filter-controls';
import { formatDate } from '@/lib/date';
import { SalaryRecord, PaymentType, Profile } from '@/lib/types';
import { loadedMonthlyCost, isBaseSalary, isOneTimeBonus, loadedExtraCost } from '@/lib/compensation';
import { Badge, Button } from '@/components/ui/primitives';
import { Search, Edit, Zap, Trash2 } from 'lucide-react';

interface LedgerRow {
  kind: 'salary' | 'extra' | 'bonus';
  id: string;
  sal: SalaryRecord;
  employee: string;
  /** Dynamic Payment Type this row is filed under (`name_el · name_en`), or `Unassigned`. */
  paymentType: string;
  /** Extra/bonus name — the payroll draft note. Empty for base rows. */
  paymentTypeSub: string;
  from: string;
  to: string;
  basis: string;
  /** What the employee receives — `salary_history.gross_amount`. */
  net: number;
  /** Net + employer cost (the derived gross). */
  gross: number;
  /** Optional total company cost as the accountant bills it — empty until the figure is known. */
  companyCost: number | null;
  status: string;
  note: string;
}

interface SalaryLedgerGridProps {
  /** Every effective-dated ledger entry: base rates, contractual recurring extras and one-off bonuses. */
  salaries: SalaryRecord[];
  profiles: Profile[];
  paymentTypes: PaymentType[];
  /** Ledger entry currently generating its past payment rows (disables the button). */
  backfillingId: string | null;
  onEdit: (sal: SalaryRecord) => void;
  onBackfill: (sal: SalaryRecord) => void;
  onDelete: (sal: SalaryRecord) => void;
}

const BASIS_LABELS: Record<string, string> = {
  monthly_gross: 'Monthly Gross',
  daily_rate: 'Daily Rate',
  fixed_fee: 'Fixed Fee',
  fee: 'Fee'
};

const STATUS_FILTER_VALUES = ['Active rate', 'Past history', 'Active extra', 'Past extra', 'One-off bonus'];

/** Today as YYYY-MM-DD — used to decide whether an entry's validity window is still running. */
const today = () => new Date().toISOString().slice(0, 10);

/** Money in the ledger is whole euros — ratios produce cents (60 × 1.24 = 74.4) that read as noise. */
const euro = (v: unknown) => `€${Math.round(Number(v) || 0).toLocaleString()}`;

/**
 * Effective-dated salary ledger — the single source of truth for what an employee is paid.
 * Money reads net → gross → full company cost: net is what the employee receives, gross adds the
 * employer cost, and the accountant's total company cost is optional and filled in later.
 * Rows are grouped per employee (row grouping requires the AG Grid Enterprise key; without it the
 * grid renders flat) and cover the base rate, contractual recurring extras and one-off bonuses,
 * so one employee's whole monthly cost picture sits in one group.
 */
export const SalaryLedgerGrid: React.FC<SalaryLedgerGridProps> = ({
  salaries,
  profiles,
  paymentTypes,
  backfillingId,
  onEdit,
  onBackfill,
  onDelete
}) => {
  const gridTheme = useOrbitGridTheme();
  const gridFilters = useGridFilterControls();
  const { quickFilter, setQuickFilter } = gridFilters;

  const rowData = useMemo<LedgerRow[]>(() => {
    const employeeName = (profileId: string) => {
      const prof = profiles.find(p => p.id === profileId);
      return prof ? `${prof.first_name} ${prof.last_name}` : 'Unknown employee';
    };
    const paymentTypeLabel = (sal: SalaryRecord) => {
      const pt = sal.payment_type_id ? paymentTypes.find(t => t.id === sal.payment_type_id) : undefined;
      return pt ? `${pt.name_el} · ${pt.name_en}` : 'Unassigned';
    };
    const isRunning = (sal: SalaryRecord) => !sal.valid_to || sal.valid_to >= today();

    return salaries.map<LedgerRow>(sal => {
      const base = isBaseSalary(sal);
      const amount = Number(sal.gross_amount) || 0;
      return {
        kind: base ? 'salary' : isOneTimeBonus(sal) ? 'bonus' : 'extra',
        id: sal.id,
        sal,
        employee: employeeName(sal.profile_id),
        // The row's Dynamic Payment Type is what payroll files the money under, so it is the
        // column that matters — the old Entry / Payment Category pair said the same thing twice.
        paymentType: paymentTypeLabel(sal),
        paymentTypeSub: base ? '' : (sal.label || ''),
        from: sal.valid_from || '',
        to: sal.valid_to || '',
        basis: base ? (BASIS_LABELS[sal.basis] || sal.basis) : 'Monthly',
        net: amount,
        // Base rates carry their own employer cost; extras inherit the employee's base ratio.
        gross: base ? loadedMonthlyCost(sal) : loadedExtraCost(salaries, sal.profile_id, amount),
        companyCost: sal.full_company_cost == null ? null : Number(sal.full_company_cost),
        status: base
          ? (sal.valid_to ? 'Past history' : 'Active rate')
          : isOneTimeBonus(sal)
            ? 'One-off bonus'
            : (isRunning(sal) ? 'Active extra' : 'Past extra'),
        note: sal.note || ''
      };
    }).sort((a, b) =>
      // Group order = employee (A→Z); inside a group: base rates first (newest first),
      // then extras/bonuses with the running ones ahead of the expired ones.
      a.employee.localeCompare(b.employee) ||
      (a.kind === b.kind ? 0 : a.kind === 'salary' ? -1 : 1) ||
      (a.status === b.status ? 0 : a.status.startsWith('Active') ? -1 : 1) ||
      b.from.localeCompare(a.from)
    );
  }, [salaries, profiles, paymentTypes]);

  const columnDefs = useMemo<ColDef<LedgerRow>[]>(() => [
    {
      // Used as the row-group key. With the group column showing the name, repeating it on
      // every leaf would be noise — but without a licence the grid is flat, so keep it then.
      headerName: 'Employee', field: 'employee', minWidth: 220, sortable: true, ...excelSetFilter(),
      rowGroup: true, hide: HAS_AG_GRID_LICENSE
    },
    {
      headerName: 'Payment Type', field: 'paymentType', width: 245, sortable: true, ...excelSetFilter(),
      cellClass: 'text-xs text-slate-600',
      tooltipField: 'paymentType',
      cellRenderer: (p: ICellRendererParams<LedgerRow, string>) => {
        // Group rows carry no data — don't render their placeholder value.
        if (!p.data) return <span />;
        return (
          <div className="truncate">
            <div className="font-semibold text-slate-700 truncate">{p.value || 'Unassigned'}</div>
            {p.data.paymentTypeSub && (
              <div className="text-[11px] text-slate-400 font-medium truncate">{p.data.paymentTypeSub}</div>
            )}
          </div>
        );
      }
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
      headerName: 'Net', field: 'net', width: 125, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      headerTooltip: 'What the employee receives (net).',
      valueFormatter: (p) => (!p.data || p.value == null ? '' : euro(p.value)),
      cellClass: 'font-mono font-bold text-slate-800'
    },
    {
      headerName: 'Gross', field: 'gross', width: 150, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      headerTooltip: 'Net + employer contributions / VAT — the fully-loaded gross.',
      valueFormatter: (p) => (!p.data || p.value == null ? '' : `${euro(p.value)}/mo`),
      cellClass: 'font-mono font-extrabold text-emerald-700'
    },
    {
      headerName: 'Full Company Cost', field: 'companyCost', width: 175, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      headerTooltip: 'Optional: total monthly company cost as the accountant bills it. Left empty until the figure is available.',
      valueFormatter: (p) => (!p.data || p.value == null ? '' : `${euro(p.value)}/mo`),
      cellRenderer: (p: ICellRendererParams<LedgerRow, number | null>) => (
        p.value == null
          ? <span className="text-slate-300" title="Not recorded yet">—</span>
          : <span className="font-mono font-bold text-indigo-700">{euro(p.value)}/mo</span>
      )
    },
    {
      headerName: 'Status', field: 'status', width: 150, sortable: true, ...excelSetFilter(STATUS_FILTER_VALUES),
      cellRenderer: (p: ICellRendererParams<LedgerRow, string>) => {
        if (!p.value) return <span />;
        if (p.value === 'Past history') return <Badge variant="neutral" className="font-extrabold">PAST HISTORY</Badge>;
        if (p.value === 'Past extra') return <Badge variant="neutral" className="font-extrabold">PAST EXTRA</Badge>;
        if (p.value === 'One-off bonus') return <Badge variant="warning" className="font-extrabold">ONE-OFF</Badge>;
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
        // "Past Payments" only makes sense for a base rate: it backfills the salary/retainer rows
        // across the record's validity window. Extras are paid through the monthly draft run.
        const busy = backfillingId === row.sal.id;
        return (
          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
            {row.kind === 'salary' && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={(e) => { e.stopPropagation(); onBackfill(row.sal); }}
                className="text-[var(--accent)] border-[var(--accent)]/30 hover:bg-[var(--accent)]/5 cursor-pointer shrink-0"
              >
                <Zap className={`w-3.5 h-3.5 mr-1 ${busy ? 'animate-pulse' : ''}`} />
                {busy ? 'Producing…' : 'Past Payments'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); onEdit(row.sal); }}
              className="text-slate-600 border-slate-200 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              <Edit className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={(e) => { e.stopPropagation(); onDelete(row.sal); }}
              title="Delete this ledger entry"
              className="cursor-pointer shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        );
      }
    }
  ], [backfillingId, onEdit, onBackfill, onDelete]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search rates, extras & bonuses across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] placeholder:text-slate-400"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ClearFiltersButton controls={gridFilters} />
          <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
            {rowData.filter(r => r.kind === 'salary').length} base rate(s) · {rowData.filter(r => r.kind === 'extra').length} recurring extra(s) · {rowData.filter(r => r.kind === 'bonus').length} one-off bonus(es) · grouped per employee
          </span>
        </div>
      </div>
      <div className="h-[520px]">
        <AgGridReact<LedgerRow>
          theme={gridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
          {...gridFilters.gridProps}
          quickFilterText={quickFilter}
          rowHeight={52}
          headerHeight={36}
          autoGroupColumnDef={{ headerName: 'Employee', minWidth: 260, cellClass: 'font-bold text-slate-800' }}
          {...GROUPING_OPTIONS}
          groupDefaultExpanded={-1}
          onRowDoubleClicked={e => { if (e.data?.sal) onEdit(e.data.sal); }}
        />      </div>
    </div>
  );
};
