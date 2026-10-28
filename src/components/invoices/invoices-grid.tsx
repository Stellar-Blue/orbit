"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams, type GridApi, type GetContextMenuItemsParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS, HAS_AG_GRID_LICENSE } from '@/lib/ag-grid-setup';
import { useGridFilterControls, ClearFiltersButton, type ExternalFilterSource } from '@/components/ui/grid-filter-controls';
import { formatDate } from '@/lib/date';
import { formatMoney, DEFAULT_CURRENCY } from '@/lib/currency';
import { Invoice, InvoiceStatus, BudgetCategory } from '@/lib/types';
import { invoiceContractIds, invoiceProjectIds } from '@/lib/invoice-links';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/primitives';
import { Copy, Check, FileText, Tag, Eye, Upload, Trash2, Edit, Search, ExternalLink, Link as LinkIcon } from 'lucide-react';

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
  /** EUR reporting amount — `gross_eur`, what every ledger/report rollup is built on. */
  gross: number;
  /** Gross in the invoice's own currency, before FX conversion. */
  grossOriginal: number;
  currency: string;
  fxRate: number;
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
  onOpen?: (inv: Invoice) => void;
  onStatusChange?: (inv: Invoice, status: InvoiceStatus) => void;
  onMassStatusChange?: (invoices: Invoice[], status: InvoiceStatus) => void;
  onMarkPaid?: (inv: Invoice, remaining: number) => void;
  onDelete?: (inv: Invoice) => void;
  onUploadDocument?: (inv: Invoice, file: File) => void;
  onPreviewDocument?: (inv: Invoice) => void;
  onPreviewAade?: (inv: Invoice) => void;
  onOpenCounterparty?: (inv: Invoice) => void;
  onLinkToContract?: (inv: Invoice) => void;
  hideToolbar?: boolean;
  compact?: boolean;
  /** Filters the page applies before rows reach this grid, so "Clear filters" resets them too. */
  externalFilters?: ExternalFilterSource;
}

export const InvoicesGrid: React.FC<InvoicesGridProps> = ({
  invoices,
  onOpen,
  onStatusChange,
  onMassStatusChange,
  onMarkPaid,
  onDelete,
  onUploadDocument,
  onPreviewDocument,
  onPreviewAade,
  onOpenCounterparty,
  onLinkToContract,
  hideToolbar,
  compact,
  externalFilters
}) => {
  const { budgetCategories, updateInvoiceCategory } = useAuth();
  const gridFilters = useGridFilterControls(externalFilters);
  const { quickFilter, setQuickFilter } = gridFilters;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [gridApi, setGridApi] = useState<GridApi | null>(null);

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
        // An invoice can bill several agreements and projects; the cell names the primary one and
        // counts the rest, the register modal lists them all.
        linkage: (() => {
          const contractCount = invoiceContractIds(inv).length;
          const projectCount = invoiceProjectIds(inv).length;
          if (contractCount === 0) return inv.category || 'General Operating';
          const parts = [inv.contract?.product || 'Agreement'];
          if (contractCount > 1) parts.push(`+${contractCount - 1}`);
          if (projectCount > 0) parts.push(`${projectCount} project${projectCount === 1 ? '' : 's'}`);
          return parts.join(' · ');
        })(),
        linkageType: invoiceContractIds(inv).length > 0 ? 'contract' : 'category',
        referencePeriod: inv.reference_period || '',
        yearQuarter: deriveYearQuarter(inv.issue_date),
        periodRange: [inv.period_from, inv.period_to].filter(Boolean).map(d => formatDate(d as string)).join(' → '),
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
        overdue: isOverdue,
        gross: inv.gross_eur,
        grossOriginal: inv.gross,
        currency: inv.currency || DEFAULT_CURRENCY,
        fxRate: inv.fx_rate || 1,
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

  const getContextMenuItems = React.useCallback((params: GetContextMenuItemsParams): any[] => {
    const selectedRows = params.api.getSelectedRows();
    
    // Default context menu items
    const defaultItems = ['copy', 'copyWithHeaders', 'separator', 'export'];
    
    if (!selectedRows || selectedRows.length === 0) {
      return defaultItems;
    }

    const statuses: { label: string, value: InvoiceStatus }[] = [
      { label: 'Draft', value: 'draft' },
      { label: 'Registered', value: 'registered' },
      { label: 'Sent / Received', value: 'sent_received' },
      { label: 'Partially Paid', value: 'partially_paid' },
      { label: 'Paid in Full', value: 'paid' },
      { label: 'Disputed', value: 'disputed' },
      { label: 'Resolved', value: 'resolved' },
      { label: 'Cancelled', value: 'cancelled' },
    ];

    const massUpdateItem = {
      name: `Mass Update Status (${selectedRows.length} selected)`,
      subMenu: statuses.map(s => ({
        name: s.label,
        action: () => {
          onMassStatusChange?.(selectedRows.map(r => r.inv), s.value);
        }
      }))
    };

    return [massUpdateItem, 'separator', ...defaultItems];
  }, [onMassStatusChange]);

  const columnDefs = useMemo<ColDef<InvoiceRow>[]>(() => [
    {
      headerName: 'Counterparty', field: 'entity', minWidth: 210, sortable: true, ...excelSetFilter(), pinned: 'left',
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (p.data) onOpenCounterparty?.(p.data.inv); }}
          className="font-bold text-slate-900 block truncate hover:text-[#3D87D3] hover:underline text-left cursor-pointer"
          title={`Open counterparty: ${p.value || ''}`}
        >
          {p.value}
        </button>
      )
    },
    {
      headerName: 'Invoice ID', field: 'inv.id', width: 150, hide: true, sortable: true, ...excelSetFilter(),
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
      headerName: 'Invoice #', field: 'invoiceNumber', width: 140, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <span className="font-extrabold text-slate-900 text-sm font-mono">{p.value}</span>
      )
    },
    {
      headerName: 'MARK', field: 'mark', width: 140, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        p.value ? (
          <span className="text-[10px] text-emerald-600 font-mono bg-emerald-50 px-1.5 py-[1px] rounded-sm border border-emerald-100">{p.value}</span>
        ) : (
          <span className="text-[10px] text-amber-600 italic">Pending sync</span>
        )
      )
    },
    {
      headerName: 'Type', field: 'type', width: 120, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => {
        const typeLabel = p.value?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Invoice';
        return (
          <span className="font-bold text-slate-800 text-xs block">{typeLabel}</span>
        );
      }
    },
    {
      headerName: 'Impact', field: 'impact', width: 108, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <span className={`text-[10px] leading-none font-extrabold px-1.5 py-0.5 rounded border inline-block ${
          p.data?.impact === 'Debit' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
        }`}>
          {p.data?.impact}
        </span>
      )
    },
    {
      headerName: 'Linkage', field: 'linkage', width: 180, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <div>
          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded w-fit border font-bold text-[10px] leading-none h-[18px] ${p.data?.linkageType === 'contract' ? 'text-indigo-700 bg-indigo-50 border-indigo-100' : 'text-purple-700 bg-purple-50 border-purple-100'}`}>
            {p.data?.linkageType === 'contract' ? <FileText className="w-3 h-3" /> : <Tag className="w-3 h-3" />}
            <span>{p.value}</span>
          </div>
          {p.data?.referencePeriod && (
            <div className="text-[9px] leading-none text-amber-800 font-mono bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60 font-black mt-0.5 w-fit">Ref: {p.data.referencePeriod}</div>
          )}
        </div>
      )
    },
    {
      headerName: 'Quarter', field: 'yearQuarter', width: 120, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        p.value && p.value !== '—' ? (
          <span className="inline-flex items-center px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded font-bold text-[10px] leading-none font-mono">{p.value}</span>
        ) : (
          <span className="text-slate-400 text-[11px] italic">Not set</span>
        )
      )
    },
    {
      headerName: 'Ref Period', field: 'periodRange', width: 210, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        p.value ? (
          <span className="text-[11px] text-slate-600 font-mono">{p.value}</span>
        ) : (
          <span className="text-slate-400 text-[11px] italic">—</span>
        )
      )
    },
    {
      headerName: 'Category', field: 'inv.budget_category.name', width: 160, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => {
        const inv = p.data?.inv;
        if (!inv) return null;
        return (
          <select
            className={`w-full bg-transparent border-none text-xs font-medium cursor-pointer focus:ring-0 ${!inv.category_id ? 'text-amber-600 font-bold' : 'text-slate-700'}`}
            value={inv.category_id || ''}
            onClick={e => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              const val = e.target.value;
              updateInvoiceCategory(inv.id, val === '' ? null : val);
            }}
          >
            <option value="">Uncategorized</option>
            {budgetCategories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        );
      }
    },
    {
      headerName: 'Currency', field: 'currency', width: 105, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => {
        const isForeign = p.value && p.value !== DEFAULT_CURRENCY;
        return (
          <div className="leading-tight">
            <span className={`font-mono font-extrabold text-[11px] ${isForeign ? 'text-indigo-700' : 'text-slate-600'}`}>{p.value}</span>
            {isForeign && (
              <span className="block text-[9px] text-slate-500 font-mono" title="FX rate used for the EUR reporting amount">
                @ {p.data?.fxRate}
              </span>
            )}
          </div>
        );
      }
    },
    {
      headerName: 'Amount', field: 'gross', width: 145, sortable: true, filter: 'agNumberColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      cellRenderer: (p: ICellRendererParams<InvoiceRow, number>) => {
        const row = p.data;
        if (!row) return null;
        const isForeign = row.currency !== DEFAULT_CURRENCY;
        return (
          <div className="leading-tight">
            <span className="font-extrabold text-slate-900 text-xs">
              {formatMoney(isForeign ? row.grossOriginal : p.value, row.currency)}
            </span>
            {isForeign && (
              <span className="block text-[9px] text-slate-500 font-mono" title="Converted to EUR for ledger reporting">
                ≈ {formatMoney(p.value)}
              </span>
            )}
          </div>
        );
      }
    },
    {
      headerName: 'Due Date', field: 'dueDate', width: 110, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      valueFormatter: (p) => formatDate(p.value),
      cellClass: (params) => params.data?.overdue ? 'font-bold text-red-600' : ''
    },
    {
      headerName: 'Status', field: 'status', width: 150, sortable: true,
      filter: 'agSetColumnFilter', filterParams: { values: ['draft', 'registered', 'sent_received', 'partially_paid', 'paid', 'disputed', 'resolved', 'cancelled'], excelMode: 'windows' },
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
        <select
          value={p.value || ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { if (p.data) onStatusChange?.(p.data.inv, e.target.value as InvoiceStatus); }}
          className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border focus:outline-none cursor-pointer transition-all leading-tight h-[20px] ${STATUS_STYLES[p.value || ''] || 'bg-slate-50 text-slate-700 border-slate-300'}`}
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
        headerName: 'Archive', field: 'hasDoc', width: 140, sortable: true,
        ...excelSetFilter(['Yes', 'No']),
        cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
          <div className="flex items-center gap-1.5 flex-wrap">
            {p.value === 'Yes' ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); if (p.data) onPreviewDocument?.(p.data.inv); }}
                className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] leading-none px-1.5 py-1 rounded hover:bg-emerald-100 transition-colors cursor-pointer"
                title="Click to Preview or Download Document"
              >
                <Eye className="w-3 h-3 text-[#3D87D3]" />
                <span>PDF: {(p.data?.docName || '').slice(0, 12)}...</span>
              </button>
            ) : (
              <label className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px] leading-none px-1.5 py-1 rounded hover:bg-rose-100 cursor-pointer transition-colors" onClick={(e) => e.stopPropagation()}>
                <Upload className="w-3 h-3" />
                <span>Upload PDF</span>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0] && p.data) {
                      onUploadDocument?.(p.data.inv, e.target.files[0]);
                    }
                  }}
                />
              </label>
            )}
          </div>
        )
      },
      {
        headerName: 'AADE', field: 'inv.qr_url', width: 150, sortable: false, filter: false,
        cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => (
          <div className="flex items-center h-full">
            {p.data?.inv.qr_url ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); if (p.data) onPreviewAade?.(p.data.inv); }}
                className="inline-flex items-center gap-1 bg-sky-50 text-[#3D87D3] border border-sky-200 font-bold text-[10px] leading-none px-1.5 py-1 rounded hover:bg-sky-100 transition-colors cursor-pointer"
                title="View on AADE (myDATA verification page)"
              >
                <ExternalLink className="w-3 h-3" />
                <span>View on AADE</span>
              </button>
            ) : (
              <span className="text-[10px] text-slate-400 italic">—</span>
            )}
          </div>
        )
      },
      {
        headerName: 'Links', field: 'inv.links', width: 200, sortable: false, filter: false,
        cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => {
          const links = p.data?.inv?.links || [];
          if (links.length === 0) return <span className="text-[10px] text-slate-400 italic">—</span>;
          
          return (
            <div className="flex items-center gap-1.5 flex-wrap h-full py-1">
              {links.map((link, idx) => (
                <a
                  key={idx}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 text-slate-700 hover:text-[#3D87D3] hover:border-[#3D87D3] font-bold text-[10px] px-2 py-0.5 rounded transition-colors"
                  title={link.title || link.url}
                >
                  <LinkIcon className="w-3 h-3" />
                  <span className="truncate max-w-[80px]">{link.title || 'Link'}</span>
                </a>
              ))}
            </div>
          );
        }
    },
    {
      headerName: '', field: 'inv.id', width: 250, sortable: false, filter: false, pinned: 'right',
      valueGetter: (p) => p.data?.inv.id,
      cellRenderer: (p: ICellRendererParams<InvoiceRow, string>) => {
        if (!p.data) return <span />;
        const settled = p.data.status === 'paid' || p.data.status === 'cancelled';
        return (
          <div className="flex items-center justify-end gap-2">
            {!settled && onMarkPaid && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onMarkPaid(p.data!.inv, p.data!.remaining); }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[10px] leading-none px-2 py-1 rounded transition-all cursor-pointer"
                title="1-Click Fast Path Collection / Payment"
              >
                Mark Paid Today
              </button>
            )}
            {onLinkToContract && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onLinkToContract(p.data!.inv); }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[10px] leading-none px-2 py-1 rounded transition-all cursor-pointer"
                title="Link this invoice to a contract"
              >
                Link to Contract
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (p.data) onOpen?.(p.data.inv); }}
              className="p-1.5 h-8 w-8 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-200 transition-colors cursor-pointer"
              title="Edit Invoice Details"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (p.data) onDelete?.(p.data.inv); }}
              className="p-1.5 h-8 w-8 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
              title="Delete Invoice Record"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      }
    }
  ], [copiedId, onOpen, onStatusChange, onMarkPaid, onDelete, onUploadDocument, onPreviewDocument, onPreviewAade, onOpenCounterparty, onLinkToContract, updateInvoiceCategory, budgetCategories]);

  return (
    <div className="flex flex-col w-full bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {!hideToolbar && (
        <div className="px-4 py-2 border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 w-full max-w-2xl">
            <div className="relative w-full max-w-sm">
              <Search className="w-3.5 h-3.5 text-[var(--ink-4)] absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search invoices"
                value={quickFilter}
                onChange={e => setQuickFilter(e.target.value)}
                className="w-full h-8 bg-white border border-[var(--line-strong)] rounded-[var(--radius-control)] pl-8 pr-2.5 text-[12px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--ink-4)]"
              />
            </div>
            <ClearFiltersButton controls={gridFilters} />
            {HAS_AG_GRID_LICENSE && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => gridApi?.expandAll()}
                  className="h-8 px-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-white text-[12px] font-medium text-[var(--ink-2)] hover:border-[var(--line-strong)] transition-colors cursor-pointer whitespace-nowrap"
                >
                  Expand all
                </button>
                <button
                  onClick={() => gridApi?.collapseAll()}
                  className="h-8 px-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-white text-[12px] font-medium text-[var(--ink-2)] hover:border-[var(--line-strong)] transition-colors cursor-pointer whitespace-nowrap"
                >
                  Collapse all
                </button>
              </div>
            )}
          </div>
          <span className="ui-meta shrink-0 hidden sm:block">
            {invoices.length} invoices. Double-click a row to open it.
          </span>
        </div>
      )}
      <div className={compact ? "h-[calc(100vh-280px)] min-h-[400px]" : "h-[calc(100vh-220px)] min-h-[600px]"}>
        <AgGridReact<InvoiceRow>
          onGridReady={params => { setGridApi(params.api); gridFilters.gridProps.onGridReady(params); }}
          onFilterChanged={gridFilters.gridProps.onFilterChanged}
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: false, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
          quickFilterText={quickFilter}
          rowHeight={36}
          headerHeight={32}
          overlayNoRowsTemplate={'<span class="orbit-empty"><strong>No invoices match these filters</strong>Clear the filters, or register an invoice.</span>'}
          {...GROUPING_OPTIONS}
          groupDisplayType="groupRows"
          rowSelection={{ mode: 'multiRow' }}
          getContextMenuItems={getContextMenuItems}
          onRowDoubleClicked={e => { if (e.data) onOpen?.(e.data.inv); }}
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
