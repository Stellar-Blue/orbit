"use client";

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import { Card, Button, Badge, Modal } from '@/components/ui/primitives';
import { DateRangePicker } from '@/components/leave/date-range-picker';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import { 
  Calendar, Clock, CheckCircle2, AlertTriangle, 
  Users, Filter, Edit3, ShieldAlert,
  Briefcase, Plus, Search, Settings, Trash2, Tag, Sliders, Download, FileSpreadsheet, RefreshCw
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { LeaveRequest, LeaveType } from '@/lib/types';
import { formatDate, todayKey } from '@/lib/date';
import {
  DETAILED_LEDGER_HEADERS, LEAVE_EXPORT_MONTHS, detailedLedgerAoa, filterLeaveExport,
  groupLeavesByEmployee, leaveCategoryName, leaveExportEmployees, leaveExportScopeLabel,
  type LeaveExportFilters, type LeaveExportPeriod,
} from '@/lib/leave-export';
import { countWorkingDays, holidayDates, resolveWorkSchedule } from '@/lib/leave-days';

const CompanyLeaveGrid = dynamic(() => import('@/components/leave/company-leave-grid').then(m => m.CompanyLeaveGrid), { ssr: false });

export default function CompanyLeaveManagementPage() {
  const { 
    currentUser, profiles, leaveTypes, leaveRequests, mandatoryLeaves, publicHolidays, 
    updateLeaveRequestStatus, addMandatoryLeave, updateMandatoryLeave, deleteMandatoryLeave,
    syncAllMandatoryLeaves,
    editLeaveRequest, decideLeaveCancellation, splitAndAddLeaveRequest, deleteLeaveRequest,
    addLeaveType, updateLeaveType, deleteLeaveType, getEmployeeLeaveBalance
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';

  // Tabs
  const [activeTab, setActiveTab] = useState<'approvals' | 'categories'>('approvals');

  // Filter state for approval queue
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'mandatory'>('pending');
  const [searchQuery, setSearchQuery] = useState('');

  // Rejection explanation modal
  const [rejectModalTarget, setRejectModalTarget] = useState<string | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');

  // Admin Post-Approval Editor modal state
  const [editingLeave, setEditingLeave] = useState<LeaveRequest | null>(null);
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editReason, setEditReason] = useState('');

  // Mandatory Leave Declaration State
  const [isMandatoryOpen, setIsMandatoryOpen] = useState(false);
  const [editingMandatoryId, setEditingMandatoryId] = useState<string | null>(null);
  const [mName, setMName] = useState('Company-wide closure');
  const [mStart, setMStart] = useState(todayKey);
  const [mEnd, setMEnd] = useState(todayKey);
  const [mNote, setMNote] = useState('Company-wide summer vacation week.');
  const [previewMode, setPreviewMode] = useState(false);

  // Admin Record Employee Leave State
  const [isAddEmployeeLeaveOpen, setIsAddEmployeeLeaveOpen] = useState(false);
  const [addEmpId, setAddEmpId] = useState('');
  const [addEmpLeaveTypeId, setAddEmpLeaveTypeId] = useState('');
  const [addEmpStart, setAddEmpStart] = useState(todayKey);
  const [addEmpEnd, setAddEmpEnd] = useState(todayKey);
  const [addEmpStatus, setAddEmpStatus] = useState<'approved' | 'taken' | 'pending'>('approved');
  const [addEmpNote, setAddEmpNote] = useState('');

  const addEmpCalculatedDays = useMemo(() => {
    const targetEmp = profiles.find(p => p.id === (addEmpId || profiles[0]?.id));
    if (!targetEmp) return 0;
    return countWorkingDays(addEmpStart, addEmpEnd, targetEmp.work_schedule, holidayDates(publicHolidays));
  }, [addEmpId, addEmpStart, addEmpEnd, profiles, publicHolidays]);

  // New / Edit Leave Category Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [catEditingId, setCatEditingId] = useState<string | null>(null);
  const [catCode, setCatCode] = useState('');
  const [catNameEn, setCatNameEn] = useState('');
  const [catNameEl, setCatNameEl] = useState('');
  const [catColour, setCatColour] = useState('#3D87D3');
  const [catCountsBalance, setCatCountsBalance] = useState(true);
  const [catRequiresDoc, setCatRequiresDoc] = useState(false);
  const [catRequiresApp, setCatRequiresApp] = useState(true);
  const [catMinNotice, setCatMinNotice] = useState(7);
  const [catSortOrder, setCatSortOrder] = useState(100);
  const [catIsHidden, setCatIsHidden] = useState(false);

  // Deducted Days Excel Export State
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportYear, setExportYear] = useState(2026);
  const [exportScope, setExportScope] = useState<'all' | string>('all');
  const [exportPeriod, setExportPeriod] = useState<LeaveExportPeriod>('full_year');
  const [exportMonth, setExportMonth] = useState(() => new Date().getMonth() + 1);
  const [exportApprovedOnly, setExportApprovedOnly] = useState(false);
  const [exportActiveOnly, setExportActiveOnly] = useState(false);

  const exportFilters: LeaveExportFilters = {
    year: exportYear, period: exportPeriod, month: exportMonth,
    approvedOnly: exportApprovedOnly, activeOnly: exportActiveOnly,
  };
  /** Exactly the leaves the "Generate" button will write to the ledger sheet. */
  const exportLeaves = useMemo(
    () => filterLeaveExport(leaveRequests, exportFilters, profiles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leaveRequests, exportYear, exportPeriod, exportMonth, exportApprovedOnly, exportActiveOnly, profiles]
  );

  const handleExportDeductedDays = () => {
    const targetLeaves = exportLeaves;
    const scopedProfiles = leaveExportEmployees(profiles, exportActiveOnly);
    const scopeLabel = leaveExportScopeLabel(exportFilters);

    const wb = XLSX.utils.book_new();

    if (exportScope === 'all') {
      // Sheet 1: Company-Wide Summary
      const summaryData: (string | number)[][] = [
        ['STELLARBLUE ORBIT — COMPANY-WIDE DEDUCTED LEAVE DAYS REPORT'],
        ['Report Year:', String(exportYear)],
        ['Export Filters:', scopeLabel],
        ['Generated On:', formatDate(new Date())],
        [''],
        ['Employee Name', 'Work Email', 'Employment Type', 'Total Allowance Quota', 'Regular Deducted (Days)', 'Mandatory Closure (Days)', 'Total Deducted Days', 'Remaining Available Balance']
      ];

      scopedProfiles.forEach(p => {
        const bal = getEmployeeLeaveBalance(p.id, exportYear);
        const totalDeducted = bal.taken + bal.mandatory;
        if (p.employment_type !== 'contractor' || totalDeducted > 0) {
          summaryData.push([
            `${p.first_name} ${p.last_name}`,
            p.work_email || '',
            p.employment_type?.replace('_', ' ').toUpperCase() || 'FULL TIME',
            String(bal.entitlement + bal.carryOver),
            String(bal.taken),
            String(bal.mandatory),
            String(totalDeducted),
            String(bal.available)
          ]);
        }
      });

      // Sheet 2: Detailed Deductions Ledger — grouped per employee, column headers on row 1.
      const detailData: (string | number)[][] = [
        DETAILED_LEDGER_HEADERS,
        ...detailedLedgerAoa(groupLeavesByEmployee(targetLeaves, profiles), leaveTypes),
      ];

      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      const wsDetail = XLSX.utils.aoa_to_sheet(detailData);
      XLSX.utils.book_append_sheet(wb, wsSummary, `Summary_${exportYear}`);
      XLSX.utils.book_append_sheet(wb, wsDetail, `Detailed_Ledger_${exportYear}`);
      XLSX.writeFile(wb, `StellarBlue_Deducted_Leaves_Company_${exportYear}.xlsx`);
    } else {
      // Single Employee Report
      const emp = profiles.find(p => p.id === exportScope);
      const bal = getEmployeeLeaveBalance(exportScope, exportYear);
      const totalDeducted = bal.taken + bal.mandatory;
      const empLeaves = targetLeaves.filter(r => r.profile_id === exportScope);

      const empData: (string | number)[][] = [
        ['STELLARBLUE ORBIT — EMPLOYEE DEDUCTED LEAVES REPORT'],
        [''],
        ['Employee Name:', emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown'],
        ['Work Email:', emp?.work_email || ''],
        ['Report Year:', String(exportYear)],
        ['Export Filters:', scopeLabel],
        ['Total Annual Allowance Quota:', `${bal.entitlement + bal.carryOver} working days`],
        ['Regular Deducted Days:', `${bal.taken} working days`],
        ['Mandatory Closure Deducted Days:', `${bal.mandatory} working days`],
        ['TOTAL DEDUCTED LEAVE DAYS:', `${totalDeducted} working days`],
        ['REMAINING AVAILABLE BALANCE:', `${bal.available} working days`],
        [''],
        ['START DATE', 'END DATE', 'LEAVE CATEGORY / TYPE', 'WORKING DAYS DEDUCTED', 'STATUS', 'ORIGIN', 'NOTE / REASON']
      ];

      if (empLeaves.length === 0) {
        empData.push(['No leave deductions recorded for the selected filters', '', '', '', '', '', '']);
      } else {
        empLeaves.forEach(req => {
          empData.push([
            req.start_date,
            req.end_date,
            leaveCategoryName(req, leaveTypes),
            Number(req.working_days || 0),
            req.status.toUpperCase(),
            req.origin.toUpperCase(),
            req.note || 'Standard absence record'
          ]);
        });
      }

      const ws = XLSX.utils.aoa_to_sheet(empData);
      XLSX.utils.book_append_sheet(wb, ws, `Deducted_Report_${exportYear}`);
      XLSX.writeFile(wb, `StellarBlue_Deducted_Leaves_${emp ? emp.last_name : 'Employee'}_${exportYear}.xlsx`);
    }

    setIsExportModalOpen(false);
  };

  // Calculate working days excluding Greek holidays and weekends
  const calculateWorkingDays = (startStr: string, endStr: string, schedule?: string[]) =>
    countWorkingDays(startStr, endStr, schedule, holidayDates(publicHolidays));

  const getEffectiveDays = (req: LeaveRequest) => {
    const p = profiles.find(pr => pr.id === req.profile_id);
    return calculateWorkingDays(req.start_date, req.end_date, p?.work_schedule);
  };

  // Handle Rejection
  const handleConfirmReject = () => {
    if (rejectModalTarget) {
      updateLeaveRequestStatus(rejectModalTarget, 'rejected', rejectionReasonInput || 'Declined by administration');
      setRejectModalTarget(null);
      setRejectionReasonInput('');
    }
  };

  // Handle Save Admin Edit
  const handleSaveAdminEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLeave) return;
    editLeaveRequest(
      editingLeave.id, 
      { start_date: editStartDate, end_date: editEndDate, note: editNote }, 
      editReason || 'Admin adjustment'
    );
    setEditingLeave(null);
  };

  // Handle Publish / Save Mandatory Leave
  const handlePublishMandatory = async () => {
    if (editingMandatoryId) {
      await updateMandatoryLeave(editingMandatoryId, {
        name: mName,
        start_date: mStart,
        end_date: mEnd,
        note: mNote,
      });
      setEditingMandatoryId(null);
    } else {
      addMandatoryLeave({
        name: mName,
        leave_type_id: leaveTypes[0]?.id || 'lt-annual',
        start_date: mStart,
        end_date: mEnd,
        note: mNote,
        status: 'published',
        created_by: currentUser.id
      });
    }
    setIsMandatoryOpen(false);
    setPreviewMode(false);
  };

  const handleOpenEditMandatory = (ml: any) => {
    setEditingMandatoryId(ml.id);
    setMName(ml.name);
    setMStart(ml.start_date);
    setMEnd(ml.end_date);
    setMNote(ml.note || '');
    setPreviewMode(false);
    setIsMandatoryOpen(true);
  };

  const handleDeleteMandatory = async (id: string) => {
    if (window.confirm("Are you sure you want to remove this mandatory company closure? This will also remove the fanned-out leave entries from all employee schedules.")) {
      await deleteMandatoryLeave(id);
    }
  };

  /** Fanned-out entries currently attached to each closure (admin 'detached' corrections included). */
  const fanoutCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    leaveRequests.forEach(r => {
      if (r.origin === 'mandatory' && r.mandatory_leave_id) {
        counts[r.mandatory_leave_id] = (counts[r.mandatory_leave_id] || 0) + 1;
      }
    });
    return counts;
  }, [leaveRequests]);
  const fanoutCountFor = (mandatoryId: string) => fanoutCounts[mandatoryId] || 0;

  // Catch-up sync: re-fan every closure so newly hired/reactivated employees get their closure rows.
  const [isSyncingMandatory, setIsSyncingMandatory] = useState(false);
  const handleSyncMandatoryFanout = async () => {
    setIsSyncingMandatory(true);
    try {
      const res = await syncAllMandatoryLeaves();
      notifySuccess(
        `${res.closures} closure(s) synced — ${res.added} added, ${res.updated} updated, ${res.removed} removed.`,
        'Mandatory Leave Sync'
      );
    } finally {
      setIsSyncingMandatory(false);
    }
  };

  const handleAddEmployeeLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmp = profiles.find(p => p.id === (addEmpId || profiles[0]?.id));
    const targetTypeId = addEmpLeaveTypeId || leaveTypes[0]?.id;
    if (!targetEmp || !targetTypeId) {
      alert('Please select an employee and leave category.');
      return;
    }
    if (!addEmpStart || !addEmpEnd || addEmpStart > addEmpEnd) {
      alert('Please select valid start and end dates.');
      return;
    }
    splitAndAddLeaveRequest({
      profile_id: targetEmp.id,
      leave_type_id: targetTypeId,
      start_date: addEmpStart,
      end_date: addEmpEnd,
      half_day_start: false,
      half_day_end: false,
      working_days: Math.max(1, addEmpCalculatedDays),
      status: addEmpStatus,
      origin: 'admin_entry',
      note: addEmpNote || `Entered by Admin (${currentUser.first_name} ${currentUser.last_name})`,
      ergani_status: 'pending'
    }, resolveWorkSchedule(targetEmp.work_schedule), publicHolidays);
    setIsAddEmployeeLeaveOpen(false);
    setAddEmpNote('');
    notifySuccess('Leave record added.');
  };

  // Handle Save Leave Category
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catNameEn.trim() || !catNameEl.trim() || !catCode.trim()) {
      alert('Please provide valid category code, English name, and Greek name.');
      return;
    }
    const payload = {
      code: catCode.trim().toLowerCase().replace(/\s+/g, '_'),
      name_en: catNameEn.trim(),
      name_el: catNameEl.trim(),
      colour: catColour,
      counts_against_balance: catCountsBalance,
      requires_document: catRequiresDoc,
      requires_approval: catRequiresApp,
      min_notice_days: Number(catMinNotice) >= 0 ? Number(catMinNotice) : 7,
      allow_retroactive: Number(catMinNotice) === 0,
      sort_order: Number(catSortOrder) || 100,
      is_hidden: catIsHidden
    };

    if (catEditingId) {
      await updateLeaveType(catEditingId, payload);
      notifySuccess('Leave category updated.');
    } else {
      await addLeaveType(payload);
      notifySuccess('New leave category created.');
    }
    setIsCategoryModalOpen(false);
  };

  const openNewCategoryModal = () => {
    setCatEditingId(null);
    setCatCode('custom_leave');
    setCatNameEn('');
    setCatNameEl('');
    setCatColour('#10B981');
    setCatCountsBalance(false);
    setCatRequiresDoc(false);
    setCatRequiresApp(true);
    setCatMinNotice(3);
    setCatSortOrder((leaveTypes.length + 1) * 10);
    setCatIsHidden(false);
    setIsCategoryModalOpen(true);
  };

  const openEditCategoryModal = (lt: LeaveType) => {
    setCatEditingId(lt.id);
    setCatCode(lt.code);
    setCatNameEn(lt.name_en);
    setCatNameEl(lt.name_el);
    setCatColour(lt.colour || '#3D87D3');
    setCatCountsBalance(lt.counts_against_balance !== false);
    setCatRequiresDoc(!!lt.requires_document);
    setCatRequiresApp(lt.requires_approval !== false);
    setCatMinNotice(lt.min_notice_days ?? 7);
    setCatSortOrder(lt.sort_order ?? 100);
    setCatIsHidden(!!lt.is_hidden);
    setIsCategoryModalOpen(true);
  };

  // Filtered requests
  const displayedRequests = useMemo(() => {
    return leaveRequests.filter(req => {
      const p = profiles.find(pr => pr.id === req.profile_id);
      const nameMatch = p ? `${p.first_name} ${p.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) : true;
      if (!nameMatch) return false;

      if (filterStatus === 'pending') return req.status === 'pending' || req.status === 'cancellation_requested';
      if (filterStatus === 'approved') return req.status === 'approved' || req.status === 'taken';
      if (filterStatus === 'rejected') return req.status === 'rejected';
      if (filterStatus === 'mandatory') return req.origin === 'mandatory';
      return true;
    }).sort((a, b) => b.start_date.localeCompare(a.start_date));
  }, [leaveRequests, profiles, filterStatus, searchQuery]);

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto py-12 animate-in fade-in">
        <Card className="p-8 text-center bg-rose-50 border-rose-200 text-rose-900 shadow-sm">
          <ShieldAlert className="w-12 h-12 text-rose-600 mx-auto mb-3" />
          <h2 className="text-xl font-black mb-2">Access Restricted to Administrators</h2>
          <p className="text-xs text-rose-700 max-w-md mx-auto">
            This administrative control center is restricted to StellarBlue Founders and HR Officers. To view your individual leave balance or request time off, please navigate to Personal Leave Management.
          </p>
        </Card>
      </div>
    );
  }

  const pendingCount = leaveRequests.filter(r => r.status === 'pending' || r.status === 'cancellation_requested').length;
  const mandatoryRowCount = leaveRequests.filter(r => r.origin === 'mandatory').length;

  return (
    <div className="space-y-8 animate-in fade-in duration-200 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center">
            <Users className="w-6 h-6 mr-3 text-[#3D87D3]" /> Company Leave &amp; Approvals Control Center
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Review employee time-off filings, process cancellation requests, configure mandatory closures, and customize available leave categories.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <Button
            onClick={() => setIsExportModalOpen(true)}
            variant="outline"
            className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 font-extrabold text-xs px-4 py-2 shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Export Deducted Days (XLSX)
          </Button>
          {activeTab === 'categories' && (
            <Button
              onClick={openNewCategoryModal}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs px-4 py-2 shadow-sm flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Create New Leave Category
            </Button>
          )}
          <Button
            onClick={() => {
              setEditingMandatoryId(null);
              setMName('Company-wide closure');
              setMStart(todayKey);
              setMEnd(todayKey);
              setMNote('Offices closed company-wide.');
              setIsMandatoryOpen(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-4 py-2 shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Declare Mandatory Closure
          </Button>
          <Button
            onClick={() => setIsAddEmployeeLeaveOpen(true)}
            className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-white font-extrabold text-xs px-4 py-2 shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Record Employee Leave
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 space-x-8 text-sm font-extrabold">
        <button
          onClick={() => setActiveTab('approvals')}
          className={`pb-3 transition-all flex items-center cursor-pointer ${
            activeTab === 'approvals' 
              ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' 
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock className="w-4 h-4 mr-2" />
          <span>Employee Approval Queue &amp; Mandatory Register</span>
          {pendingCount > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-black text-xs">
              {pendingCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('categories')}
          className={`pb-3 transition-all flex items-center cursor-pointer ${
            activeTab === 'categories' 
              ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' 
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sliders className="w-4 h-4 mr-2 text-indigo-500" />
          <span>Configure Leave Categories ({leaveTypes.length})</span>
        </button>
      </div>

      {/* TAB 1: APPROVALS & MANDATORY CLOSURES */}
      {activeTab === 'approvals' && (
        <div className="space-y-8 animate-in fade-in duration-200">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <Card className="p-5 border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-slate-400 text-[11px] font-extrabold uppercase tracking-wider block">Pending Actions</span>
                <div className="text-3xl font-black text-slate-900 mt-1 font-mono">{pendingCount}</div>
                <span className="text-slate-500 text-[11px] block mt-1">Requests &amp; cancellations awaiting review</span>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0 shadow-2xs">
                <Clock className="w-6 h-6" />
              </div>
            </Card>

            <Card className="p-5 border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-slate-400 text-[11px] font-extrabold uppercase tracking-wider block">Active Mandatory Closures</span>
                <div className="text-3xl font-black text-slate-900 mt-1 font-mono">{mandatoryLeaves.length}</div>
                <span className="text-slate-500 text-[11px] block mt-1">Company-wide breaks deducted in 2026</span>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0 shadow-2xs">
                <Calendar className="w-6 h-6" />
              </div>
            </Card>

            <Card className="p-5 border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-slate-400 text-[11px] font-extrabold uppercase tracking-wider block">Leave Categories</span>
                <div className="text-3xl font-black text-slate-900 mt-1 font-mono">{leaveTypes.length}</div>
                <span className="text-slate-500 text-[11px] block mt-1">Configured absence types active</span>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#3D87D3]/10 border border-[#3D87D3]/20 flex items-center justify-center text-[#3D87D3] shrink-0 shadow-2xs">
                <Briefcase className="w-6 h-6" />
              </div>
            </Card>
          </div>

          {/* Main Employee Approvals Queue */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center space-x-2 overflow-x-auto pb-2 sm:pb-0">
                <span className="text-xs font-extrabold text-slate-500 mr-1 flex items-center shrink-0">
                  <Filter className="w-3.5 h-3.5 mr-1.5 text-slate-400" /> Filter View:
                </span>
                {(['pending', 'approved', 'rejected', 'mandatory', 'all'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setFilterStatus(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all shrink-0 cursor-pointer ${
                      filterStatus === st 
                        ? 'bg-slate-900 text-white shadow-2xs font-black' 
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
                    }`}
                  >
                    {st === 'pending' && `Pending Queue (${pendingCount})`}
                    {st === 'approved' && 'Approved / Taken'}
                    {st === 'rejected' && 'Rejected Archive'}
                    {st === 'mandatory' && `📌 Mandatory Closures (${mandatoryRowCount})`}
                    {st === 'all' && `All Records (${leaveRequests.length})`}
                  </button>
                ))}
              </div>

              <div className="relative min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by employee name..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/40 transition-all"
                />
              </div>
            </div>

            <Card className="shadow-xs border-slate-200/90 overflow-hidden p-0">
              {displayedRequests.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-xs font-bold space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                  <p className="text-slate-600 font-extrabold text-sm">No requests matching this filter criteria</p>
                  <p>Your team leave approval queue is completely up to date.</p>
                </div>
              ) : (
                <CompanyLeaveGrid
                  requests={displayedRequests}
                  profiles={profiles}
                  leaveTypes={leaveTypes}
                  getEffectiveDays={getEffectiveDays}
                  onApprove={(id) => updateLeaveRequestStatus(id, 'approved', 'Approved by Administration')}
                  onReject={(id) => setRejectModalTarget(id)}
                  onDecideCancellation={(id, approve) => decideLeaveCancellation(id, approve)}
                  onEdit={(req) => {
                    setEditingLeave(req);
                    setEditStartDate(req.start_date);
                    setEditEndDate(req.end_date);
                    setEditNote(req.note || '');
                    setEditReason('');
                  }}
                  onDelete={async (id) => {
                    if (window.confirm("Are you sure you want to permanently delete this leave entry for this employee? This action cannot be undone.")) {
                      await deleteLeaveRequest(id);
                    }
                  }}
                />
              )}
            </Card>
          </div>

          {/* Mandatory Leaves Register */}
          <Card title="Company-Wide Mandatory Closure Register" subtitle="Admin-declared mandatory breaks (such as August Summer Bridge or Christmas) counting directly against employee allowances" className="shadow-xs border-slate-200/90" action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSyncMandatoryFanout}
              disabled={isSyncingMandatory || mandatoryLeaves.length === 0}
              title="Re-fan every closure to all eligible employees (new hires, reactivations, drifted rows)"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isSyncingMandatory ? 'animate-spin' : ''}`} />
              {isSyncingMandatory ? 'Syncing…' : 'Sync to All Employees'}
            </Button>
          }>
            <div className="space-y-4 mt-3">
              {mandatoryLeaves.map(ml => (
                <div key={ml.id} className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-3 hover:border-slate-300 transition-all">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h4 className="font-extrabold text-base text-slate-900 flex items-center">
                      <Calendar className="w-5 h-5 mr-2 text-indigo-600 shrink-0" /> {ml.name}
                    </h4>
                    <div className="flex items-center space-x-2">
                      <Badge variant="info" className="font-bold">{ml.status.toUpperCase()}</Badge>
                      <button
                        type="button"
                        onClick={() => handleOpenEditMandatory(ml)}
                        className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-all flex items-center cursor-pointer border border-indigo-200"
                        title="Edit Mandatory Closure"
                      >
                        <Edit3 className="w-3.5 h-3.5 mr-1" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteMandatory(ml.id)}
                        className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 transition-all cursor-pointer border border-rose-200"
                        title="Delete Mandatory Closure"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">
                    Dates Horizon: <strong className="text-[#3D87D3] font-mono">{formatDate(ml.start_date)} &rarr; {formatDate(ml.end_date)}</strong> &bull; Announcement Notes: {ml.note}
                  </p>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-700 text-xs flex items-center justify-between font-medium">
                    <span>Fan-Out Status: <strong className="text-slate-900 font-extrabold">{fanoutCountFor(ml.id)} employee entr{fanoutCountFor(ml.id) === 1 ? 'y' : 'ies'}</strong> — all full-time and part-time staff eligible for the period (external contractors excluded).</span>
                    <span className="text-emerald-700 font-bold">✓ Part-time schedule rules respected</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* TAB 2: LEAVE CATEGORIES CONFIGURATION */}
      {activeTab === 'categories' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <Card 
            title="Configurable Employee Leave Categories" 
            subtitle="Manage the types of time off employees can select when filing leave applications. Customize balance deduction rules, Greek public designations, and notice timelines."
            className="border-slate-200/90 shadow-sm"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
              {leaveTypes.map(lt => {
                const isSystemDefault = ['annual', 'sick', 'remote', 'parental'].includes(lt.code);
                
                return (
                  <div key={lt.id} className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center space-x-2.5">
                          <span className="w-4 h-4 rounded-full shadow-2xs shrink-0" style={{ backgroundColor: lt.colour || '#3D87D3' }} />
                          <div>
                            <h4 className="font-black text-slate-900 text-base flex items-center gap-2">
                              {lt.name_en} 
                              <span className="text-slate-500 font-bold text-sm">({lt.name_el})</span>
                            </h4>
                            <span className="font-mono text-[11px] font-extrabold text-slate-400">Code: #{lt.code}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {isSystemDefault ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase tracking-wider shrink-0">
                              Core Type
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider shrink-0">
                              Custom
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-200 uppercase tracking-wider shrink-0 font-mono">
                            Order: {lt.sort_order ?? 100}
                          </span>
                          {lt.is_hidden && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200 uppercase tracking-wider shrink-0">
                              Hidden
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mt-4 text-xs font-semibold text-slate-600 bg-slate-50 p-3.5 rounded-xl border border-slate-200/60">
                        <div className="space-y-1">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Annual Quota Deduction</span>
                          <span className={lt.counts_against_balance !== false ? 'text-emerald-700 font-bold flex items-center' : 'text-slate-500 font-bold flex items-center'}>
                            {lt.counts_against_balance !== false ? '✓ Deducts from balance' : '⚪ Does not deduct'}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Minimum Advance Notice</span>
                          <span className="text-slate-900 font-mono font-black">
                            {(lt.min_notice_days ?? 7) === 0 ? '0 Days (Instant / Retroactive)' : `${lt.min_notice_days ?? 7} Working Days`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditCategoryModal(lt)}
                        className="text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center"
                      >
                        <Edit3 className="w-3.5 h-3.5 mr-1 text-[#3D87D3]" /> Edit Category Rules
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => deleteLeaveType(lt.id)}
                        className="text-xs font-bold cursor-pointer"
                        title="Remove leave type"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* REJECTION EXPLANATION MODAL */}
      <Modal isOpen={!!rejectModalTarget} onClose={() => setRejectModalTarget(null)} title="Provide Leave Rejection Explanation">
        <div className="space-y-4 text-xs">
          <p className="text-slate-600">
            Please provide a brief explanation for rejecting this leave filing. This notice will be visible on the employee's personal request log to maintain transparent team communication.
          </p>
          <textarea
            rows={3}
            value={rejectionReasonInput}
            onChange={e => setRejectionReasonInput(e.target.value)}
            placeholder="e.g. Overlapping absences during critical production sprint, please propose alternative dates..."
            className="w-full bg-white border border-slate-200 rounded-xl p-3 text-slate-800 placeholder:text-slate-400 font-medium"
          />
          <div className="flex justify-end space-x-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setRejectModalTarget(null)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleConfirmReject} className="font-black">Confirm Rejection &rarr;</Button>
          </div>
        </div>
      </Modal>

      {/* ADMIN POST-APPROVAL EDITOR & MODIFICATION MODAL */}
      <Modal isOpen={!!editingLeave} onClose={() => setEditingLeave(null)} title="Admin Post-Approval Modification / Early Return">
        {editingLeave && (
          <form onSubmit={handleSaveAdminEdit} className="space-y-4 text-xs">
            <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 font-medium flex items-center justify-between">
              <span>Current Status: <strong className="font-black">{editingLeave.status.toUpperCase()}</strong></span>
              <span>ΕΡΓΑΝΗ Filing: <strong className="font-mono">{editingLeave.ergani_status.toUpperCase()}</strong></span>
            </div>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Use this admin utility when reality diverges from plan (e.g., employee returned early on the 3rd day or vacation dates shifted). Adjusting days will atomically update the employee&apos;s annual quota balance.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">New Start Date</label>
                <input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-mono font-bold" />
              </div>
              <div>
                <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">New End Date / Early Return Date</label>
                <input type="date" value={editEndDate} onChange={e => setEditEndDate(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-mono font-bold" />
              </div>
            </div>
            <div>
              <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Updated Employee Notes (Optional)</label>
              <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Updated reason..." className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-medium" />
            </div>
            <div>
              <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Admin Modification Reason (Audit Log)</label>
              <input type="text" value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="e.g., Employee returned 2 days early due to project delivery..." className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-medium" required />
            </div>
            <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setEditingLeave(null)}>Cancel</Button>
              <Button variant="primary" size="sm" type="submit" className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-black">Save Adjustments &rarr;</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* MANDATORY LEAVE DECLARATION / EDIT MODAL */}
      <Modal isOpen={isMandatoryOpen} onClose={() => { setIsMandatoryOpen(false); setPreviewMode(false); setEditingMandatoryId(null); }} title={editingMandatoryId ? "Edit Mandatory Company Closure" : "Declare Mandatory Company Closure"}>
        <div className="space-y-4 text-xs">
          {!previewMode ? (
            <>
              <p className="text-slate-600 text-[11px]">
                {editingMandatoryId ? "Adjust dates or description for this company closure. Changes will immediately sync to all fanned-out employee leave records." : "Declare organization-wide breaks (e.g., August Summer Bridge). Orbit will automatically fan out this closure across all staff members, respecting individual schedules and part-time multipliers while skipping external contractor partners."}
              </p>
              <div>
                <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Closure Name / Description</label>
                <input type="text" value={mName} onChange={e => setMName(e.target.value)} placeholder="e.g. August Summer Bridge 2026" className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-bold" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Start Date</label>
                  <input type="date" value={mStart} onChange={e => setMStart(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-mono font-bold" />
                </div>
                <div>
                  <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">End Date</label>
                  <input type="date" value={mEnd} onChange={e => setMEnd(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-mono font-bold" />
                </div>
              </div>
              <div>
                <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Announcement Note</label>
                <textarea rows={2} value={mNote} onChange={e => setMNote(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-medium" />
              </div>
              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <Button variant="outline" size="sm" onClick={() => { setIsMandatoryOpen(false); setEditingMandatoryId(null); }}>Cancel</Button>
                {editingMandatoryId ? (
                  <Button variant="primary" size="sm" onClick={handlePublishMandatory} className="bg-emerald-600 hover:bg-emerald-500 font-black cursor-pointer">Save Changes &rarr;</Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => setPreviewMode(true)} className="bg-indigo-600 hover:bg-indigo-700 font-black cursor-pointer">Preview Fan-Out Impact &rarr;</Button>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-200/80 text-slate-800 flex items-center justify-between font-bold">
                <span>Previewing Fan-Out across StellarBlue Active Headcount</span>
                <Badge variant="info" className="font-extrabold">Ready to Publish</Badge>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 border border-slate-200 rounded-xl p-3 bg-slate-50">
                {profiles.filter(p => p.status === 'active').map(p => {
                  const isContractor = p.employment_type === 'contractor';
                  const isPartTime = p.employment_type === 'part_time';
                  const deductedDays = isContractor ? 0 : isPartTime ? 3 : 5;
                  
                  return (
                    <div key={p.id} className="p-3 rounded-xl bg-white border border-slate-200 flex items-center justify-between text-xs shadow-2xs">
                      <div className="flex items-center gap-2">
                        <ProfileAvatar photoUrl={p.photo_url} firstName={p.first_name} lastName={p.last_name} size="sm" />
                        <div>
                          <span className="font-extrabold text-slate-900">{p.first_name} {p.last_name}</span>
                          <span className="text-[10px] font-bold text-slate-500 ml-1.5">({p.employment_type.toUpperCase()})</span>
                        </div>
                      </div>
                      <div>
                        {isContractor ? (
                          <span className="text-slate-400 font-mono text-[11px]">Skipped (Contractor)</span>
                        ) : (
                          <span className="text-indigo-600 font-mono font-black">-{deductedDays} days deducted</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-950 text-[11px] font-medium flex items-center">
                <AlertTriangle className="w-4 h-4 text-amber-600 mr-2 shrink-0" />
                <span><strong>Policy reminder:</strong> If an employee has zero remaining balance, deduction still applies and balance becomes negative (flagged in admin reports, never blocked).</span>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewMode(false)}>&larr; Back to Edit</Button>
                <Button variant="primary" size="sm" onClick={handlePublishMandatory} className="bg-emerald-600 hover:bg-emerald-500 font-black">
                  Confirm &amp; Publish Mandatory Closure &rarr;
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* CREATE / EDIT LEAVE CATEGORY MODAL */}
      <Modal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} title={catEditingId ? "Edit Leave Category Rules" : "Create New Leave Category"}>
        <form onSubmit={handleSaveCategory} className="space-y-4 text-xs">
          <p className="text-slate-600 text-[11px]">
            Configure custom leave types available to employees. Set Greek terminology, calendar badge colors, notice guidelines, and whether taken days deplete annual holiday quotas.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">English Title</label>
              <input 
                type="text" 
                value={catNameEn} 
                onChange={e => setCatNameEn(e.target.value)} 
                placeholder="e.g. Study Leave" 
                required 
                className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-bold" 
              />
            </div>
            <div>
              <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Greek Title</label>
              <input 
                type="text" 
                value={catNameEl} 
                onChange={e => setCatNameEl(e.target.value)} 
                placeholder="e.g. Άδεια Εξετάσεων" 
                required 
                className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-bold" 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Category Code</label>
              <input 
                type="text" 
                value={catCode} 
                onChange={e => setCatCode(e.target.value)} 
                placeholder="study_leave" 
                required 
                className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-mono font-bold lowercase" 
              />
            </div>
            <div>
              <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Display Order</label>
              <input 
                type="number" 
                value={catSortOrder} 
                onChange={e => setCatSortOrder(Number(e.target.value))} 
                placeholder="10" 
                required 
                className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-mono font-bold" 
              />
            </div>
            <div>
              <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Badge &amp; Color</label>
              <div className="flex items-center space-x-2">
                <input 
                  type="color" 
                  value={catColour} 
                  onChange={e => setCatColour(e.target.value)} 
                  className="w-10 h-10 rounded-xl border border-slate-200 p-1 cursor-pointer shrink-0" 
                />
                <input 
                  type="text" 
                  value={catColour} 
                  onChange={e => setCatColour(e.target.value)} 
                  className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-mono uppercase font-bold" 
                />
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={catCountsBalance} 
                onChange={e => setCatCountsBalance(e.target.checked)} 
                className="w-4 h-4 rounded text-[#3D87D3] focus:ring-[#3D87D3] cursor-pointer" 
              />
              <div>
                <span className="font-bold text-slate-900 block text-sm">Duct from Annual Holiday Quota</span>
                <span className="text-[11px] text-slate-500 block">If checked, approved working days will subtract from employee&apos;s 2026 pool balance.</span>
              </div>
            </label>

            <label className="flex items-center space-x-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={catRequiresApp} 
                onChange={e => setCatRequiresApp(e.target.checked)} 
                className="w-4 h-4 rounded text-[#3D87D3] focus:ring-[#3D87D3] cursor-pointer" 
              />
              <div>
                <span className="font-bold text-slate-900 block text-sm">Requires Founder / Admin Approval</span>
                <span className="text-[11px] text-slate-500 block">If unchecked, employee applications enter directly as approved records.</span>
              </div>
            </label>

            <label className="flex items-center space-x-3 cursor-pointer pt-2 border-t border-slate-200">
              <input 
                type="checkbox" 
                checked={catIsHidden} 
                onChange={e => setCatIsHidden(e.target.checked)} 
                className="w-4 h-4 rounded text-[#3D87D3] focus:ring-[#3D87D3] cursor-pointer" 
              />
              <div>
                <span className="font-bold text-slate-900 block text-sm">Hide from New Leave Requests (Archive / Disable)</span>
                <span className="text-[11px] text-slate-500 block">If checked, employees cannot pick this category for new requests, but existing leave records under this category remain visible as usual.</span>
              </div>
            </label>
          </div>

          <div>
            <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">
              Minimum Advance Notice Requirement: <strong className="text-[#3D87D3] font-mono">{catMinNotice} Days</strong>
            </label>
            <input 
              type="range" 
              min="0" 
              max="30" 
              value={catMinNotice} 
              onChange={e => setCatMinNotice(Number(e.target.value))} 
              className="w-full cursor-pointer accent-[#3D87D3]" 
            />
            <span className="text-[11px] text-slate-400 block mt-1">
              {catMinNotice === 0 ? "0 Days allows instant and retroactive reporting (e.g. Sick Leave)." : `Employees cannot apply for dates sooner than ${catMinNotice} working days in advance.`}
            </span>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsCategoryModalOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-black">
              {catEditingId ? "Save Category Changes" : "Create Leave Category"} &rarr;
            </Button>
          </div>
        </form>
      </Modal>

      {/* ADMIN RECORD EMPLOYEE LEAVE MODAL */}
      <Modal isOpen={isAddEmployeeLeaveOpen} onClose={() => setIsAddEmployeeLeaveOpen(false)} title="Record Leave for Employee">
        <form onSubmit={handleAddEmployeeLeave} className="space-y-4 text-xs">
          <p className="text-slate-600 text-[11px]">
            As an Administrator, you can directly record approved time-off or past vacation days for any staff member in Orbit.
          </p>
          <div>
            <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Select Employee</label>
            <select
              value={addEmpId || (profiles[0]?.id || '')}
              onChange={e => setAddEmpId(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-bold shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name} ({p.work_email} - {p.employment_type.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Leave Category / Type</label>
            <select
              value={addEmpLeaveTypeId || (leaveTypes.find(t => !t.is_hidden)?.id || leaveTypes[0]?.id || '')}
              onChange={e => setAddEmpLeaveTypeId(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-bold shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
            >
              {leaveTypes.filter(lt => !lt.is_hidden || lt.id === addEmpLeaveTypeId).map(lt => (
                <option key={lt.id} value={lt.id}>
                  {lt.name_en} ({lt.name_el})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Leave Period (Start → End)</label>
            <DateRangePicker
              start={addEmpStart}
              end={addEmpEnd}
              onChange={(s, e) => { setAddEmpStart(s); setAddEmpEnd(e); }}
            />
          </div>

          <div className="p-3.5 rounded-xl bg-[#3D87D3]/10 border border-[#3D87D3]/20 flex items-center justify-between text-xs text-slate-800 font-medium">
            <span>Calculated Working Days (Excluding Weekends &amp; Greek Holidays):</span>
            <span className="text-base font-black text-[#3D87D3] font-mono">{addEmpCalculatedDays} Days</span>
          </div>

          <div>
            <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Record Status</label>
            <select
              value={addEmpStatus}
              onChange={e => setAddEmpStatus(e.target.value as any)}
              className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-bold shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
            >
              <option value="approved">Approved (Active schedule record)</option>
              <option value="taken">Taken (Past historical record)</option>
              <option value="pending">Pending (Requires further review)</option>
            </select>
          </div>

          <div>
            <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Note / Memo (Optional)</label>
            <textarea
              rows={2}
              value={addEmpNote}
              onChange={e => setAddEmpNote(e.target.value)}
              placeholder="e.g. Added by HR, medical leave documentation filed..."
              className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 font-medium placeholder:text-slate-400"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsAddEmployeeLeaveOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-black cursor-pointer">
              Save Employee Leave Record &rarr;
            </Button>
          </div>
        </form>
      </Modal>

      {/* Deducted Days Export Modal */}
      <Modal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} title="Export Deducted Leave Days (XLSX)">
        <div className="space-y-4 pt-2 text-xs">
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 leading-relaxed font-medium">
            <span className="font-bold flex items-center mb-1">
              <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600 inline shrink-0" /> Official Payroll &amp; HR Leave Export
            </span>
            Export a complete Excel ledger of deducted working days (regular leave + mandatory company closures), either company-wide for all employees or per individual employee. Pick the period, status and employee filters below — the ledger sheet is grouped per employee.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-extrabold text-slate-700 uppercase tracking-wider text-[11px] mb-1.5">Target Year</label>
              <select
                value={exportYear}
                onChange={e => setExportYear(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-slate-800 font-extrabold text-xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/40"
              >
                {[2024, 2025, 2026, 2027].map(yr => (
                  <option key={yr} value={yr}>{yr} Report Cycle</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-extrabold text-slate-700 uppercase tracking-wider text-[11px] mb-1.5">Leaves To Include (Period)</label>
              <select
                value={exportPeriod}
                onChange={e => setExportPeriod(e.target.value as LeaveExportPeriod)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-slate-800 font-extrabold text-xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/40"
              >
                <option value="full_year">🗓️ Whole year ({exportYear})</option>
                <option value="ytd">⏱️ Year to date (01/01 → today)</option>
                <option value="month">📅 Single month…</option>
              </select>
            </div>

            {exportPeriod === 'month' && (
              <div>
                <label className="block font-extrabold text-slate-700 uppercase tracking-wider text-[11px] mb-1.5">Month</label>
                <select
                  value={exportMonth}
                  onChange={e => setExportMonth(Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-slate-800 font-extrabold text-xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/40"
                >
                  {LEAVE_EXPORT_MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m} {exportYear}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-extrabold text-slate-700 uppercase tracking-wider text-[11px] mb-1.5">Leave Status</label>
              <select
                value={exportApprovedOnly ? 'approved' : 'all'}
                onChange={e => setExportApprovedOnly(e.target.value === 'approved')}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-slate-800 font-extrabold text-xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/40"
              >
                <option value="all">📋 All statuses (incl. pending &amp; rejected)</option>
                <option value="approved">✅ Approved &amp; deducted leaves only</option>
              </select>
            </div>

            <div>
              <label className="block font-extrabold text-slate-700 uppercase tracking-wider text-[11px] mb-1.5">Employees</label>
              <select
                value={exportActiveOnly ? 'active' : 'all'}
                onChange={e => setExportActiveOnly(e.target.value === 'active')}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-slate-800 font-extrabold text-xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/40"
              >
                <option value="all">👥 All employees (incl. departed)</option>
                <option value="active">🟢 Active employees only</option>
              </select>
            </div>

            <div>
              <label className="block font-extrabold text-slate-700 uppercase tracking-wider text-[11px] mb-1.5">Employee Scope</label>
              <select
                value={exportScope}
                onChange={e => setExportScope(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-slate-800 font-extrabold text-xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/40"
              >
                <option value="all">🌟 All Employees (Company-Wide &amp; Ledger)</option>
                {profiles
                  .filter(p => p.employment_type !== 'contractor' || p.status === 'active')
                  .sort((a, b) => a.last_name.localeCompare(b.last_name))
                  .map(p => (
                    <option key={p.id} value={p.id}>{p.last_name} {p.first_name} ({p.role})</option>
                  ))}
              </select>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 font-medium leading-relaxed">
            <span className="font-extrabold text-slate-800">{leaveExportScopeLabel(exportFilters)}</span>
            {' — '}
            {exportScope === 'all'
              ? `${exportLeaves.length} leave record(s) across ${groupLeavesByEmployee(exportLeaves, profiles).length} employee(s) will be exported (grouped per employee), plus the annual balance summary.`
              : `${exportLeaves.filter(r => r.profile_id === exportScope).length} leave record(s) for the selected employee will be exported.`}
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2">
            <Button variant="outline" size="sm" onClick={() => setIsExportModalOpen(false)} className="cursor-pointer font-bold">
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleExportDeductedDays}
              className="bg-emerald-600 hover:bg-emerald-500 font-black px-5 py-2 shadow-sm text-xs cursor-pointer flex items-center gap-2"
            >
              <Download className="w-4 h-4" /> Generate &amp; Download XLSX
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
