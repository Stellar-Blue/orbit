"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { Counterparty, Contract, CatalogModule, CatalogItem, Role } from '@/lib/types';
import { Badge } from '@/components/ui/primitives';
import { Copy, Check, MapPin, ShieldCheck, RefreshCw, ExternalLink, Unlink, Trash2, Search, Pin } from 'lucide-react';

interface CpRow {
  cp: Counterparty;
  name: string;
  sub: string;
  internal: boolean;
  country: string;
  vat: string;
  vatValid: boolean;
  roles: Role[];
  activeCount: number;
  arr: number;
  attioLinked: boolean;
  attioId: string;
  tierLabel: string;
}

interface CounterpartiesGridProps {
  counterparties: Counterparty[];
  isAdmin: boolean;
  onOpen: (cp: Counterparty) => void;
  onDelete: (cp: Counterparty) => void;
  getContractCount: (cpId: string) => number;
  getContractArr: (cpId: string) => number;
}

const roleBadge = (roles: Role[]) => {
  if (!roles || roles.length === 0) return <Badge variant="neutral">NO ROLES</Badge>;
  return (
    <div className="flex gap-1 flex-wrap">
      {roles.map(r => {
        if (r.slug === 'client') return <Badge key={r.id} variant="success">CLIENT</Badge>;
        if (r.slug === 'supplier') return <Badge key={r.id} variant="warning">SUPPLIER</Badge>;
        return <Badge key={r.id} variant="info" className="uppercase">{r.name}</Badge>;
      })}
    </div>
  );
};

export const CounterpartiesGrid: React.FC<CounterpartiesGridProps> = ({
  counterparties,
  isAdmin,
  onOpen,
  onDelete,
  getContractCount,
  getContractArr
}) => {
  const [quickFilter, setQuickFilter] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyUuid = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const rowData = useMemo<CpRow[]>(() => {
    return counterparties.map(cp => {
      return {
        cp,
        name: cp.legal_name,
        sub: cp.trade_name && cp.trade_name !== cp.legal_name ? `Trade: ${cp.trade_name}` : (cp.website_domain || 'No domain registered'),
        internal: !!cp.is_internal,
        country: cp.country || '—',
        vat: cp.vat_number || cp.afm || '',
        vatValid: !!cp.vat_valid,
        roles: cp.roles || [],
        activeCount: getContractCount(cp.id),
        arr: getContractArr(cp.id),
        attioLinked: cp.attio_link?.link_status === 'linked',
        attioId: cp.attio_link?.attio_record_id || cp.id,
        tierLabel: cp.tier?.label || 'Unrated'
      };
    });
  }, [counterparties, getContractCount, getContractArr]);

  const columnDefs = useMemo<ColDef<CpRow>[]>(() => [
    {
      headerName: 'Legal / Trade Name', field: 'name', minWidth: 240, sortable: true, ...excelSetFilter(), pinned: 'left',
      cellRenderer: (p: ICellRendererParams<CpRow, string>) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-[#3D87D3] font-bold text-xs shrink-0">
            {(p.value || '').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-800 flex items-center gap-1.5">
              {p.value}
              {p.data?.internal && <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">INTERNAL JV</span>}
            </div>
            <div className="text-xs text-slate-500 truncate">{p.data?.sub}</div>
          </div>
        </div>
      )
    },
    {
      headerName: 'Entity UUID', field: 'cp.id', width: 135, sortable: true, ...excelSetFilter(),
      valueGetter: (p) => p.data?.cp.id,
      cellRenderer: (p: ICellRendererParams<CpRow, string>) => (
        <button
          type="button"
          onClick={(e) => copyUuid(p.value || '', e)}
          className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-[#3D87D3] border border-slate-200 rounded font-mono text-[10px] transition-colors cursor-pointer"
          title="Click to copy full UUID"
        >
          <span>{(p.value || '').slice(0, 8)}...{(p.value || '').slice(-4)}</span>
          {copiedId === p.value ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-slate-400" />}
        </button>
      )
    },
    {
      headerName: 'Jurisdiction', field: 'country', width: 120, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<CpRow, string>) => (
        <span className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded text-xs text-slate-700">
          <MapPin className="w-3 h-3 text-slate-500" />
          {p.value}
        </span>
      )
    },
    {
      headerName: 'VAT (ΑΦΜ) / VIES', field: 'vat', width: 170, sortable: true, ...excelSetFilter(),
      cellClass: 'font-mono text-xs text-slate-800',
      cellRenderer: (p: ICellRendererParams<CpRow, string>) => (
        p.value ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold bg-slate-100/80 px-2.5 py-1 rounded-md border border-slate-200">
            <span>{p.value}</span>
            {p.data?.vatValid && <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />}
          </span>
        ) : (
          <span className="text-xs text-slate-400 font-mono">Unregistered</span>
        )
      )
    },
    {
      headerName: 'Roles', field: 'roles', width: 180, sortable: true,
      valueGetter: (p) => p.data?.roles.map(r => r.name).join(', '),
      filter: 'agTextColumnFilter',
      cellRenderer: (p: ICellRendererParams<CpRow, string>) => roleBadge(p.data?.roles || [])
    },
    {
      headerName: 'Active Agreements & ARR', field: 'arr', width: 160, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellRenderer: (p: ICellRendererParams<CpRow, number>) => (
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-slate-800">{p.data?.activeCount} active agreements</span>
          {(p.value || 0) > 0 ? (
            <span className="text-xs font-bold text-emerald-600 font-mono">€{(p.value || 0).toLocaleString()}/yr ARR</span>
          ) : (
            <span className="text-[11px] text-slate-400 font-mono">No active revenue</span>
          )}
        </div>
      )
    },
    {
      headerName: 'Client Tier', field: 'tierLabel', width: 200, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<CpRow, string>) => {
        const tier = p.data?.cp.tier;
        if (!tier) return <span className="text-slate-400 text-xs">—</span>;
        return (
          <div className="space-y-1" title={tier.overridden ? `Pinned: ${tier.override_reason || 'Override'}` : undefined}>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border"
              style={{ color: tier.color, borderColor: `${tier.color}55`, backgroundColor: `${tier.color}14` }}>
              {tier.overridden && <Pin className="w-2.5 h-2.5 shrink-0" />}
              {tier.label}
            </span>
            <div className="text-[10px] text-slate-500 font-mono">
              {tier.score !== null ? `Score ${tier.score}/100` : 'Unrated'} {tier.overridden && `· computed ${tier.tier_index === null ? 'Unrated' : `Tier ${tier.tier_index + 1}`}`}
            </div>
          </div>
        );
      }
    },
    {
      headerName: 'Attio CRM', field: 'attioLinked', width: 140, sortable: true,
      filter: 'agSetColumnFilter', filterParams: { values: [true, false], excelMode: 'windows' },
      cellRenderer: (p: ICellRendererParams<CpRow, boolean>) => (
        p.value ? (
          <a
            href={`https://app.attio.com/stellar-blue/company/${p.data?.attioId || ''}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-extrabold bg-gradient-to-r from-blue-50 via-cyan-50 to-indigo-50 hover:from-blue-100 hover:to-cyan-100 text-blue-700 hover:text-blue-900 border border-blue-200/80 rounded-full transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
            <span>Attio Linked</span>
            <ExternalLink className="w-3.5 h-3.5 ml-0.5 text-blue-500" />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200 rounded-full">
            <Unlink className="w-3.5 h-3.5 text-slate-400" />
            Unlinked
          </span>
        )
      )
    },
    {
      headerName: '', field: 'cp.id', width: 160, sortable: false, filter: false, pinned: 'right',
      valueGetter: (p) => p.data?.cp.id,
      cellRenderer: (p: ICellRendererParams<CpRow, string>) => (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (p.data) onOpen(p.data.cp); }}
            className="text-xs font-bold text-slate-600 border border-slate-300 rounded-lg px-2.5 py-1 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Manage Dossier
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (p.data) onDelete(p.data.cp); }}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
              title="Delete entity"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )
    }
  ], [copiedId, isAdmin, onOpen, onDelete]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search counterparties across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {counterparties.length} entities · double-click a row to open the dossier
        </span>
      </div>
      <div className="h-[540px]">
        <AgGridReact<CpRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
          quickFilterText={quickFilter}
          rowHeight={58}
          headerHeight={36}
          {...GROUPING_OPTIONS}
          onRowDoubleClicked={e => { if (e.data) onOpen(e.data.cp); }}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
        />
      </div>
    </div>
  );
};
