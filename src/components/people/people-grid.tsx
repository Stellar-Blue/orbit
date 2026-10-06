"use client";

import React, { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams, type ValueFormatterParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { useGridFilterControls, ClearFiltersButton, type ExternalFilterSource } from '@/components/ui/grid-filter-controls';
import { JobRole, Profile, ProfileRoleHistory, SeniorityLevel, Team } from '@/lib/types';
import { EmployeeIntegration } from '@/lib/integrations/types';
import { resolveCurrentRole } from '@/lib/profile-role';
import { formatDate } from '@/lib/date';
import { Badge } from '@/components/ui/primitives';
import { BlurredReveal } from '@/components/ui/blurred-reveal';
import { Search } from 'lucide-react';

interface PeopleRow {
  profile: Profile;
  name: string;
  greekName: string;
  email: string;
  role: string;
  /** Sensitive PII — present for admins only (RLS: employees read just their own row). */
  afm: string;
  amka: string;
  amaEfka: string;
  iban: string;
  bankName: string;
  bankSwift: string;
  address: string;
  birthDate: string;
  idNumber: string;
  currentRole: string;
  seniority: string;
  startDate: string;
  team: string;
  employment: string;
  schedule: string;
  slackStatus: 'connected' | 'revoked' | 'none';
}

interface PeopleGridProps {
  profiles: Profile[];
  teams: Team[];
  integrations: EmployeeIntegration[];
  profileRoleHistory: ProfileRoleHistory[];
  jobRoles: JobRole[];
  seniorityLevels: SeniorityLevel[];
  /** Admins additionally see the Sensitive PII columns (ΑΦΜ / ΑΜΚΑ / bank / address). */
  isAdmin?: boolean;
  /** Filters the page applies before rows reach this grid, so "Clear filters" resets them too. */
  externalFilters?: ExternalFilterSource;
  onSelect: (p: Profile) => void;
}

export const PeopleGrid: React.FC<PeopleGridProps> = ({ profiles, teams, integrations, profileRoleHistory, jobRoles, seniorityLevels, isAdmin = false, externalFilters, onSelect }) => {
  const gridFilters = useGridFilterControls(externalFilters);
  const { quickFilter, setQuickFilter } = gridFilters;

  const integrationMap = useMemo(() => {
    const map = new Map<string, EmployeeIntegration>();
    integrations.forEach(i => { if (i.provider === 'slack') map.set(i.profile_id, i); });
    return map;
  }, [integrations]);

  // Role & seniority come from the effective-dated assignments in profile_role_history —
  // there is no per-profile seniority field anymore.
  const currentRoleMap = useMemo(() => {
    const map = new Map<string, { role: string; seniority: string }>();
    profiles.forEach(p => {
      const r = resolveCurrentRole(profileRoleHistory, p.id, jobRoles, seniorityLevels);
      if (r) map.set(p.id, r);
    });
    return map;
  }, [profiles, profileRoleHistory, jobRoles, seniorityLevels]);

  const rowData = useMemo<PeopleRow[]>(() => {
    return profiles.map(p => {
      const integ = integrationMap.get(p.id);
      const current = currentRoleMap.get(p.id);
      return {
        profile: p,
        name: `${p.first_name} ${p.last_name}`,
        greekName: p.name_el || '',
        email: p.work_email || '',
        role: p.role || 'employee',
        afm: p.sensitive?.afm || '',
        amka: p.sensitive?.amka || '',
        amaEfka: p.sensitive?.ama_efka || '',
        iban: p.sensitive?.iban || '',
        bankName: p.sensitive?.bank_name || '',
        bankSwift: (p.sensitive?.bank_swift || '').toUpperCase(),
        address: p.sensitive?.address || '',
        birthDate: p.sensitive?.birth_date || '',
        idNumber: p.sensitive?.id_number || '',
        currentRole: current?.role || 'Unassigned',
        seniority: current?.seniority || '—',
        startDate: p.start_date || '',
        team: teams.find(t => t.id === p.team_id)?.name || 'General',
        employment: p.employment_type.replace('_', ' ').toUpperCase(),
        schedule: (p.work_schedule || []).join(', '),
        slackStatus: !integ ? 'none' : integ.status === 'revoked' ? 'revoked' : 'connected',
      };
    });
  }, [profiles, teams, integrationMap, currentRoleMap]);

  const columnDefs = useMemo<ColDef<PeopleRow>[]>(() => [
    {
      headerName: 'Employee Name', field: 'name', minWidth: 240, sortable: true, ...excelSetFilter(), pinned: 'left',
      cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs shrink-0">
            {(p.value || '').split(' ').map(w => w[0]).slice(0, 2).join('')}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 truncate flex items-center gap-1.5">
              {p.value}
              <Badge variant={p.data?.role === 'admin' ? 'warning' : 'neutral'} className="text-[9px] px-1.5 py-0 shrink-0">
                {p.data?.role === 'admin' ? 'ADMIN' : 'EMPLOYEE'}
              </Badge>
            </p>
            {p.data?.greekName && <p className="text-xs text-slate-500 truncate">{p.data.greekName}</p>}
          </div>
        </div>
      )
    },
    {
      headerName: 'Email', field: 'email', minWidth: 230, sortable: true, ...excelSetFilter(),
      cellClass: 'font-mono text-xs text-slate-600'
    },
    {
      headerName: 'Current Role', field: 'currentRole', width: 170, sortable: true, ...excelSetFilter(),
      headerTooltip: 'Job role in force today, from the effective-dated Timesheet Role & Seniority assignment',
      cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
        p.value === 'Unassigned'
          ? <span className="text-xs text-slate-400 italic">Unassigned</span>
          : <span className="font-medium text-slate-700">{p.value}</span>
      )
    },
    {
      headerName: 'Seniority', field: 'seniority', width: 120, sortable: true, ...excelSetFilter(),
      headerTooltip: 'Seniority in force today, from the effective-dated Timesheet Role & Seniority assignment',
      cellClass: 'text-slate-600 font-medium'
    },
    { headerName: 'Team', field: 'team', width: 140, sortable: true, ...excelSetFilter() },
    {
      headerName: 'Employment Type', field: 'employment', width: 150, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
        <Badge variant={(p.value || '').includes('CONTRACTOR') ? 'warning' : (p.value || '').includes('PART') ? 'info' : 'success'} className="text-[10px]">{p.value}</Badge>
      )
    },
    {
      headerName: 'Start Date', field: 'startDate', width: 130, sortable: true, ...excelSetFilter(),
      valueFormatter: (p) => formatDate(p.value),
      cellClass: 'text-xs text-slate-600 font-mono'
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
    // Sensitive PII — admin-only. Rendered as a column group so it is obvious why these columns
    // exist (and easy to collapse). Employees never get the data: profile_sensitive is own-row
    // RLS, so their PeopleRow simply has empty values and the columns are not rendered at all.
    ...(isAdmin ? [{
      headerName: 'Sensitive PII (Admin)',
      groupId: 'people_pii',
      headerClass: 'bg-amber-50/70 text-amber-800 font-bold',
      children: [
        {
          headerName: 'ΑΦΜ (Tax ID)', field: 'afm', width: 130, sortable: true, ...excelSetFilter(),
          cellClass: 'font-mono text-xs text-slate-700',
          cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
            p.value ? <span className="font-mono text-xs">{p.value}</span> : <span className="text-slate-300 text-xs">—</span>
          )
        },
        {
          headerName: 'ΑΜΚΑ', field: 'amka', width: 140, sortable: true, ...excelSetFilter(),
          cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
            p.value ? <span className="font-mono text-xs">{p.value}</span> : <span className="text-slate-300 text-xs">—</span>
          )
        },
        {
          headerName: 'ΑΜΑ ΕΦΚΑ', field: 'amaEfka', width: 130, sortable: true, ...excelSetFilter(),
          cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
            p.value ? <span className="font-mono text-xs">{p.value}</span> : <span className="text-slate-300 text-xs">—</span>
          )
        },
        {
          headerName: 'IBAN', field: 'iban', width: 210, sortable: true, ...excelSetFilter(),
          cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
            <BlurredReveal value={p.value} placeholder="—" className="text-xs" />
          )
        },
        {
          headerName: 'Bank', field: 'bankName', width: 165, sortable: true, ...excelSetFilter(),
          cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
            p.value ? <span className="text-xs text-slate-700">{p.value}</span> : <span className="text-slate-300 text-xs">—</span>
          )
        },
        {
          headerName: 'SWIFT / BIC', field: 'bankSwift', width: 125, sortable: true, ...excelSetFilter(),
          cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
            p.value ? <span className="font-mono text-xs">{p.value}</span> : <span className="text-slate-300 text-xs">—</span>
          )
        },
        {
          headerName: 'Birth Date', field: 'birthDate', width: 125, sortable: true, ...excelSetFilter(),
          valueFormatter: (p: ValueFormatterParams<PeopleRow, string>) => (p.data && p.value ? formatDate(p.value) : ''),
          cellClass: 'font-mono text-xs text-slate-600'
        },
        {
          headerName: 'ID Number', field: 'idNumber', width: 130, sortable: true, ...excelSetFilter(),
          cellRenderer: (p: ICellRendererParams<PeopleRow, string>) => (
            p.value ? <span className="font-mono text-xs">{p.value}</span> : <span className="text-slate-300 text-xs">—</span>
          )
        },
        {
          headerName: 'Residential Address', field: 'address', minWidth: 220, sortable: true, ...excelSetFilter(),
          cellClass: 'text-xs text-slate-600',
          tooltipField: 'address'
        }
      ]
    } as ColDef<PeopleRow>] : []),
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
  ], [onSelect, isAdmin]);

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
        <div className="flex items-center gap-2 shrink-0">
          <ClearFiltersButton controls={gridFilters} />
          <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
            {profiles.length} members · use column filters for Excel-style options
          </span>
        </div>
      </div>
      <div className="h-[520px]">
        <AgGridReact<PeopleRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80, enableRowGroup: true, enableValue: true, enablePivot: true }}
          {...gridFilters.gridProps}
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
