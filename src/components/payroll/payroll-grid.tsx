"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { useOrbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { useGridFilterControls, ClearFiltersButton, type ExternalFilterSource } from '@/components/ui/grid-filter-controls';
import { bankReferences, formatBankReferences } from '@/lib/bank-references';
import { PaymentRecord, Profile, PaymentType } from '@/lib/types';
import { Copy, Check, Edit, Paperclip, Search } from 'lucide-react';

interface PayrollRow {
  pay: PaymentRecord;
  employee: string;
  employeeSub: string;
  period: string;
  paymentTypeEl: string;
  paymentTypeEn: string;
  gross: number;
  net: number;
  totalCost: number;
  bankRef: string;
  status: string;
  missingDoc: boolean;
  docCount: number;
  hasReceipt: boolean;
}

interface PayrollGridProps {
  payments: PaymentRecord[];
  profiles: Profile[];
  paymentTypes: PaymentType[];
  hasPaymentReceipt: (docs?: PaymentRecord['documents']) => boolean;
  onEdit: (pay: PaymentRecord) => void;
  onAttachDocs: (pay: PaymentRecord) => void;
  /** Inline row update straight from the grid — the small fields never need the edit modal. */
  onUpdate: (pay: PaymentRecord, updates: Partial<PaymentRecord>) => void;
  /** Filters the page applies before rows reach this grid, so "Clear filters" resets them too. */
  externalFilters?: ExternalFilterSource;
}

/** Status pill colours, shared by the inline status selector. */
const STATUS_SELECT_CLASS: Record<string, string> = {
  planned: 'bg-amber-100 border-amber-300 text-amber-900',
  paid: 'bg-emerald-100 border-emerald-300 text-emerald-900',
  cancelled: 'bg-slate-100 border-slate-300 text-slate-600'
};

/**
 * Click-to-edit bank references. A settlement can arrive as several transfers, so the cell shows the
 * joined list and editing accepts commas. Money fields (gross / net / total cost) stay in the edit
 * modal because the three are derived from each other and must change together.
 */
const InlineBankRef: React.FC<{ row: PayrollRow; onUpdate: PayrollGridProps['onUpdate'] }> = ({ row, onUpdate }) => {
  // `null` = showing the stored value; a string = the in-progress draft. No effect needed: while
  // not editing the cell always renders `row.bankRef`, so realtime rewrites show up directly.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const refs = bankReferences(draft ?? '');
    setDraft(null);
    const next = refs.join(', ');
    if (next !== row.bankRef) onUpdate(row.pay, { bank_reference: refs.length ? refs : undefined });
  };

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setDraft(row.bankRef); }}
        onDoubleClick={e => e.stopPropagation()}
        title="Click to edit · separate several references with commas"
        className="w-full text-left px-1 py-0.5 rounded hover:bg-slate-100 transition-colors cursor-text"
      >
        {row.bankRef
          ? <span className="font-mono text-xs text-slate-600">{row.bankRef}</span>
          : <span className="text-slate-400 italic text-xs">Pending Ref</span>}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(null);
      }}
      className="w-full px-1 py-0.5 border border-[var(--accent)] rounded text-xs font-mono text-slate-800 focus:outline-none"
    />
  );
};

export const PayrollGrid: React.FC<PayrollGridProps> = ({
  payments,
  profiles,
  paymentTypes,
  hasPaymentReceipt,
  onEdit,
  onAttachDocs,
  onUpdate,
  externalFilters
}) => {
  const gridTheme = useOrbitGridTheme();
  const gridFilters = useGridFilterControls(externalFilters);
  const { quickFilter, setQuickFilter } = gridFilters;
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyUuid = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const rowData = useMemo<PayrollRow[]>(() => {
    return payments.map(pay => {
      const prof = profiles.find(p => p.id === pay.profile_id);
      const pt = paymentTypes.find(type => type.id === pay.payment_type_id) || pay.payment_type;
      const missingDoc = pay.status === 'paid' && !hasPaymentReceipt(pay.documents);
      return {
        pay,
        employee: prof ? `${prof.first_name} ${prof.last_name}` : 'Unknown Member',
        employeeSub: prof ? prof.employment_type.replace('_', ' ') : '',
        period: pay.period,
        paymentTypeEl: pt?.name_el || 'Μισθός',
        paymentTypeEn: pt?.name_en || '',
        gross: pay.gross,
        net: pay.net,
        totalCost: pay.total_cost,
        bankRef: formatBankReferences(pay.bank_reference),
        status: pay.status,
        missingDoc,
        docCount: (pay.documents || []).length,
        hasReceipt: hasPaymentReceipt(pay.documents)
      };
    });
  }, [payments, profiles, paymentTypes, hasPaymentReceipt]);

  const columnDefs = useMemo<ColDef<PayrollRow>[]>(() => [
    {
      headerName: 'Employee / Partner', field: 'employee', minWidth: 200, sortable: true, ...excelSetFilter(), pinned: 'left',
      cellRenderer: (p: ICellRendererParams<PayrollRow, string>) => (
        <div>
          <div className="font-bold text-slate-800">{p.value}</div>
          <div className="text-xs text-slate-500 font-normal">{p.data?.employeeSub}</div>
        </div>
      )
    },
    {
      headerName: 'Period', field: 'period', width: 110, sortable: true, ...excelSetFilter(),
      cellClass: 'font-mono text-xs font-bold text-indigo-700'
    },
    {
      headerName: 'Status', field: 'status', width: 145, sortable: true, ...excelSetFilter(['planned', 'paid', 'cancelled']),
      // Inline selector: one click changes the status, no trip through the edit modal.
      cellRenderer: (p: ICellRendererParams<PayrollRow, string>) => {
        if (!p.data) return <span />;
        const row = p.data;
        return (
          <div>
            <select
              value={row.status}
              onClick={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
              onChange={e => onUpdate(row.pay, { status: e.target.value as PaymentRecord['status'] })}
              title="Set the status directly"
              className={`w-full px-1.5 py-1 rounded-md border text-[11px] font-extrabold cursor-pointer transition-colors ${STATUS_SELECT_CLASS[row.status] || STATUS_SELECT_CLASS.planned}`}
            >
              <option value="planned">PLANNED</option>
              <option value="paid">PAID</option>
              <option value="cancelled">CANCELLED</option>
            </select>
            {row.missingDoc && (
              <span className="text-[10px] text-amber-700 font-bold block mt-0.5">⚠️ Missing Receipt</span>
            )}
          </div>
        );
      }
    },
    {
      headerName: 'Payment UUID', field: 'pay.id', width: 140, sortable: true, ...excelSetFilter(),
      valueGetter: (p) => p.data?.pay.id,
      cellRenderer: (p: ICellRendererParams<PayrollRow, string>) => (
        <button
          type="button"
          onClick={(e) => copyUuid(p.value || '', e)}
          className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-[var(--accent)] border border-slate-200 rounded font-mono text-[10px] transition-colors cursor-pointer"
          title="Click to copy full Payment UUID"
        >
          <span>{(p.value || '').slice(0, 8)}...{(p.value || '').slice(-4)}</span>
          {copiedId === p.value ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-slate-400" />}
        </button>
      )
    },
    {
      headerName: 'Payment Type', field: 'paymentTypeEl', width: 150, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<PayrollRow, string>) => (
        <div>
          <div className="text-xs text-[var(--accent)] font-medium">{p.value}</div>
          <div className="text-[10px] text-slate-400 font-normal">{p.data?.paymentTypeEn}</div>
        </div>
      )
    },
    {
      headerName: 'Gross', field: 'gross', width: 105, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono text-slate-700',
      valueFormatter: (p) => `€${Number(p.value).toLocaleString()}`
    },
    {
      headerName: 'Net Pay', field: 'net', width: 105, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono font-bold text-emerald-700',
      valueFormatter: (p) => `€${Number(p.value).toLocaleString()}`
    },
    {
      headerName: 'Total Cost', field: 'totalCost', width: 115, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono font-extrabold text-slate-900',
      valueFormatter: (p) => `€${Number(p.value).toLocaleString()}`
    },
    {
      headerName: 'Bank Reference', field: 'bankRef', width: 160, sortable: true, ...excelSetFilter(),
      cellClass: 'font-mono text-xs text-slate-600',
      cellRenderer: (p: ICellRendererParams<PayrollRow, string>) => (
        p.data ? <InlineBankRef row={p.data} onUpdate={onUpdate} /> : <span />
      )
    },
    {
      headerName: 'Vouchers & Actions', field: 'pay.id', width: 190, sortable: false, filter: false, pinned: 'right',
      valueGetter: (p) => p.data?.pay.id,
      cellRenderer: (p: ICellRendererParams<PayrollRow, string>) => {
        if (!p.data) return <span />;
        const row = p.data;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(row.pay); }}
              title="Adjust Amounts / Edit"
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            >
              <Edit className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAttachDocs(row.pay); }}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                row.missingDoc ? 'bg-amber-100 border-amber-300 text-amber-900 font-bold' : 'bg-slate-100 hover:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-slate-700 hover:text-indigo-700'
              }`}
            >
              <Paperclip className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
              {row.docCount > 0 ? (
                <span className="font-bold text-slate-900 flex items-center gap-1">
                  {row.docCount} doc{row.docCount !== 1 ? 's' : ''}
                  {row.hasReceipt ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-extrabold bg-emerald-100 text-emerald-800 rounded border border-emerald-300">✓ Receipt</span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-extrabold bg-amber-200 text-amber-900 rounded border border-amber-400">No Receipt</span>
                  )}
                </span>
              ) : (
                <span>{row.missingDoc ? '+ Attach Receipt' : 'Attach Docs'}</span>
              )}
            </button>
          </div>
        );
      }
    }
  ], [copiedId, hasPaymentReceipt, onEdit, onAttachDocs, onUpdate]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search payroll across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] placeholder:text-slate-400"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ClearFiltersButton controls={gridFilters} />
          <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
            {payments.length} payments · use column filters for Excel-style options
          </span>
        </div>
      </div>
      <div className="h-[560px]">
        <AgGridReact<PayrollRow>
          theme={gridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
          {...gridFilters.gridProps}
          quickFilterText={quickFilter}
          rowHeight={52}
          headerHeight={36}
          {...GROUPING_OPTIONS}
          onRowDoubleClicked={e => { if (e.data) onAttachDocs(e.data.pay); }}
          rowClassRules={{
            'payroll-row-missing-doc': (params) => !!params.data?.missingDoc
          }}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
        />
      </div>
      <style jsx global>{`
        .payroll-row-missing-doc {
          background-color: color-mix(in srgb, var(--warning-soft) 60%, var(--surface)) !important;
        }
      `}</style>
    </div>
  );
};
