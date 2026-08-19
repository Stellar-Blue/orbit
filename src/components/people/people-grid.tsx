"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { Profile, Team } from '@/lib/types';
import { EmployeeIntegration } from '@/lib/integrations/types';
import { Badge } from '@/components/ui/primitives';
import { Search } from 'lucide-react';

interface PeopleRow {
  profile: Profile;
  name: string;
  greekName: string;
  email: string;
  title: string;
  role: string;
  team: string;
  employment: string;
  schedule: string;
  slackStatus: 'connected' | 'revoked' | 'none';
}

interface PeopleGridProps {
  profiles: Profile[];
  teams: Team[];
  integrations: EmployeeIntegration[];
  onSelect: (p: Profile) => void;
}

export const PeopleGrid: React.FC<PeopleGridProps> = ({ profiles, teams, integrations, onSelect }) => {
  const [quickFilter, setQuickFilter] = useState('');

  const integrationMap = useMemo(() => {
    const map = new Map<string, EmployeeIntegration>();
    integrations.forEach(i => { if (i.provider === 'slack') map.set(i.profile_id, i); });
    return map;
  }, [integrations]);

  const rowData = useMemo<PeopleRow[]>(() => {
    return profiles.map(p => {
      const integ = integrationMap.get(p.id);
      return {
        profile: p,
        name: `${p.first_name} ${p.last_name}`,
        greekName: p.name_el || '',
        email: p.work_email || '',
        title: p.title || '',
        role: p.role || 'employee',
        team: teams.find(t => t.id === p.team_id)?.name || 'General',
        employment: p.employment_type.replace('_', ' ').toUpperCase(),
        schedule: (p.work_schedule || []).join(', '),
        slackStatus: !integ ? 'none' : integ.status === 'revoked' ? 'revoked' : 'connected',
      };
    });
  }, [profiles, teams, integrationMap]);

  const columnDefs = useMemo<ColDef<PeopleRow>[]>(() => [
    {
      headerName: 'Employee Name', field: 'name', minWidth: 220, sortable: true, ...excelSetFilter(), pinned: 'left',
      cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs shrink-0">
            {(p.value || '').split(' ').map(w => w[0]).slice(0, 2).join('')}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 truncate">{p.value}</p>
            <p className="text-xs text-slate-500 truncate">{p.data?.greekName} • {p.data?.email}</p>
          </div>
        </div>
      )
    },
    {
      headerName: 'Role / Title', field: 'title', width: 170, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
        <div>
          <div className="font-medium text-slate-700">{p.value}</div>
          <Badge variant={p.data?.role === 'admin' ? 'warning' : 'neutral'} className="mt-0.5 text-[10px]">
            {p.data?.role === 'admin' ? 'ADMIN' : 'EMPLOYEE'}
          </Badge>
        </div>
      )
    },
    { headerName: 'Team', field: 'team', width: 140, sortable: true, ...excelSetFilter() },
    {
      headerName: 'Employment Type', field: 'employment', width: 150, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
        <Badge variant={(p.value || '').includes('CONTRACTOR') ? 'warning' : (p.value || '').includes('PART') ? 'info' : 'success'} className="text-[10px]">{p.value}</Badge>
      )
    },
    {
      headerName: 'Work Schedule', field: 'schedule', width: 220, sortable: true, ...excelSetFilter(),
      cellClass: 'text-xs text-slate-500 font-mono'
    },
    {
      headerName: 'Slack', field: 'slackStatus', width: 130, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
        p.value === 'connected' ? (
          <Badge variant="success" className="text-[10px]">● Connected</Badge>
        ) : p.value === 'revoked' ? (
          <Badge variant="error" className="text-[10px]">● Revoked</Badge>
        ) : (
          <Badge variant="neutral" className="text-[10px]">Not connected</Badge>
        )
      )
    },
    {
      headerName: '', field: 'profile.id', width: 130, sortable: false, filter: false, pinned: 'right',
      valueGetter: (p) => p.data?.profile.id,
      cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (p.data) onSelect(p.data.profile); }}
          className="text-xs font-bold text-[#3D87D3] hover:underline px-2 py-1 rounded hover:bg-blue-50 cursor-pointer"
        >
          View Profile →
        </button>
      )
    }
  ], [onSelect]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search people across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {profiles.length} members · use column filters for Excel-style options
        </span>
      </div>
      <div className="h-[520px]">
        <AgGridReact<PeopleRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
          quickFilterText={quickFilter}
          rowHeight={56}
          headerHeight={36}
          {...GROUPING_OPTIONS}
          onRowDoubleClicked={e => { if (e.data) onSelect(e.data.profile); }}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
        />
      </div>
    </div>
  );
};
