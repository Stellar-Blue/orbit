"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { useOrbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { useGridFilterControls, ClearFiltersButton, type ExternalFilterSource } from '@/components/ui/grid-filter-controls';
import { formatDate } from '@/lib/date';
import { Contract, CatalogModule, CatalogItem } from '@/lib/types';
import { calculateContractValuation, getContractNoticeStatus } from '@/lib/pricing-engine';
import { contractEndCustomerName, isSubcontract, primeFeePct } from '@/lib/subcontracts';
import { Badge } from '@/components/ui/primitives';
import { Copy, Check, Trash2, Search } from 'lucide-react';


const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  draft: 'neutral',
  in_negotiation: 'info',
  active: 'success',
  expiring: 'warning',
  expired: 'error',
  terminated: 'neutral'
};

interface ContractRow {
  contract: Contract;
  counterparty: string;
  cpTierLabel: string;
  cpTierColor: string;
  reference: string;
  uuid: string;
  /** Prime / Subcontract / Intercompany — the "Supply" column. */
  supply: string;
  /** End customer the work serves (blank for direct deals). */
  endCustomer: string;
  /** Share of the billed amount the prime contractor retains. */
  primeFee: number;
  direction: string;
  product: string;
  status: string;
  owner: string;
  startsOn: string;
  endsOn: string;
  autoRenews: string;
  renewalTerm: string;
  billingCadence: string;
  invoiceTiming: string;
  paymentTerms: string;
  vat: string;
  currency: string;
  termYears: number;
  discount: number;
  noticeDays: number;
  noticeDeadline: string;
  isUrgent: boolean;
  arr: number;
  oneOff: number;
  tcv: number;
  tier: string;
  tierClass: string;
  signedOn: string;
}

interface ContractsGridProps {
  contracts: Contract[];
  catalogModules: CatalogModule[];
  catalogItems: CatalogItem[];
  isAdmin: boolean;
  /** Filters the page applies before rows reach this grid, so "Clear filters" resets them too. */
  externalFilters?: ExternalFilterSource;
  onSelect: (contract: Contract) => void;
  onDelete: (contract: Contract) => void;
  onOpenCounterparty: (contract: Contract) => void;
}

export const ContractsGrid: React.FC<ContractsGridProps> = ({
  contracts,
  catalogModules,
  catalogItems,
  isAdmin,
  externalFilters,
  onSelect,
  onDelete,
  onOpenCounterparty
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

  const rowData = useMemo<ContractRow[]>(() => {
    return contracts.map(c => {
      const val = calculateContractValuation(
        c.lines || [], c.discount_pct || 0, c.term_years || 1,
        c.service_start_date || c.starts_on, catalogModules, catalogItems,
        c.value || 0, c.billing_cadence
      );
      const notice = getContractNoticeStatus(c);
      return {
        contract: c,
        counterparty: c.counterparty?.legal_name || '—',
        cpTierLabel: c.counterparty?.tier?.label || 'Unrated',
        cpTierColor: c.counterparty?.tier?.color || '#94a3b8',
        reference: c.reference,
        uuid: c.id,
        supply: isSubcontract(c) ? (c.supply_role === 'intercompany' ? 'Intercompany' : 'Subcontract') : 'Prime',
        endCustomer: isSubcontract(c) ? contractEndCustomerName(c) : '',
        primeFee: primeFeePct(c),
        direction: c.direction,
        product: c.product || c.type || '—',
        status: c.status,
        owner: c.owner_profile ? `${c.owner_profile.first_name} ${c.owner_profile.last_name}` : '—',
        startsOn: c.starts_on || '',
        endsOn: c.ends_on || 'Indefinite',
        autoRenews: c.auto_renews ? 'Yes' : 'No',
        renewalTerm: c.renewal_term_months ? `${c.renewal_term_months} mo` : '—',
        billingCadence: c.billing_cadence?.replace('_', ' ') || '—',
        invoiceTiming: c.invoice_timing?.replace('_', ' ') || '—',
        paymentTerms: c.payment_terms_days ? `${c.payment_terms_days}d` : '—',
        vat: c.vat_treatment?.replace(/_/g, ' ').toUpperCase() || '—',
        currency: c.currency || 'EUR',
        termYears: c.term_years || 1,
        discount: c.discount_pct || 0,
        noticeDays: c.notice_period_days || 30,
        noticeDeadline: notice.noticeDeadlineStr,
        isUrgent: notice.isUrgent,
        arr: val.netARR,
        oneOff: val.oneTimeValue,
        tcv: val.totalContractValue,
        tier: val.tierInfo.label,
        tierClass: val.tierInfo.badgeClass,
        signedOn: c.signed_on || '—'
      };
    });
  }, [contracts, catalogModules, catalogItems]);

  const columnDefs = useMemo<ColDef<ContractRow>[]>(() => {
    const defs: ColDef<ContractRow>[] = [
      {
        headerName: 'Counterparty', field: 'counterparty', minWidth: 190, sortable: true,
        ...excelSetFilter(), pinned: 'left',
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (p.data) onOpenCounterparty(p.data.contract); }}
            className="font-medium text-[var(--ink)] block truncate hover:text-[var(--accent-ink)] hover:underline text-left cursor-pointer"
            title={`Open counterparty: ${p.value || ''}`}
          >
            {p.value}
          </button>
        )
      },
      {
        headerName: 'Contract Title', field: 'reference', minWidth: 170, sortable: true,
        ...excelSetFilter(), pinned: 'left',
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <span className="ui-num font-medium text-[var(--accent-ink)]">{p.value}</span>
        )
      },
      {
        headerName: 'Supply', field: 'supply', width: 190, sortable: true,
        ...excelSetFilter(['Prime', 'Subcontract', 'Intercompany']),
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => {
          if (!p.data || p.value === 'Prime') {
            return <span className="ui-meta">Prime</span>;
          }
          // The counterparty column already names the payer, so the width goes to the end customer.
          return (
            <span
              className="flex items-center gap-1 min-w-0"
              title={`${p.value} · billed by ${p.data.counterparty}${p.data.endCustomer ? ` · for ${p.data.endCustomer}` : ' · end customer not set'}`}
            >
              <Badge variant={p.value === 'Intercompany' ? 'info' : 'warning'}>
                {p.value === 'Intercompany' ? 'INT' : 'SUB'}
              </Badge>
              <span className="text-[11px] font-semibold text-[var(--ink-2)] truncate">
                {p.data.endCustomer || 'no end customer'}
              </span>
            </span>
          );
        }
      },
      {
        headerName: 'Prime Fee', field: 'primeFee', width: 104, sortable: true, filter: 'agNumberColumnFilter',
        valueFormatter: (p) => (Number(p.value) > 0 ? `${Number(p.value).toFixed(2)}%` : '—'),
        cellRenderer: (p: ICellRendererParams<ContractRow, number>) => (
          Number(p.value) > 0
            ? <span className="ui-num text-[12px] font-semibold text-rose-700">{Number(p.value).toFixed(2)}%</span>
            : <span className="ui-meta">—</span>
        )
      },
      {
        headerName: 'Contract ID', field: 'uuid', width: 150, hide: true, sortable: true, ...excelSetFilter(),
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <button
            type="button"
            onClick={(e) => copyUuid(p.value || '', e)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white hover:bg-[var(--accent-soft)] text-[var(--ink-3)] hover:text-[var(--accent-ink)] border border-[var(--line)] rounded ui-num text-[10px] leading-none transition-colors cursor-pointer"
            title="Click to copy Contract UUID"
          >
            <span>{(p.value || '').slice(0, 8)}...{(p.value || '').slice(-4)}</span>
            {copiedId === p.value ? <Check className="w-2.5 h-2.5 text-emerald-600" /> : <Copy className="w-2.5 h-2.5 text-slate-400" />}
          </button>
        )
      },
      {
        headerName: 'Direction', field: 'direction', width: 142, sortable: true,
        ...excelSetFilter(['revenue', 'cost']),
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <Badge variant={p.value === 'revenue' ? 'success' : 'warning'}>{p.value === 'revenue' ? 'Revenue' : 'Cost'}</Badge>
        )
      },
      { headerName: 'Product', field: 'product', width: 170, sortable: true, ...excelSetFilter() },
      {
        headerName: 'Status', field: 'status', width: 128, sortable: true,
        ...excelSetFilter(['draft', 'in_negotiation', 'active', 'expiring', 'expired', 'terminated']),
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <Badge variant={STATUS_VARIANT[p.value || ''] || 'neutral'}>{String(p.value || '').replace('_', ' ')}</Badge>
        )
      },
      {
        headerName: 'Tier', field: 'cpTierLabel', width: 116, sortable: true, ...excelSetFilter(),
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <span className="inline-flex items-center px-1.5 rounded text-[11px] font-medium border leading-none h-5"
            style={{ color: p.data?.cpTierColor || '#94a3b8', borderColor: `${p.data?.cpTierColor || '#94a3b8'}55`, backgroundColor: `${p.data?.cpTierColor || '#94a3b8'}14` }}>
            {p.value}
          </span>
        )
      },
      { headerName: 'Owner', field: 'owner', width: 130, sortable: true, ...excelSetFilter() },
      {
        headerName: 'Start', field: 'startsOn', width: 118, sortable: true,
        filter: 'agDateColumnFilter', filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
        valueFormatter: (p) => formatDate(p.value)
      },
      {
        headerName: 'End', field: 'endsOn', width: 118, sortable: true,
        filter: 'agDateColumnFilter', filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
        valueFormatter: (p) => formatDate(p.value)
      },
      { headerName: 'Auto Renew', field: 'autoRenews', width: 100, sortable: true, ...excelSetFilter(['Yes', 'No']) },
      { headerName: 'Renew Term', field: 'renewalTerm', width: 100, sortable: true, ...excelSetFilter() },
      { headerName: 'Cadence', field: 'billingCadence', width: 110, sortable: true, ...excelSetFilter() },
      { headerName: 'Invoice Timing', field: 'invoiceTiming', width: 130, sortable: true, ...excelSetFilter() },
      { headerName: 'Pay Terms', field: 'paymentTerms', width: 95, sortable: true, ...excelSetFilter() },
      { headerName: 'VAT', field: 'vat', width: 150, sortable: true, ...excelSetFilter() },
      { headerName: 'Currency', field: 'currency', width: 90, sortable: true, ...excelSetFilter() },
      { headerName: 'Term (Yrs)', field: 'termYears', width: 100, sortable: true, filter: 'agNumberColumnFilter' },
      { headerName: 'Discount %', field: 'discount', width: 100, sortable: true, filter: 'agNumberColumnFilter' },
      {
        headerName: 'Commercials & Tier', field: 'tcv', width: 250, sortable: true, filter: 'agNumberColumnFilter',
        tooltipField: 'tier',
        cellRenderer: (p: ICellRendererParams<ContractRow, number>) => (
          <div className="space-y-0.5 py-0">
            <div className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 space-y-0 text-[10px]">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-500 uppercase leading-none">ARR</span>
                <span className="font-mono font-black text-emerald-700 leading-none">
                  €{(p.data?.arr || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr
                </span>
              </div>
              {(p.data?.oneOff || 0) > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium leading-none">One-off:</span>
                  <span className="font-mono font-bold text-amber-600 leading-none">+€{(p.data?.oneOff || 0).toLocaleString()}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-200/80 mt-0.5 pt-0.5">
                <span className="font-extrabold text-slate-700 leading-none">TCV:</span>
                <span className="font-mono font-extrabold text-slate-900 leading-none">€{(p.data?.tcv || 0).toLocaleString()}</span>
              </div>
            </div>
            <div>
              <span className={`px-1.5 py-0 rounded text-[9px] leading-none font-bold border inline-flex items-center h-[14px] ${p.data?.tierClass || ''}`}>
                {p.data?.tier || '—'}
              </span>
            </div>
          </div>
        )
      },
      {
        headerName: 'Notice', field: 'noticeDeadline', width: 115, sortable: true, ...excelSetFilter(),
        cellClass: (params) => params.data?.isUrgent ? 'font-bold text-rose-600' : 'text-slate-600',
        valueFormatter: (p) => p.value
      },
      {
        headerName: 'Notice Days', field: 'noticeDays', width: 105, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
        valueFormatter: (p) => `${p.value}d`
      },
      { headerName: 'Signed On', field: 'signedOn', width: 100, sortable: true, ...excelSetFilter() }
    ];

    if (isAdmin) {
      defs.push({
        headerName: '', field: 'uuid', width: 70, sortable: false, filter: false, pinned: 'right',
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (p.data) onDelete(p.data.contract); }}
            className="text-slate-400 hover:text-rose-600 transition-colors p-1 rounded hover:bg-rose-50 cursor-pointer"
            title="Delete Contract"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )
      });
    }
    return defs;
  }, [isAdmin, copiedId, onDelete]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Quick filter across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] placeholder:text-slate-400"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ClearFiltersButton controls={gridFilters} />
          <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
            {contracts.length} contracts · double-click a row to open the dossier · right-click column headers for sort/filter menu
          </span>
        </div>
      </div>
      <div className="ag-theme-quartz h-[560px]">
        <AgGridReact<ContractRow>
          theme={gridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: false, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
          {...gridFilters.gridProps}
          quickFilterText={quickFilter}
          rowHeight={36}
          headerHeight={32}
          {...GROUPING_OPTIONS}
          onRowDoubleClicked={e => { if (e.data) onSelect(e.data.contract); }}
          rowClassRules={{
            'contract-row-urgent': (params) => !!params.data?.isUrgent
          }}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
          animateRows={true}
          overlayNoRowsTemplate={'<span class="orbit-empty"><strong>No contracts match these filters</strong>Clear the filters, or register a new agreement.</span>'}
        />
      </div>
      <style jsx global>{`
        .contract-row-urgent {
          background-color: color-mix(in srgb, var(--danger-soft) 60%, var(--surface)) !important;
        }
        .contract-row-urgent:hover {
          background-color: color-mix(in srgb, var(--danger-soft) 85%, var(--surface)) !important;
        }
      `}</style>
    </div>
  );
};
