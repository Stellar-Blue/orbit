"use client";

import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { orbitGridTheme, excelSetFilter } from '@/lib/ag-grid-setup';
import { LeaveRequest, Profile, LeaveType } from '@/lib/types';
import { Badge } from '@/components/ui/primitives';
import { Edit3, Trash2, Search } from 'lucide-react';

interface LeaveRow {
  req: LeaveRequest;
  employee: string;
  employeeSub: string;
  category: string;
  categoryColour: string;
  mandatory: boolean;
  startDate: string;
  endDate: string;
  workDays: number;
  note: string;
  status: string;
  pendingCancel: boolean;
  erganiStatus: string;
}

interface CompanyLeaveGridProps {
  requests: LeaveRequest[];
  profiles: Profile[];
  leaveTypes: LeaveType[];
  getEffectiveDays: (req: LeaveRequest) => number;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDecideCancellation: (id: string, approve: boolean) => void;
  onEdit: (req: LeaveRequest) => void;
  onDelete: (id: string) => void;
}

export const CompanyLeaveGrid: React.FC<CompanyLeaveGridProps> = ({
  requests,
  profiles,
  leaveTypes,
  getEffectiveDays,
  onApprove,
  onReject,
  onDecideCancellation,
  onEdit,
  onDelete
}) => {
  const [quickFilter, setQuickFilter] = useState('');

  const rowData = useMemo<LeaveRow[]>(() => {
    return requests.map(req => {
      const prof = profiles.find(p => p.id === req.profile_id);
      const lType = leaveTypes.find(lt => lt.id === req.leave_type_id);
      return {
        req,
        employee: prof ? `${prof.first_name} ${prof.last_name}` : 'Unknown Team Member',
        employeeSub: prof ? `${prof.title || 'Team Member'} • ${prof.employment_type.toUpperCase()}` : '',
        category: `${lType?.name_el || 'Leave'} (${lType?.name_en || 'Other'})`,
        categoryColour: lType?.colour || '#3D87D3',
        mandatory: req.origin === 'mandatory',
        startDate: req.start_date,
        endDate: req.end_date,
        workDays: getEffectiveDays(req),
        note: req.note || '',
        status: req.status,
        pendingCancel: req.status === 'cancellation_requested',
        erganiStatus: req.ergani_status || 'not_submitted'
      };
    });
  }, [requests, profiles, leaveTypes, getEffectiveDays]);

  const columnDefs = useMemo<ColDef<LeaveRow>[]>(() => [
    {
      headerName: 'Employee Member', field: 'employee', minWidth: 200, sortable: true, ...excelSetFilter(), pinned: 'left',
      cellRenderer: (p: ICellRendererParams<LeaveRow, string>) => (
        <div>
          <div className="font-extrabold text-slate-900 text-sm">{p.value}</div>
          <div className="text-[11px] text-slate-400 font-semibold">{p.data?.employeeSub}</div>
        </div>
      )
    },
    {
      headerName: 'Leave Category', field: 'category', width: 200, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<LeaveRow, string>) => (
        <div>
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-extrabold border"
            style={{
              backgroundColor: `${p.data?.categoryColour || '#3D87D3'}15`,
              color: p.data?.categoryColour || '#3D87D3',
              borderColor: `${p.data?.categoryColour || '#3D87D3'}30`
            }}>
            <span className="w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: p.data?.categoryColour || '#3D87D3' }} />
            {p.value}
          </span>
          {p.data?.mandatory && (
            <span className="block mt-1 text-[10px] font-extrabold text-indigo-700">📌 Company Mandatory Closure</span>
          )}
        </div>
      )
    },
    {
      headerName: 'Start', field: 'startDate', width: 105, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      cellClass: 'font-mono font-bold text-slate-800'
    },
    {
      headerName: 'End', field: 'endDate', width: 105, sortable: true, filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['equals', 'greaterThan', 'lessThan'] },
      cellClass: 'font-mono font-bold text-slate-800'
    },
    {
      headerName: 'Working Days', field: 'workDays', width: 110, sortable: true, filter: 'agNumberColumnFilter', type: 'rightAligned',
      cellClass: 'font-mono font-black text-slate-900 text-sm',
      valueFormatter: (p) => `${p.value}d`
    },
    {
      headerName: 'Reason / Notes', field: 'note', width: 180, sortable: true, ...excelSetFilter(),
      cellRenderer: (p: ICellRendererParams<LeaveRow, string>) => (
        p.value ? <span className="italic text-slate-800">“{p.value}”</span> : <span className="text-slate-300 font-normal">None provided</span>
      )
    },
    {
      headerName: 'Status & ΕΡΓΑΝΗ', field: 'status', width: 150, sortable: true, ...excelSetFilter(['pending', 'approved', 'rejected', 'taken', 'cancellation_requested']),
      cellRenderer: (p: ICellRendererParams<LeaveRow, string>) => (
        <div className="space-y-1">
          {p.value === 'approved' || p.value === 'taken' ? (
            <Badge variant="success" className="font-extrabold">✓ APPROVED</Badge>
          ) : p.value === 'rejected' ? (
            <Badge variant="error" className="font-extrabold">× REJECTED</Badge>
          ) : (
            <Badge variant="warning" className="font-extrabold">⏳ PENDING</Badge>
          )}
          {p.data?.pendingCancel && (
            <Badge variant="warning" className="text-[10px] font-black bg-amber-100 text-amber-950 border-amber-300 block w-fit">
              ⚠️ Cancellation Requested
            </Badge>
          )}
          <div className="text-[10px] font-mono text-slate-400 uppercase">
            ΕΡΓΑΝΗ: <span className="text-slate-600 font-bold">{p.data?.erganiStatus}</span>
          </div>
        </div>
      )
    },
    {
      headerName: '', field: 'req.id', width: 240, sortable: false, filter: false, pinned: 'right',
      valueGetter: (p) => p.data?.req.id,
      cellRenderer: (p: ICellRendererParams<LeaveRow, string>) => {
        if (!p.data) return <span />;
        const row = p.data;
        return (
          <div className="flex items-center justify-end space-x-2 whitespace-nowrap">
            {row.status === 'pending' && !row.pendingCancel && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onApprove(row.req.id); }}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-3 py-1.5 rounded-lg shadow-xs text-xs cursor-pointer"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onReject(row.req.id); }}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-black px-3 py-1.5 rounded-lg shadow-xs text-xs cursor-pointer"
                >
                  Reject
                </button>
              </>
            )}
            {row.pendingCancel && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDecideCancellation(row.req.id, true); }}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-black text-[11px] py-1 px-2 rounded-lg cursor-pointer"
                >
                  Approve Cancellation
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDecideCancellation(row.req.id, false); }}
                  className="text-[11px] py-1 px-2 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  Keep Active
                </button>
              </>
            )}
            {(row.status === 'approved' || row.status === 'taken') && !row.pendingCancel && !row.mandatory && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEdit(row.req); }}
                className="text-[11px] font-bold py-1 px-2.5 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer flex items-center"
              >
                <Edit3 className="w-3.5 h-3.5 mr-1 text-[#3D87D3]" /> Modify
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(row.req.id); }}
              className="text-[11px] font-bold p-1.5 text-rose-600 border border-rose-300 rounded-lg hover:bg-rose-50 cursor-pointer"
              title="Delete Leave Request"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      }
    }
  ], [onApprove, onReject, onDecideCancellation, onEdit, onDelete]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search leave requests across all columns..."
            value={quickFilter}
            onChange={e => setQuickFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-medium shrink-0 hidden sm:block">
          {requests.length} requests · use column filters for Excel-style options
        </span>
      </div>
      <div className="h-[540px]">
        <AgGridReact<LeaveRow>
          theme={orbitGridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 80 }}
          quickFilterText={quickFilter}
          rowHeight={60}
          headerHeight={36}
          pagination={true}
          paginationPageSize={25}
          paginationPageSizeSelector={[10, 25, 50, 100]}
        />
      </div>
    </div>
  );
};
