"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { PaymentRecord, Profile, PaymentType } from '@/lib/types';
import { Badge } from '@/components/ui/primitives';
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
  employer: number;
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
}

export const PayrollGrid: React.FC<PayrollGridProps> = ({
  payments,
  profiles,
  paymentTypes,
  hasPaymentReceipt,
  onEdit,
  onAttachDocs
}) => {
  const [quickFilter, setQuickFilter] = useState('');
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
        employeeSub: prof ? `${prof.title} (${prof.employment_type})` : '',
        period: pay.period,
        paymentTypeEl: pt?.name_el || 'Μισθός',
        paymentTypeEn: pt?.name_en || '',
        gross: pay.gross,
        net: pay.net,
        employer: pay.employer_contributions,
        totalCost: pay.total_cost,
        bankRef: pay.bank_reference || '',
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
      headerName: 'Payment UUID', field: 'pay.id', width: 140, sortable: true, ...excelSetFilter(),
      valueGetter: (p) => p.data?.pay.id,
      cellRenderer: (p: ICellRendererParams<PayrollRow, string>) => (
        <button
          type="button"
          onClick={(e) => copyUuid(p.value || '', e)}
          className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-[#3D87D3] border border-slate-200 rounded font-mono text-[10px] transition-colors cursor-pointer"
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
          <div className="text-xs text-[#3D87D3] font-medium">{p.value}</div>
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
      headerName: 'Employer EFKA', field: 'employer', width: 115, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono text-slate-600',
      valueFormatter: (p) => `€${Number(p.value).toLocaleString()}`
    },
    {
      headerName: 'Total Cost', field: 'totalCost', width: 115, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono font-extrabold text-slate-900',
      valueFormatter: (p) => `€${Number(p.value).toLocaleString()}`
    },
    {
      headerName: 'Bank Reference', field: 'bankRef', width: 130, sortable: true, ...excelSetFilter(),
      cellClass: 'font-mono text-xs text-slate-600',
      cellRenderer: (p: ICellRendererParams<PayrollRow, string>) => (
        p.value ? <span>{p.value}</span> : <span className="text-slate-400 italic font-sans font-normal">Pending Ref</span>
      )
    },
    {
      headerName: 'Status', field: 'status', width: 120, sortable: true, ...excelSetFilter(['planned', 'paid', 'cancelled']),
      cellRenderer: (p: ICellRendererParams<PayrollRow, string>) => (
        <div>
          <Badge variant={p.value === 'paid' ? 'success' : p.value === 'planned' ? 'warning' : 'neutral'}>
            {String(p.value).toUpperCase()}
          </Badge>
          {p.data?.missingDoc && (
            <span className="text-[10px] text-amber-700 font-bold block mt-1">⚠️ Missing Receipt</span>
          )}
        </div>
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
              <Paperclip className="w-3.5 h-3.5 text-[#3D87D3] shrink-0" />
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
  ], [copiedId, hasPaymentReceipt, onEdit, onAttachDocs]);

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
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {payments.length} payments · use column filters for Excel-style options
        </span>
      </div>
      <div className="h-[560px]">
        <AgGridReact<PayrollRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true }}
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
          background-color: #fffbf5 !important;
        }
      `}</style>
    </div>
  );
};
