"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams, type ValueFormatterParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS, HAS_AG_GRID_LICENSE } from '@/lib/ag-grid-setup';
import { Invoice, InvoiceStatus } from '@/lib/types';
import { Badge } from '@/components/ui/primitives';
import { Copy, Check, FileText, Tag, Eye, Upload, Trash2, Edit, Search, ExternalLink } from 'lucide-react';

const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  draft: 'bg-amber-100 text-amber-900 border-amber-400',
  partially_paid: 'bg-amber-50 text-amber-800 border-amber-300',
  sent_received: 'bg-blue-50 text-blue-800 border-blue-300',
  disputed: 'bg-rose-50 text-rose-800 border-rose-300',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-300 line-through',
  registered: 'bg-slate-50 text-slate-700 border-slate-300',
  resolved: 'bg-indigo-50 text-indigo-700 border-indigo-300'
};

const eurFormatter = (params: ValueFormatterParams) =>
  `€${Number(params.value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

// Derive a "Year · Quarter" label from the invoice due date (YYYY-MM-DD).
const deriveYearQuarter = (dateStr?: string | null): string => {
  if (!dateStr) return '—';
  const [y, m] = dateStr.split('-');
  const month = parseInt(m, 10);
  if (!y || isNaN(month)) return '—';
  return `${y} · Q${Math.floor((month - 1) / 3) + 1}`;
};

interface InvoiceRow {
  inv: Invoice;
  entity: string;
  entitySub: string;
  direction: string;
  type: string;
  impact: 'Debit' | 'Credit';
  invoiceNumber: string;
  mark: string;
  linkage: string;
  linkageType: 'contract' | 'category';
  referencePeriod: string;
  yearQuarter: string;
  periodRange: string;
  issueDate: string;
  dueDate: string;
  overdue: boolean;
  gross: number;
  net: number;
  vatRate: string;
  status: string;
  hasDoc: string;
  docName: string;
  paidAmount: number;
  remaining: number;
}

interface InvoicesGridProps {
  invoices: Invoice[];
  onOpen: (inv: Invoice) => void;
  onStatusChange: (inv: Invoice, status: InvoiceStatus) => void;
  onMarkPaid: (inv: Invoice, remaining: number) => void;
  onDelete: (inv: Invoice) => void;
  onUploadDocument: (inv: Invoice, file: File) => void;
  onPreviewDocument: (inv: Invoice) => void;
  onPreviewAade: (inv: Invoice) => void;
  onOpenCounterparty: (inv: Invoice) => void;
}

export const InvoicesGrid: React.FC<InvoicesGridProps> = ({
  invoices,
  onOpen,
  onStatusChange,
  onMarkPaid,
  onDelete,
  onUploadDocument,
  onPreviewDocument,
  onPreviewAade,
  onOpenCounterparty
}) => {
  const [quickFilter, setQuickFilter] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<string>('none');

  const copyUuid = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const rowData = useMemo<InvoiceRow[]>(() => {
    return invoices.map(inv => {
      const paidAmount = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
      const remaining = Math.max(0, inv.gross_eur - paidAmount);
      const isOverdue = new Date(inv.due_date) < new Date() && inv.status !== 'paid' && inv.status !== 'cancelled';
      return {
        inv,
        entity: inv.counterparty?.legal_name || 'Unmapped Entity',
        entitySub: inv.counterparty?.trade_name || inv.counterparty?.country || 'Greece',
        direction: inv.direction,
        type: inv.type || 'invoice',
        impact: (inv.direction === 'outgoing' ? (inv.type === 'credit_note' ? 'Credit' : 'Debit') : (inv.type === 'credit_note' ? 'Debit' : 'Credit')),
        invoiceNumber: inv.invoice_number,
        mark: inv.mark || '',
        linkage: inv.contract ? (inv.contract.product || 'Agreement') : (inv.category || 'General Operating'),
        linkageType: inv.contract ? 'contract' : 'category',
        referencePeriod: inv.reference_period || '',
        yearQuarter: deriveYearQuarter(inv.issue_date),
        periodRange: [inv.period_from, inv.period_to].filter(Boolean).join(' → '),
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
        overdue: isOverdue,
        gross: inv.gross_eur,
        net: inv.net,
        vatRate: inv.vat_rate || '',
        status: inv.status,
        hasDoc: (inv.documents && inv.documents.length > 0) ? 'Yes' : 'No',
        docName: inv.documents && inv.documents[0] ? inv.documents[0].file_name : '',
        paidAmount,
        remaining
      };
    });
  }, [invoices]);

  const columnDefs = useMemo<ColDef<InvoiceRow>[]>(() => [
    {
      headerName: 'Counterparty', field: 'entity', minWidth: 210, sortable: true, ...excelSetFilter(), pinned: groupBy === 'entity' ? undefined : 'left', rowGroup: groupBy === 'entity',
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (p.data) onOpenCounterparty(p.data.inv); }}
          className="font-bold text-slate-900 block truncate hover:text-[#3D87D3] hover:underline text-left cursor-pointer"
          title={`Open counterparty: ${p.value || ''}`}
        >
          {p.value}
        </button>
      )
    },
    {
      headerName: 'Invoice UUID', field: 'inv.id', width: 135, sortable: true, ...excelSetFilter(),
      valueGetter: (p) => p.data?.inv.id,
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <button
          type="button"
          onClick={(e) => copyUuid(p.value || '', e)}
          className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-[#3D87D3] border border-slate-200 rounded font-mono text-[10px] transition-colors cursor-pointer"
          title="Click to copy full Invoice UUID"
        >
          <span>{(p.value || '').slice(0, 8)}...{(p.value || '').slice(-4)}</span>
          {copiedId === p.value ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-slate-400" />}
        </button>
      )
    },
    {
      headerName: 'Invoice # & MARK', field: 'invoiceNumber', width: 170, sortable: true, ...excelSetFilter(), rowGroup: groupBy === 'invoiceNumber',
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <div>
          <span className="font-extrabold text-slate-900 text-sm block font-mono">{p.value}</span>
          {p.data?.mark ? (
            <span className="text-[10px] text-emerald-600 font-mono bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 inline-block mt-0.5">MARK: {p.data.mark}</span>
          ) : (
            <span className="text-[10px] text-amber-600 italic block mt-0.5">Pending MARK sync</span>
          )}
        </div>
      )
    },
    {
      headerName: 'Type', field: 'type', width: 120, sortable: true, ...excelSetFilter(), rowGroup: groupBy === 'type',
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => {
        const typeLabel = p.value?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Invoice';
        return (
          <span className="font-bold text-slate-800 text-xs block">{typeLabel}</span>
        );
      }
    },
    {
      headerName: 'Impact', field: 'impact', width: 90, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border inline-block ${
          p.data?.impact === 'Debit' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
        }`}>
          {p.data?.impact}
        </span>
      )
    },
    {
      headerName: 'Linkage', field: 'linkage', width: 180, sortable: true, ...excelSetFilter(), rowGroup: groupBy === 'linkage',
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg w-fit border font-bold text-[11px] ${p.data?.linkageType === 'contract' ? 'text-indigo-700 bg-indigo-50 border-indigo-100' : 'text-purple-700 bg-purple-50 border-purple-100'}`}>
            {p.data?.linkageType === 'contract' ? <FileText className="w-3.5 h-3.5" /> : <Tag className="w-3.5 h-3.5" />}
            <span>{p.value}</span>
          </div>
          {p.data?.referencePeriod && (
            <div className="text-[10px] text-amber-800 font-mono bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60 font-black mt-1.5 w-fit">Ref: {p.data.referencePeriod}</div>
          )}
        </div>
      )
    },
    {
      headerName: 'Year · Qtr', field: 'yearQuarter', width: 120, sortable: true, ...excelSetFilter(), rowGroup: groupBy === 'yearQuarter',
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        p.value && p.value !== '—' ? (
          <span className="inline-flex items-center px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-md font-bold text-[11px] font-mono">{p.value}</span>
        ) : (
          <span className="text-slate-400 text-[11px] italic">Not set</span>
        )
      )
    },
    {
      headerName: 'Ref Period', field: 'periodRange', width: 210, sortable: true, ...excelSetFilter(), rowGroup: groupBy === 'periodRange',
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        p.value ? (
          <span className="text-[11px] text-slate-600 font-mono">{p.value}</span>
        ) : (
          <span className="text-slate-400 text-[11px] italic">—</span>
        )
      )
    },
    {
      headerName: 'Issue Date', field: 'issueDate', width: 110, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] }
    },
    {
      headerName: 'Due Date', field: 'dueDate', width: 110, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      cellClass: (params) => params.data?.overdue ? 'font-bold text-red-600' : ''
    },
    {
      headerName: 'Gross EUR', field: 'gross', width: 120, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-extrabold text-slate-900 font-mono',
      valueFormatter: eurFormatter
    },
    {
      headerName: 'Status', field: 'status', width: 150, sortable: true, rowGroup: groupBy === 'status',
      filter: 'agSetColumnFilter', filterParams: { values: ['draft', 'registered', 'sent_received', 'partially_paid', 'paid', 'disputed', 'resolved', 'cancelled'], excelMode: 'windows' },
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <select
          value={p.value || ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { if (p.data) onStatusChange(p.data.inv, e.target.value as InvoiceStatus); }}
          className={`text-xs font-extrabold px-2 py-1 rounded-lg border focus:outline-none cursor-pointer transition-all ${STATUS_STYLES[p.value || ''] || 'bg-slate-50 text-slate-700 border-slate-300'}`}
          title="Click to change invoice status"
        >
          <option value="draft">Draft</option>
          <option value="registered">Registered</option>
          <option value="sent_received">{p.data?.direction === 'outgoing' ? 'Sent' : 'Received'}</option>
          <option value="partially_paid">Partially Paid</option>
          <option value="paid">Paid in Full</option>
          <option value="disputed">Disputed</option>
          <option value="resolved">Resolved</option>
          <option value="cancelled">Cancelled</option>
        </select>
      )
    },
      {
        headerName: 'Archive', field: 'hasDoc', width: 220, sortable: true,
        ...excelSetFilter(['Yes', 'No']),
        cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
          <div className="flex items-center gap-1.5 flex-wrap">
            {p.value === 'Yes' ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); if (p.data) onPreviewDocument(p.data.inv); }}
                className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[11px] px-2.5 py-1 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                title="Click to Preview or Download Document"
              >
                <Eye className="w-3.5 h-3.5 text-[#3D87D3]" />
                <span>PDF: {(p.data?.docName || '').slice(0, 12)}...</span>
              </button>
            ) : (
              <label className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[11px] px-3 py-1 rounded-lg hover:bg-rose-100 cursor-pointer transition-colors" onClick={(e) => e.stopPropagation()}>
                <Upload className="w-3.5 h-3.5" />
                <span>Upload PDF</span>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0] && p.data) {
                      onUploadDocument(p.data.inv, e.target.files[0]);
                    }
                  }}
                />
              </label>
            )}
            {p.data?.inv.qr_url && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); if (p.data) onPreviewAade(p.data.inv); }}
                className="inline-flex items-center gap-1.5 bg-sky-50 text-[#3D87D3] border border-sky-200 font-bold text-[11px] px-2.5 py-1 rounded-lg hover:bg-sky-100 transition-colors cursor-pointer"
                title="View on AADE (myDATA verification page)"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>View on AADE</span>
              </button>
            )}
          </div>
        )
    },
    {
      headerName: '', field: 'inv.id', width: 250, sortable: false, filter: false, pinned: 'right',
      valueGetter: (p) => p.data?.inv.id,
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => {
        if (!p.data) return <span />;
        const settled = p.data.status === 'paid' || p.data.status === 'cancelled';
        return (
          <div className="flex items-center justify-end gap-2">
            {!settled && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onMarkPaid(p.data!.inv, p.data!.remaining); }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] px-3 py-1.5 rounded-xl transition-all cursor-pointer"
                title="1-Click Fast Path Collection / Payment"
              >
                Mark Paid Today
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (p.data) onOpen(p.data.inv); }}
              className="p-1.5 h-8 w-8 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-200 transition-colors cursor-pointer"
              title="Edit Invoice Details"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (p.data) onDelete(p.data.inv); }}
              className="p-1.5 h-8 w-8 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
              title="Delete Invoice Record"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      }
    }
  ], [copiedId, groupBy, onOpen, onStatusChange, onMarkPaid, onDelete, onUploadDocument, onPreviewDocument, onPreviewAade, onOpenCounterparty]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="flex items-center gap-2 w-full max-w-xl">
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search invoices across all columns..."
              value={quickFilter}
              onChange={e => setQuickFilter(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
            />
          </div>
          <select
            value={groupBy}
            onChange={e => setGroupBy(e.target.value)}
            disabled={!HAS_AG_GRID_LICENSE}
            title={HAS_AG_GRID_LICENSE ? 'Group rows by a column (clear to ungroup)' : 'Row grouping requires the AG Grid Enterprise license — set NEXT_PUBLIC_AG_GRID_LICENSE_KEY'}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] cursor-pointer shrink-0"
          >
            <option value="none">Group by: None</option>
            <option value="entity">Group by: Entity</option>
            <option value="status">Group by: Status</option>
            <option value="yearQuarter">Group by: Year · Quarter</option>
            <option value="linkage">Group by: Linkage</option>
            <option value="periodRange">Group by: Ref Period</option>
            <option value="invoiceNumber">Group by: Invoice #</option>
          </select>
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {invoices.length} invoices · double-click a row to open · use column filters for Excel-style options
        </span>
      </div>
      <div className="h-[560px]">
        <AgGridReact<InvoiceRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true }}
          quickFilterText={quickFilter}
          rowHeight={56}
          headerHeight={36}
          {...GROUPING_OPTIONS}
          groupDisplayType="groupRows"
          onRowDoubleClicked={e => { if (e.data) onOpen(e.data.inv); }}
          rowClassRules={{
            'invoice-row-overdue': (params) => !!params.data?.overdue
          }}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
        />
      </div>
      <style jsx global>{`
        .invoice-row-overdue {
          background-color: #fff7f7 !important;
        }
        .invoice-row-overdue:hover {
          background-color: #fef1f1 !important;
        }
      `}</style>
    </div>
  );
};
