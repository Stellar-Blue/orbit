"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import { Contract, CatalogModule, CatalogItem } from '@/lib/types';
import { calculateContractValuation, getContractNoticeStatus } from '@/lib/pricing-engine';
import { Badge } from '@/components/ui/primitives';
import { Copy, Check, Trash2, Search } from 'lucide-react';

// Full AG Grid Enterprise license (set in .env.local as NEXT_PUBLIC_AG_GRID_LICENSE_KEY).
// Without a key the grid falls back to community features (sorting/filtering still work).
const AG_GRID_LICENSE_KEY = process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY?.trim() || '';

if (AG_GRID_LICENSE_KEY) {
  ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);
  LicenseManager.setLicenseKey(AG_GRID_LICENSE_KEY);
} else {
  ModuleRegistry.registerModules([AllCommunityModule]);
}

const gridTheme = themeQuartz.withParams({
  backgroundColor: '#ffffff',
  foregroundColor: '#1e293b',
  headerBackgroundColor: '#f8fafc',
  headerTextColor: '#64748b',
  borderColor: '#e2e8f0',
  accentColor: '#3D87D3',
  oddRowBackgroundColor: '#fafbfc',
  rowHoverColor: '#f1f5f9',
  fontSize: 12,
  headerFontSize: 11,
  fontFamily: 'inherit',
  wrapperBorderRadius: 0
});

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  draft: 'neutral',
  in_negotiation: 'info',
  active: 'success',
  expiring: 'warning',
  expired: 'error',
  terminated: 'neutral'
};

// Excel-style filters (checkbox set filters with search / Select All / Blanks) are an
// AG Grid Enterprise feature: they activate with the license key, and fall back to
// text filters while the key is missing.
const HAS_AG_GRID_LICENSE = !!AG_GRID_LICENSE_KEY;

const excelSetFilter = (values?: string[]): Pick<ColDef, 'filter' | 'filterParams'> =>
  HAS_AG_GRID_LICENSE
    ? { filter: 'agSetColumnFilter', filterParams: { values, excelMode: 'windows' } }
    : { filter: 'agTextColumnFilter', filterParams: undefined };

const eurFormatter = (value: number) =>
  value == null || isNaN(value) ? '' : `€${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

interface ContractRow {
  contract: Contract;
  counterparty: string;
  reference: string;
  uuid: string;
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
  onSelect: (contract: Contract) => void;
  onDelete: (contract: Contract) => void;
}

export const ContractsGrid: React.FC<ContractsGridProps> = ({
  contracts,
  catalogModules,
  catalogItems,
  isAdmin,
  onSelect,
  onDelete
}) => {
  const [quickFilter, setQuickFilter] = useState('');
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
        reference: c.reference,
        uuid: c.id,
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
        filter: 'agTextColumnFilter', pinned: 'left',
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <div>
            <div className="font-bold text-slate-800">{p.value}</div>
            <div className="text-[10px] text-[#3D87D3] font-mono">{p.data?.reference}</div>
          </div>
        )
      },
      {
        headerName: 'Contract UUID', field: 'uuid', width: 130, sortable: true, filter: 'agTextColumnFilter',
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <button
            type="button"
            onClick={(e) => copyUuid(p.value || '', e)}
            className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-[#3D87D3] border border-slate-200 rounded font-mono text-[10px] transition-colors cursor-pointer"
            title="Click to copy Contract UUID"
          >
            <span>{(p.value || '').slice(0, 8)}...{(p.value || '').slice(-4)}</span>
            {copiedId === p.value ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-slate-400" />}
          </button>
        )
      },
      {
        headerName: 'Direction', field: 'direction', width: 105, sortable: true,
        ...excelSetFilter(['revenue', 'cost']),
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <Badge variant={p.value === 'revenue' ? 'success' : 'warning'} className="text-[10px]">{String(p.value).toUpperCase()}</Badge>
        )
      },
      { headerName: 'Product', field: 'product', width: 170, sortable: true, ...excelSetFilter() },
      {
        headerName: 'Status', field: 'status', width: 120, sortable: true,
        ...excelSetFilter(['draft', 'in_negotiation', 'active', 'expiring', 'expired', 'terminated']),
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <Badge variant={STATUS_VARIANT[p.value || ''] || 'neutral'} className="text-[10px]">{String(p.value || '').toUpperCase().replace('_', ' ')}</Badge>
        )
      },
      { headerName: 'Owner', field: 'owner', width: 130, sortable: true, ...excelSetFilter() },
      {
        headerName: 'Start', field: 'startsOn', width: 100, sortable: true,
        filter: 'agDateColumnFilter', filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
        valueFormatter: (p) => p.value
      },
      {
        headerName: 'End', field: 'endsOn', width: 100, sortable: true,
        filter: 'agDateColumnFilter', filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
        valueFormatter: (p) => p.value
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
        headerName: 'ARR (€/yr)', field: 'arr', width: 130, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
        cellClass: 'font-mono font-bold text-emerald-700',
        valueFormatter: (p) => eurFormatter(p.value)
      },
      {
        headerName: 'One-Off', field: 'oneOff', width: 110, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
        cellClass: 'font-mono text-amber-600',
        valueFormatter: (p) => (p.value > 0 ? eurFormatter(p.value) : '')
      },
      {
        headerName: 'TCV', field: 'tcv', width: 140, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
        cellClass: 'font-mono font-bold text-slate-800',
        valueFormatter: (p) => eurFormatter(p.value)
      },
      {
        headerName: 'Tier', field: 'tier', width: 210, sortable: true, ...excelSetFilter(),
        cellRenderer: (p: ICellRendererParams<ContractRow, string>) => (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-block ${p.data?.tierClass || ''}`}>{p.value}</span>
        )
      },
      {
        headerName: 'Notice', field: 'noticeDeadline', width: 115, sortable: true, filter: 'agTextColumnFilter',
        cellClass: (params) => params.data?.isUrgent ? 'font-bold text-rose-600' : 'text-slate-600',
        valueFormatter: (p) => p.value
      },
      {
        headerName: 'Notice Days', field: 'noticeDays', width: 105, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
        valueFormatter: (p) => `${p.value}d`
      },
      { headerName: 'Signed On', field: 'signedOn', width: 100, sortable: true, filter: 'agTextColumnFilter' }
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
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {contracts.length} contracts · click a row to open the dossier · right-click column headers for sort/filter menu
        </span>
      </div>
      <div className="ag-theme-quartz h-[560px]">
        <AgGridReact<ContractRow>
          theme={gridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80 }}
          quickFilterText={quickFilter}
          rowHeight={52}
          headerHeight={36}
          onRowClicked={e => { if (e.data) onSelect(e.data.contract); }}
          rowClassRules={{
            'contract-row-urgent': (params) => !!params.data?.isUrgent
          }}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
          animateRows={true}
        />
      </div>
      <style jsx global>{`
        .contract-row-urgent {
          background-color: #fff1f2 !important;
        }
        .contract-row-urgent:hover {
          background-color: #ffe4e6 !important;
        }
      `}</style>
    </div>
  );
};
