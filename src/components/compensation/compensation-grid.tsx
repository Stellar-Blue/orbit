"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { PaymentRecord } from '@/lib/types';
import { Card } from '@/components/ui/primitives';
import { CheckCircle2, Download, Paperclip, Search } from 'lucide-react';

interface CompRow {
  record: PaymentRecord;
  period: string;
  typeEl: string;
  note: string;
  gross: number;
  net: number;
  paymentDate: string;
  bankRef: string;
  docCount: number;
}

interface CompensationGridProps {
  payments: PaymentRecord[];
  isContractor: boolean;
  onOpenDocs: (record: PaymentRecord) => void;
  onDownloadPayslip: (record: PaymentRecord) => void;
}

const deEur = (value: number) => `€${Number(value).toLocaleString('de-DE', { minimumFractionDigits: 2 })}`;

export const CompensationGrid: React.FC<CompensationGridProps> = ({
  payments,
  isContractor,
  onOpenDocs,
  onDownloadPayslip
}) => {
  const [quickFilter, setQuickFilter] = useState('');

  const rowData = useMemo<CompRow[]>(() => {
    return payments.map(record => ({
      record,
      period: record.period,
      typeEl: record.payment_type?.name_el || (isContractor ? 'Partner Retainer' : 'Regular Monthly Salary'),
      note: record.note || record.payment_type?.name_en || 'Standard disbursement',
      gross: record.gross,
      net: record.net,
      paymentDate: record.payment_date || `${record.period}-28`,
      bankRef: record.bank_reference || 'WIRE-TRANSFER',
      docCount: (record.documents || []).length
    }));
  }, [payments, isContractor]);

  const columnDefs = useMemo<ColDef<CompRow>[]>(() => [
    {
      headerName: 'Period', field: 'period', width: 110, sortable: true, ...excelSetFilter(), pinned: 'left',
      cellClass: 'font-mono font-extrabold text-slate-900 text-sm'
    },
    {
      headerName: 'Payment Type & Memo', field: 'typeEl', width: 240, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<CompRow, string>) => (
        <div>
          <span className="block text-sm text-[#3D87D3] font-bold">{p.value}</span>
          <span className="text-xs text-slate-500 font-normal">{p.data?.note}</span>
        </div>
      )
    },
    {
      headerName: 'Gross Earnings', field: 'gross', width: 130, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono font-bold text-slate-700 text-sm',
      valueFormatter: (p) => deEur(p.value)
    },
    {
      headerName: 'Net Disbursed', field: 'net', width: 130, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono font-extrabold text-emerald-700 text-sm',
      valueFormatter: (p) => deEur(p.value)
    },
    {
      headerName: 'Payment Date & Bank Ref', field: 'paymentDate', width: 190, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      cellClass: 'font-mono text-xs',
      cellRenderer: (p: ICellRendererParams<CompRow, string>) => (
        <div>
          <span className="text-slate-800 font-semibold block">{p.value}</span>
          <span className="text-[10px] text-slate-400 uppercase tracking-tight">{p.data?.bankRef}</span>
        </div>
      )
    },
    {
      headerName: 'Status', field: 'record.status', width: 100, sortable: true, ...excelSetFilter(['paid']),
      valueGetter: (p) => p.data?.record.status,
      cellRenderer: (p: ICellRendererParams<CompRow, string>) => (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-extrabold">
          <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> PAID
        </span>
      )
    },
    {
      headerName: 'Voucher / Receipt', field: 'docCount', width: 160, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellRenderer: (p: ICellRendererParams<CompRow, number>) => (
        (p.value || 0) > 0 ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenDocs(p.data!.record); }}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-[#3D87D3]/10 hover:bg-[#3D87D3]/20 text-[#3D87D3] font-bold text-xs border border-[#3D87D3]/20 transition-all cursor-pointer"
          >
            <Paperclip className="w-3.5 h-3.5 mr-1" /> {(p.value || 0)} Receipt{(p.value || 0) > 1 ? 's' : ''}
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDownloadPayslip(p.data!.record); }}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs border border-slate-300/80 transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> Statement
          </button>
        )
      )
    }
  ], [isContractor, onOpenDocs, onDownloadPayslip]);

  return (
    <Card className="shadow-xs border-slate-200/90 overflow-hidden p-0">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search statements across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {payments.length} disbursements · use column filters for Excel-style options
        </span>
      </div>
      <div className="h-[480px]">
        <AgGridReact<CompRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true }}
          quickFilterText={quickFilter}
          rowHeight={56}
          headerHeight={36}
          {...GROUPING_OPTIONS}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
        />
      </div>
    </Card>
  );
};
