"use client";

import React, { useMemo } from 'react';
import Link from 'next/link';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { useOrbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { Badge } from '@/components/ui/primitives';
import { formatDate } from '@/lib/date';
import { AlertCircle, Clock, CheckCircle, Zap, FileCheck, EyeOff } from 'lucide-react';

export interface BillingActionItem {
  contractId: string;
  periodKey: string;
  counterpartyName: string;
  reference: string;
  direction: 'revenue' | 'cost';
  cadence: string;
  timing: string;
  periodLabel: string;
  /** Service window the invoice covers. */
  periodFrom?: string;
  periodTo?: string;
  /** Date the invoice is raised: service start in advance, service end in arrears. */
  billingDate?: string;
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
  serviceWindow: string;
  billingDate: string;
  billingDateLabel: string;
  expectedAmount: number;
  status: string;
}

interface BillingActionGridProps {
  items: BillingActionItem[];
  onQuickCreate: (item: BillingActionItem) => void;
  /** Hides a suggestion from the queue. Omit it to render the grid read-only (e.g. dismissed view). */
  onDismiss?: (item: BillingActionItem) => void;
}

const timingLabel = (timing: string) => {
  if (timing === 'end_of_period') return 'In arrears';
  if (timing === 'upon_milestone') return 'On milestone';
  return 'In advance';
};

const formatDay = (value?: string) => (value ? formatDate(value) : '—');

export const BillingActionGrid: React.FC<BillingActionGridProps> = ({ items, onQuickCreate, onDismiss }) => {
  const gridTheme = useOrbitGridTheme();
  const rowData = useMemo<BillingActionRow[]>(() => {
    return items.map(item => ({
      item,
      counterparty: item.counterpartyName,
      reference: item.reference,
      direction: item.direction,
      cadence: item.cadence,
      timingLabel: timingLabel(item.timing),
      serviceWindow: item.periodFrom && item.periodTo
        ? `${formatDay(item.periodFrom)} to ${formatDay(item.periodTo)}`
        : item.periodLabel,
      billingDate: item.billingDate || item.periodFrom || '',
      billingDateLabel: formatDay(item.billingDate || item.periodFrom),
      expectedAmount: item.expectedAmount,
      status: item.status
    }));
  }, [items]);

  const columnDefs = useMemo<ColDef<BillingActionRow>[]>(() => [
    {
      headerName: 'Counterparty', field: 'counterparty', minWidth: 230, sortable: true, ...excelSetFilter(), pinned: 'left',
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => (
        <div className="leading-tight">
          <Link href={`/contracts/${p.data?.item.contractId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-[var(--ink)] hover:text-[var(--accent-ink)] hover:underline block truncate">
            {p.value}
          </Link>
          <span className="ui-num text-[11px] text-[var(--ink-4)]">{p.data?.reference}</span>
        </div>
      )
    },
    {
      headerName: 'Direction', field: 'direction', width: 132, sortable: true, ...excelSetFilter(['revenue', 'cost']),
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => (
        <Badge variant={p.value === 'revenue' ? 'success' : 'warning'}>
          {p.value === 'revenue' ? 'Revenue' : 'Spend'}
        </Badge>
      )
    },
    {
      headerName: 'Cadence', field: 'cadence', width: 126, sortable: true, ...excelSetFilter(),
      cellClass: 'capitalize'
    },
    {
      headerName: 'Timing and service window', field: 'timingLabel', minWidth: 220, flex: 1, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => (
        <div className="leading-tight">
          <span className="text-[var(--ink-2)]">{p.value}</span>
          <span className="ui-num block text-[11px] text-[var(--ink-4)]">{p.data?.serviceWindow}</span>
        </div>
      )
    },
    {
      headerName: 'Billing date', field: 'billingDate', minWidth: 150, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => (
        <div className="leading-tight">
          <span className="ui-num text-[var(--ink)]">{p.data?.billingDateLabel}</span>
          <span className="ui-meta block text-[11px]">
            {p.data?.item.timing === 'end_of_period' ? 'at period end' : 'at period start'}
          </span>
        </div>
      )
    },
    {
      headerName: 'Expected', field: 'expectedAmount', width: 150, sortable: true, filter: 'agNumberColumnFilter',
      cellStyle: { textAlign: 'right' },
      cellClass: 'ui-num font-medium text-[var(--ink)]',
      valueFormatter: (p) => `€${Number(p.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    },
    {
      headerName: 'Billing Status', field: 'status', width: 140, sortable: true, ...excelSetFilter(['unbilled', 'draft_created', 'invoiced', 'billed']),
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => {
        if (p.value === 'unbilled') {
          return (
            <span className="inline-flex items-center text-[11px] font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
              <AlertCircle className="w-3 h-3 mr-1" /> Unbilled
            </span>
          );
        }
        if (p.value === 'draft_created') {
          return (
            <span className="inline-flex items-center text-[11px] font-medium text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
              <Clock className="w-3 h-3 mr-1" /> Draft created
            </span>
          );
        }
        return (
          <span className="inline-flex items-center text-[11px] font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
            <CheckCircle className="w-3 h-3 mr-1" /> Invoiced
          </span>
        );
      }
    },
    {
      headerName: 'Action', field: 'status', width: 236, sortable: false, filter: false, pinned: 'right',
      cellRenderer: (p: ICellRendererParams<BillingActionRow, string>) => (
        <div className="flex items-center justify-end gap-1.5">
          {p.value === 'unbilled' ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (p.data) onQuickCreate(p.data.item); }}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[var(--radius-control)] border border-[var(--accent)] bg-white text-[var(--accent-ink)] hover:bg-[var(--accent-soft)] text-[12px] font-medium transition-colors cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 shrink-0" />
              <span>Create draft</span>
            </button>
          ) : (
            <Link
              href="/invoices"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[var(--radius-control)] border border-[var(--line)] bg-white text-[var(--ink-2)] hover:border-[var(--line-strong)] text-[12px] font-medium transition-colors"
            >
              <FileCheck className="w-3.5 h-3.5" />
              <span>Open in ledger</span>
            </Link>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (p.data) onDismiss(p.data.item); }}
              title="Discard this suggestion (it stays unbilled, the reminder just stops)"
              className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-control)] text-[12px] font-medium text-[var(--ink-4)] hover:text-[var(--ink-2)] hover:bg-[var(--surface-muted)] transition-colors cursor-pointer"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Discard</span>
            </button>
          )}
        </div>
      )
    }
  ], [onQuickCreate, onDismiss]);

  // Fills whatever height the host gives it (see the page's viewport-sized wrapper) — no inner clamps,
  // and no second search box: the Action Center toolbar above already filters/sorts this queue.
  // The pivot/columns side panel and the row-group drop bar are switched off here: on a billing queue
  // they cost ~230px of width plus 36px of height and push the Action column behind a scrollbar.
  return (
    <div className="h-full w-full min-h-0">
      <AgGridReact<BillingActionRow>
        theme={gridTheme}
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, filter: true, floatingFilter: false, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
        rowHeight={40}
        headerHeight={32}
        {...GROUPING_OPTIONS}
        sideBar={false}
        rowGroupPanelShow="never"
        pagination={true}
        paginationPageSize={50}
        paginationPageSizeSelector={[10, 25, 50, 100]}
      />
    </div>
  );
};
