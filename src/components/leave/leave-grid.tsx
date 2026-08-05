"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter, GROUPING_OPTIONS } from '@/lib/ag-grid-setup';
import { LeaveRequest, LeaveType } from '@/lib/types';
import { Badge } from '@/components/ui/primitives';
import { Search } from 'lucide-react';

interface LeaveRow {
  startDate: string;
  endDate: string;
  category: string;
  categoryColour: string;
  workDays: number;
  status: string;
  note: string;
}

interface LeaveGridProps {
  leaves: LeaveRequest[];
  leaveTypes: LeaveType[];
  getEffectiveDays: (req: LeaveRequest) => number;
}

export const LeaveGrid: React.FC<LeaveGridProps> = ({ leaves, leaveTypes, getEffectiveDays }) => {
  const [quickFilter, setQuickFilter] = useState('');

  const rowData = useMemo<LeaveRow[]>(() => {
    return leaves.map(req => {
      const lt = leaveTypes.find(t => t.id === req.leave_type_id);
      return {
        startDate: req.start_date,
        endDate: req.end_date,
        category: lt?.name_el || (req.origin === 'mandatory' ? 'Mandatory Closure' : 'Regular Leave'),
        categoryColour: lt?.colour || '#3D87D3',
        workDays: getEffectiveDays(req),
        status: req.status,
        note: req.note || ''
      };
    });
  }, [leaves, leaveTypes, getEffectiveDays]);

  const columnDefs = useMemo<ColDef<LeaveRow>[]>(() => [
    {
      headerName: 'Start Date', field: 'startDate', width: 115, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      cellClass: 'font-mono font-extrabold text-slate-900'
    },
    {
      headerName: 'End Date', field: 'endDate', width: 115, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      cellClass: 'font-mono font-extrabold text-slate-900'
    },
    {
      headerName: 'Category / Type', field: 'category', minWidth: 200, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<LeaveRow, string>) => (
        <span className="flex items-center font-semibold text-slate-800">
          <span className="w-2.5 h-2.5 rounded-full mr-2 inline-block shrink-0" style={{ backgroundColor: p.data?.categoryColour || '#3D87D3' }} />
          {p.value}
        </span>
      )
    },
    {
      headerName: 'Working Days', field: 'workDays', width: 120, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellRenderer: (p: ICellRendererParams<LeaveRow, number>) => (
        <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 font-extrabold">{p.value}d</span>
      )
    },
    {
      headerName: 'Status', field: 'status', width: 130, sortable: true, ...excelSetFilter(['approved', 'pending', 'rejected', 'taken']),
      cellRenderer: (p: ICellRendererParams<LeaveRow, string>) => {
        if (p.value === 'approved') return <Badge variant="success">✓ APPROVED</Badge>;
        if (p.value === 'pending') return <Badge variant="warning">⏳ PENDING</Badge>;
        if (p.value === 'rejected') return <Badge variant="error">✕ REJECTED</Badge>;
        return <Badge variant="neutral">✓ TAKEN</Badge>;
      }
    },
    {
      headerName: 'Memo & Notes', field: 'note', minWidth: 220, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<LeaveRow, string>) => (
        <span className="text-slate-500 truncate block max-w-[220px]" title={p.value || ''}>{p.value || 'Standard time off'}</span>
      )
    }
  ], []);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search leave across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {leaves.length} requests · use column filters for Excel-style options
        </span>
      </div>
      <div className="h-[420px]">
        <AgGridReact<LeaveRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80 }}
          quickFilterText={quickFilter}
          rowHeight={48}
          headerHeight={36}
          {...GROUPING_OPTIONS}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
        />
      </div>
    </div>
  );
};
