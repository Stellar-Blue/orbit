"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter } from '@/lib/ag-grid-setup';
import { Badge } from '@/components/ui/primitives';
import { Plus, RefreshCw, CheckCircle2, Search } from 'lucide-react';

export interface AttioSyncCompany {
  attio_record_id: string;
  legal_name: string;
  relationship_status: string;
  country_code: string;
  vat_number: string;
  domain: string;
  suggested_role: 'client' | 'supplier' | 'both';
  estimated_arr: number;
  qualified?: boolean;
  email?: string;
}

interface AttioCompanyRow {
  comp: AttioSyncCompany;
  legalName: string;
  relationship: string;
  qualified: boolean;
  country: string;
  vat: string;
  domain: string;
  estArr: number;
  imported: boolean;
}

interface AttioCompaniesGridProps {
  companies: AttioSyncCompany[];
  importingRecordId: string | null;
  isImported: (comp: AttioSyncCompany) => boolean;
  onImport: (comp: AttioSyncCompany) => void;
}

const eurFormatter = (value: number) =>
  value == null || isNaN(value) ? '' : `€${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export const AttioCompaniesGrid: React.FC<AttioCompaniesGridProps> = ({
  companies,
  importingRecordId,
  isImported,
  onImport
}) => {
  const [quickFilter, setQuickFilter] = useState('');

  const rowData = useMemo<AttioCompanyRow[]>(() => {
    return companies.map(comp => ({
      comp,
      legalName: comp.legal_name,
      relationship: comp.relationship_status || '—',
      qualified: comp.qualified !== false,
      country: comp.country_code || '—',
      vat: comp.vat_number || '—',
      domain: comp.domain || '—',
      estArr: comp.estimated_arr || 0,
      imported: isImported(comp)
    }));
  }, [companies, isImported]);

  const columnDefs = useMemo<ColDef<AttioCompanyRow>[]>(() => {
    const defs: ColDef<AttioCompanyRow>[] = [
      {
        headerName: 'Company', field: 'legalName', minWidth: 240, sortable: true, filter: 'agTextColumnFilter', pinned: 'left',
        cellRenderer: (p: ICellRendererParams<AttioCompanyRow, string>) => (
          <div>
            <div className="font-bold text-slate-800">{p.value}</div>
            <div className="text-[10px] text-slate-400 font-mono">{p.data?.domain && p.data.domain !== '—' ? p.data.domain : ''}</div>
          </div>
        )
      },
      {
        headerName: 'Relationship Type', field: 'relationship', width: 160, sortable: true, ...excelSetFilter(),
        cellRenderer: (p: ICellRendererParams<AttioCompanyRow, string>) => (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase font-mono font-bold bg-indigo-500/10 text-indigo-700 border border-indigo-300">
            {p.value}
          </span>
        )
      },
      {
        headerName: 'Sync Criteria', field: 'qualified', width: 120, sortable: true,
        filter: 'agSetColumnFilter', filterParams: { values: ['Yes', 'No'] },
        cellRenderer: (p: ICellRendererParams<AttioCompanyRow, boolean>) => (
          p.value ? (
            <Badge variant="success" className="text-[10px]">Whitelist Match</Badge>
          ) : (
            <Badge variant="neutral" className="text-[10px]">Outside Criteria</Badge>
          )
        )
      },
      { headerName: 'Country', field: 'country', width: 100, sortable: true, ...excelSetFilter() },
      {
        headerName: 'VAT / Tax ID', field: 'vat', width: 150, sortable: true, filter: 'agTextColumnFilter',
        cellClass: 'font-mono text-slate-700'
      },
      {
        headerName: 'Est. ARR', field: 'estArr', width: 120, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
        cellClass: 'font-mono font-bold text-emerald-700',
        valueFormatter: (p) => eurFormatter(p.value)
      },
      {
        headerName: 'Orbit Status', field: 'imported', width: 140, sortable: true,
        filter: 'agSetColumnFilter', filterParams: { values: ['Imported', 'Not Imported'] },
        cellRenderer: (p: ICellRendererParams<AttioCompanyRow, boolean>) => (
          p.value ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-lg font-bold text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Imported in Orbit
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded-lg font-bold text-[11px]">
              Not Imported
            </span>
          )
        )
      },
      {
        headerName: '', field: 'imported', width: 130, sortable: false, filter: false, pinned: 'right',
        cellRenderer: (p: ICellRendererParams<AttioCompanyRow, boolean>) => {
          if (p.value) return <span />;
          const isImporting = importingRecordId === p.data?.comp.attio_record_id;
          return (
            <button
              type="button"
              disabled={isImporting}
              onClick={(e) => { e.stopPropagation(); if (p.data) onImport(p.data.comp); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3D87D3] hover:bg-blue-600 text-white text-xs font-bold shadow-md shadow-blue-500/25 transition-all disabled:opacity-60 cursor-pointer"
            >
              {isImporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {isImporting ? 'Importing...' : 'Import to Orbit'}
            </button>
          );
        }
      }
    ];
    return defs;
  }, [importingRecordId, onImport]);

  return (
    <div className="rounded-xl overflow-hidden border border-slate-700/60 bg-slate-900/60">
      <div className="px-4 py-2.5 border-b border-slate-700/60 flex items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by name, VAT, relationship, country, domain..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-500"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {companies.length} companies from Attio · default view: not imported first · click any column header to sort/filter
        </span>
      </div>
      <div className="h-[520px]">
        <AgGridReact<AttioCompanyRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80 }}
          quickFilterText={quickFilter}
          rowHeight={50}
          headerHeight={36}
          initialState={{
            sort: {
              sortModel: [
                { colId: 'imported', sort: 'asc' },
                { colId: 'qualified', sort: 'desc' },
                { colId: 'legalName', sort: 'asc' }
              ]
            }
          }}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
        />
      </div>
    </div>
  );
};
