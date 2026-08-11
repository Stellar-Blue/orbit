"use client";

import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Calendar, Plus, Clock, CheckCircle2, XCircle, AlertTriangle, 
  Users, ShieldCheck, FileText, Sparkles, Filter, Edit3, HelpCircle, ArrowRight, ShieldAlert,
  BarChart3, CalendarDays, Briefcase, ChevronLeft, ChevronRight, Table, Download, Trash2
} from 'lucide-react';
import { parseISO, format, eachDayOfInterval, addDays, isAfter, isBefore, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, isSameMonth, isSameDay } from 'date-fns';
import * as XLSX from 'xlsx';
import { LeaveRequest } from '@/lib/types';
import { DateRangePicker } from '@/components/leave/date-range-picker';

const LeaveGrid = dynamic(() => import('@/components/leave/leave-grid').then(m => m.LeaveGrid), { ssr: false });

export default function LeaveManagementPage() {
  const { 
    currentUser, profiles, leaveTypes, 
    leaveRequests, mandatoryLeaves, publicHolidays, 
    requestLeaveCancellation, splitAndAddLeaveRequest,
    updateLeaveRequestStatus, getEmployeeLeaveBalance, deleteLeaveRequest
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';
  const isContractor = currentUser.employment_type === 'contractor';

  // Interactive Calendar State in My Leaves tab
  const [calendarMonth, setCalendarMonth] = useState(() => new Date('2026-08-01T00:00:00'));
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragCurrent, setDragCurrent] = useState<string | null>(null);

  const handleDayMouseDown = (dayStr: string) => {
    setIsDragging(true);
    setDragStart(dayStr);
    setDragCurrent(dayStr);
  };

  const handleDayMouseEnter = (dayStr: string) => {
    if (isDragging && dragStart) {
      setDragCurrent(dayStr);
    }
  };

  const handleCalendarMouseUp = () => {
    if (isDragging && dragStart && dragCurrent) {
      setIsDragging(false);
      const s = isBefore(parseISO(dragStart), parseISO(dragCurrent)) ? dragStart : dragCurrent;
      const e = isBefore(parseISO(dragStart), parseISO(dragCurrent)) ? dragCurrent : dragStart;
      setStartDate(s);
      setEndDate(e);
      setDragStart(null);
      setDragCurrent(null);
      setIsRequestOpen(true);
    }
  };

  const isSelectedDuringDrag = (dayStr: string) => {
    if (!isDragging || !dragStart || !dragCurrent) return false;
    const s = isBefore(parseISO(dragStart), parseISO(dragCurrent)) ? dragStart : dragCurrent;
    const e = isBefore(parseISO(dragStart), parseISO(dragCurrent)) ? dragCurrent : dragStart;
    return (dayStr === s || dayStr === e || (isAfter(parseISO(dayStr), parseISO(s)) && isBefore(parseISO(dayStr), parseISO(e))));
  };

  // New Leave Request State (< 30s filing)
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [reqType, setReqType] = useState(() => leaveTypes.find(lt => !lt.is_hidden)?.id || leaveTypes[0]?.id || 'lt-annual');
  const [startDate, setStartDate] = useState('2026-09-14');
  const [endDate, setEndDate] = useState('2026-09-18');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (leaveTypes.length > 0 && (!reqType || reqType === 'lt-annual' || !leaveTypes.some(lt => lt.id === reqType))) {
      const valid = leaveTypes.find(lt => !lt.is_hidden && (lt.code === 'annual' || (lt.name_en && lt.name_en.toLowerCase().includes('annual')))) || leaveTypes.find(lt => !lt.is_hidden) || leaveTypes[0];
      if (valid) setReqType(valid.id);
    }
  }, [leaveTypes, reqType]);

  // Calculate working days excluding Greek holidays and weekends for an individual schedule
  const calculateWorkingDays = (startStr: string, endStr: string, schedule: string[], targetProfileId: string = currentUser.id) => {
    try {
      const days = eachDayOfInterval({ start: parseISO(startStr), end: parseISO(endStr) });
      let count = 0;
      days.forEach(d => {
        const dayStr = format(d, 'yyyy-MM-dd');
        const dayOfWeek = format(d, 'EEE'); // Mon, Tue, etc.
        const isHoliday = publicHolidays.some(h => h.date === dayStr);
        const isMandatory = mandatoryLeaves.some(m => dayStr >= m.start_date && dayStr <= m.end_date) ||
                            leaveRequests.some(r => r.origin === 'mandatory' && r.profile_id === targetProfileId && dayStr >= r.start_date && dayStr <= r.end_date);
        if (!isHoliday && !isMandatory && schedule.includes(dayOfWeek)) {
          count++;
        }
      });
      return count;
    } catch {
      return 0;
    }
  };

  const getEffectiveDays = (r: LeaveRequest) => {
    if (r.origin === 'mandatory') return Number(r.working_days || 0);
    const targetProfile = profiles.find(p => p.id === r.profile_id);
    const calc = calculateWorkingDays(r.start_date, r.end_date, targetProfile?.work_schedule || currentUser.work_schedule, r.profile_id);
    return Math.min(Number(r.working_days || 0), calc);
  };

  const currentWorkingDays = useMemo(() => {
    return calculateWorkingDays(startDate, endDate, currentUser.work_schedule);
  }, [startDate, endDate, currentUser, publicHolidays, mandatoryLeaves, leaveRequests]);

  const selectedLeaveType = useMemo(() => {
    return leaveTypes.find(t => t.id === reqType) || leaveTypes[0];
  }, [reqType, leaveTypes]);

  const currentYear = new Date(startDate).getFullYear() || 2026;
  const myBalance = useMemo(() => {
    return getEmployeeLeaveBalance(currentUser.id, currentYear);
  }, [currentUser.id, currentYear, getEmployeeLeaveBalance, leaveRequests]);

  // Earliest valid start date based on min_notice_days (§3)
  const minNoticeDays = selectedLeaveType?.min_notice_days ?? 7;
  const todayStr = format(new Date(), 'yyyy-MM-dd'); // Current local reference date
  const earliestValidDate = useMemo(() => {
    if (minNoticeDays === 0) return '2026-01-01';
    return format(addDays(parseISO(todayStr), minNoticeDays), 'yyyy-MM-dd');
  }, [minNoticeDays]);

  const handleCreateRequest = (e: React.FormEvent) => {
    e.preventDefault();
    // 1. Zero-working-day guard (§5)
    if (currentWorkingDays === 0) {
      alert('VALIDATION ERROR: Your selected date range contains 0 working days against your schedule and Greek public holidays.');
      return;
    }

    // 2. Overlap prevention (§5)
    const hasOverlap = leaveRequests.some(r => {
      if (r.profile_id !== currentUser.id) return false;
      if (r.origin === 'mandatory') return false; // Do not block regular leave when spanning over mandatory closure!
      if (['rejected', 'cancelled', 'expired'].includes(r.status)) return false;
      return !(isBefore(parseISO(endDate), parseISO(r.start_date)) || isAfter(parseISO(startDate), parseISO(r.end_date)));
    });
    if (hasOverlap) {
      alert('VALIDATION ERROR: This leave request overlaps with another active or pending request in your register.');
      return;
    }

    // 3. Minimum notice rule check (§3)
    if (!isAdmin && minNoticeDays > 0 && startDate < earliestValidDate) {
      alert(`NOTICE RULE ERROR: ${selectedLeaveType.name_en} requires at least ${minNoticeDays} days advance notice (earliest selectable start date is ${earliestValidDate}).`);
      return;
    }

    // 4. Balance check (§5)
    if (!isAdmin && selectedLeaveType.counts_against_balance !== false && currentWorkingDays > myBalance.available) {
      alert(`INSUFFICIENT BALANCE ERROR: Request exceeds your available balance (${myBalance.available} days available).`);
      return;
    }

    // Year-boundary automatic splitting or standard submission (§5)
    splitAndAddLeaveRequest({
      profile_id: currentUser.id,
      leave_type_id: selectedLeaveType?.id || reqType,
      start_date: startDate,
      end_date: endDate,
      half_day_start: false,
      half_day_end: false,
      working_days: currentWorkingDays,
      status: isAdmin ? 'approved' : 'pending',
      origin: isAdmin ? 'admin_entry' : 'employee_request',
      note: note.trim() || `${selectedLeaveType.name_en} Request`,
      ergani_status: 'pending'
    }, currentUser.work_schedule, publicHolidays);

    setIsRequestOpen(false);
    notifySuccess('Leave request submitted.');
  };

  // Grid View & Export state
  const [viewMode, setViewMode] = useState<'calendar' | 'grid'>('calendar');
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportTargetYear, setExportTargetYear] = useState<number>(() => new Date().getFullYear() || 2026);
  const [exportScope, setExportScope] = useState<string>('me');

  const exportYearBalance = useMemo(() => {
    return getEmployeeLeaveBalance(currentUser.id, selectedYear);
  }, [currentUser.id, selectedYear, getEmployeeLeaveBalance, leaveRequests]);

  const exportYearLeaves = useMemo(() => {
    return leaveRequests.filter(r => 
      r.profile_id === currentUser.id && r.start_date.startsWith(String(selectedYear))
    ).sort((a, b) => b.start_date.localeCompare(a.start_date));
  }, [leaveRequests, currentUser.id, selectedYear]);

  const handleConfirmExport = () => {
    const targetLeaves = leaveRequests.filter(r => {
      const startYr = new Date(r.start_date).getFullYear();
      const endYr = new Date(r.end_date).getFullYear();
      return startYr === exportTargetYear || endYr === exportTargetYear;
    });

    const wb = XLSX.utils.book_new();

    if (exportScope === 'all') {
      // Company-Wide Summary
      const summaryData: (string | number)[][] = [
        ['STELLARBLUE ORBIT — COMPANY-WIDE DEDUCTED LEAVE DAYS REPORT'],
        ['Report Year:', String(exportTargetYear)],
        ['Generated On:', new Date().toLocaleDateString('en-GB')],
        [''],
        ['Employee Name', 'Work Email', 'Employment Type', 'Total Allowance Quota', 'Regular Deducted (Days)', 'Mandatory Closure (Days)', 'Total Deducted Days', 'Remaining Available Balance']
      ];

      profiles.forEach(p => {
        const bal = getEmployeeLeaveBalance(p.id, exportTargetYear);
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

      // Detailed Deductions Ledger
      const detailData: (string | number)[][] = [
        ['STELLARBLUE ORBIT — DETAILED DEDUCTIONS LEDGER (ALL EMPLOYEES)'],
        ['Report Year:', String(exportTargetYear)],
        [''],
        ['Employee Name', 'Work Email', 'Start Date', 'End Date', 'Leave Category / Type', 'Deducted Working Days', 'Status', 'Origin', 'Note / Reason']
      ];

      targetLeaves
        .sort((a, b) => b.start_date.localeCompare(a.start_date))
        .forEach(req => {
          const emp = profiles.find(p => p.id === req.profile_id);
          const lt = leaveTypes.find(t => t.id === req.leave_type_id);
          const catName = lt ? (lt.name_en || lt.name_el) : (req.origin === 'mandatory' ? 'Mandatory Company Closure' : 'Regular Leave');
          detailData.push([
            emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown Employee',
            emp?.work_email || '',
            req.start_date,
            req.end_date,
            catName,
            Number(req.working_days || 0),
            req.status.toUpperCase(),
            req.origin.toUpperCase(),
            req.note || 'Standard absence record'
          ]);
        });

      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      const wsDetail = XLSX.utils.aoa_to_sheet(detailData);
      XLSX.utils.book_append_sheet(wb, wsSummary, `Summary_${exportTargetYear}`);
      XLSX.utils.book_append_sheet(wb, wsDetail, `Detailed_Ledger_${exportTargetYear}`);
      XLSX.writeFile(wb, `StellarBlue_Deducted_Leaves_Company_${exportTargetYear}.xlsx`);
    } else {
      const targetProfileId = exportScope === 'me' ? currentUser.id : exportScope;
      const targetEmp = profiles.find(p => p.id === targetProfileId) || currentUser;
      const targetBalance = getEmployeeLeaveBalance(targetProfileId, exportTargetYear);
      const empLeaves = targetLeaves.filter(r => r.profile_id === targetProfileId);
      const totalDeducted = targetBalance.taken + targetBalance.mandatory;

      const wsData: (string | number)[][] = [
        ['STELLARBLUE ORBIT — OFFICIAL ANNUAL LEAVE & DEDUCTIONS REPORT'],
        [''],
        ['Employee Name:', `${targetEmp.first_name} ${targetEmp.last_name}`],
        ['Work Email:', targetEmp.work_email || ''],
        ['Report Year:', String(exportTargetYear)],
        ['Total Annual Allowance Quota:', `${targetBalance.entitlement + targetBalance.carryOver} working days`],
        ['Regular Deducted Days:', `${targetBalance.taken} working days`],
        ['Mandatory Closure Deducted Days:', `${targetBalance.mandatory} working days`],
        ['TOTAL DEDUCTED LEAVE DAYS:', `${totalDeducted} working days`],
        ['AVAILABLE / REMAINING LEAVES:', `${targetBalance.available} working days`],
        [''],
        ['START DATE', 'END DATE', 'LEAVE CATEGORY / TYPE', 'WORKING DAYS DEDUCTED', 'STATUS', 'ORIGIN', 'MEMO & REASON']
      ];

      if (empLeaves.length === 0) {
        wsData.push(['No recorded leave deductions for selected year', '', '', '', '', '', '']);
      } else {
        empLeaves.forEach(req => {
          const lt = leaveTypes.find(t => t.id === req.leave_type_id);
          const effDays = getEffectiveDays(req);
          wsData.push([
            req.start_date,
            req.end_date,
            lt?.name_en || (req.origin === 'mandatory' ? 'Mandatory Company Closure' : 'Regular Leave'),
            `${effDays}d`,
            req.status.toUpperCase(),
            req.origin.toUpperCase(),
            req.note || 'Standard time off'
          ]);
        });
      }

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, `Leave_Report_${exportTargetYear}`);
      XLSX.writeFile(wb, `Leave_Report_${targetEmp.last_name}_${exportTargetYear}.xlsx`);
    }

    setIsExportModalOpen(false);
  };

  if (isContractor) {
    return (
      <div className="p-10 text-center bg-slate-50 border border-slate-200 rounded-2xl max-w-xl mx-auto my-12 space-y-3 shadow-xs">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-600" />
        <h2 className="text-xl font-bold text-slate-800">Module Hidden for Contractors</h2>
        <p className="text-xs text-slate-600">
          Under Greek labour law and StellarBlue operational policy, independent contractors (μπλοκάκι) do not accrue leave balances or file leave requests.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center">
            <Calendar className="w-6 h-6 mr-3 text-[#3D87D3]" /> Personal Leave Management &amp; Quota Balance
          </h1>
          <p className="text-slate-500 text-xs mt-1 font-medium">
            Review your annual leave allowance, explore holiday dates, and click-and-drag directly on the calendar to file new requests.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="primary" size="sm" onClick={() => setIsRequestOpen(true)} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 shadow-xs cursor-pointer font-black px-4 py-2">
            <Plus className="w-4 h-4 mr-1.5" /> File Leave Request
          </Button>
        </div>
      </div>

      {/* MY LEAVES DASHBOARD CONTENT */}
      <div className="space-y-6 animate-in fade-in duration-200">
        {/* ULTRA-COMPACT TOP RIBBON: BALANCE & NEXT SCHEDULED HOLIDAY */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* COMPACT BALANCE EQUATION BAR (7 COLS) */}
            <div className="lg:col-span-7 p-4 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-sm border border-slate-700 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-sky-400 shrink-0" />
                  <span className="text-xs font-extrabold tracking-wider uppercase text-slate-200">2026 Leave Pool Balance</span>
                </div>
                <span className="px-3 py-1 rounded-full bg-emerald-500 text-white font-black text-xs font-mono shadow-xs shrink-0">
                  {myBalance.available} Days Available
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2.5 mt-2.5 border-t border-white/10 text-[11px]">
                <span className="px-2 py-0.5 rounded bg-white/10 text-white font-mono font-bold">Annual: {myBalance.entitlement}d</span>
                <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono font-bold border border-sky-500/30">+{myBalance.carryOver}d Carryover</span>
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/30">−{myBalance.taken}d Taken</span>
                <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono font-bold border border-purple-500/30">−{myBalance.reserved}d Pending</span>
                <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-bold border border-indigo-500/30">−{myBalance.mandatory}d Mandatory</span>
              </div>
            </div>

            {/* COMPACT UPCOMING HOLIDAY BAR (5 COLS) */}
            <div className="lg:col-span-5 flex">
              {(() => {
                const myApprovedFuture = leaveRequests
                  .filter(r => r.profile_id === currentUser.id && (r.status === 'approved' || r.status === 'in_progress') && isAfter(parseISO(r.end_date), parseISO('2026-07-30')))
                  .sort((a, b) => a.start_date.localeCompare(b.start_date));

                if (myApprovedFuture.length > 0) {
                  const nextLeave = myApprovedFuture[0];
                  const lt = leaveTypes.find(t => t.id === nextLeave.leave_type_id);
                  return (
                    <div className="w-full p-4 rounded-xl bg-gradient-to-r from-emerald-900 to-teal-800 text-white shadow-sm border border-emerald-700/80 flex flex-col justify-between">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-300 flex items-center">
                          <CalendarDays className="w-3.5 h-3.5 mr-1.5 shrink-0" /> Next Holiday
                        </span>
                        <Badge variant="success" className="bg-emerald-500/40 text-white border-emerald-300/60 text-[10px] py-0.5 px-2 font-black shadow-2xs shrink-0">
                          Confirmed
                        </Badge>
                      </div>
                      <div className="mt-2 pt-2 border-t border-white/10">
                        <h4 className="text-xs font-black text-white truncate">{lt?.name_en || 'Scheduled Leave'} &bull; <span className="font-mono text-emerald-200">{nextLeave.start_date} → {nextLeave.end_date}</span></h4>
                        <p className="text-[11px] text-emerald-100/90 mt-0.5 font-medium truncate">{nextLeave.working_days}d deduction {nextLeave.note ? `— "${nextLeave.note}"` : ''}</p>
                      </div>
                    </div>
                  );
                } else {
                  return (
                    <div className="w-full p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-2xs flex flex-col justify-between">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-extrabold text-slate-800 flex items-center">
                          <Sparkles className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3] shrink-0" /> No upcoming holiday
                        </span>
                        <Button variant="primary" size="sm" onClick={() => setIsRequestOpen(true)} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-[11px] font-extrabold py-1 px-2.5 rounded-lg shadow-2xs cursor-pointer shrink-0">
                          <Plus className="w-3 h-3 mr-1" /> Plan Now
                        </Button>
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-200/80">
                        <p className="text-[11px] text-slate-500 font-medium">You have <strong className="text-slate-800 font-extrabold">{myBalance.available} available vacation days</strong> remaining. Select dates on the grid below!</p>
                      </div>
                    </div>
                  );
                }
              })()}
            </div>
          </div>

          {/* TWO-COLUMN LAYOUT: CALENDAR ON LEFT, QUOTAS & HISTORY ON RIGHT */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: INTERACTIVE LEAVE CALENDAR (7 COLS) */}
            <div className="lg:col-span-7 space-y-5" onMouseUp={handleCalendarMouseUp} onMouseLeave={() => { if (isDragging) { setIsDragging(false); setDragStart(null); setDragCurrent(null); } }}>
              {/* View Switcher & Year Export Top Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
                <div className="flex items-center space-x-1.5 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setViewMode('calendar')}
                    className={`px-3.5 py-1.5 rounded-lg font-bold text-xs flex items-center transition-all cursor-pointer ${
                      viewMode === 'calendar' ? 'bg-[#3D87D3] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5 mr-1.5" /> Calendar View
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={`px-3.5 py-1.5 rounded-lg font-bold text-xs flex items-center transition-all cursor-pointer ${
                      viewMode === 'grid' ? 'bg-[#3D87D3] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Table className="w-3.5 h-3.5 mr-1.5" /> Grid View
                  </button>
                </div>

                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsExportModalOpen(true)}
                    className="bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 font-extrabold text-xs shadow-2xs py-1.5 px-3.5 cursor-pointer flex items-center"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5 text-emerald-600 shrink-0" /> Export leaves
                  </Button>
                </div>
              </div>

              {viewMode === 'calendar' ? (
                <Card 
                  title="Leave Schedule & Holiday Calendar" 
                subtitle="Click & drag across dates on the grid below to instantly select your vacation days and apply."
                className="border-slate-200 shadow-sm"
              >
                <div className="space-y-3 mt-2">
                  {/* Calendar Navigation Header & Legend */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/80 shadow-2xs gap-3">
                    <div className="flex items-center space-x-2 shrink-0">
                      <div className="flex items-center rounded-xl border border-slate-300 overflow-hidden bg-white shadow-2xs">
                        <button
                          onClick={() => setCalendarMonth(prev => subMonths(prev, 1))}
                          className="p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-950 transition-all cursor-pointer"
                          title="Previous Month"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="px-5 py-1 text-sm font-extrabold text-slate-800 font-mono tracking-tight select-none">
                          {format(calendarMonth, 'MMMM yyyy')}
                        </span>
                        <button
                          onClick={() => setCalendarMonth(prev => addMonths(prev, 1))}
                          className="p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-950 transition-all cursor-pointer"
                          title="Next Month"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                      <button
                        onClick={() => setCalendarMonth(startOfMonth(new Date()))}
                        className="px-3 py-1.5 rounded-xl border border-indigo-200 text-xs font-bold text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 transition-all cursor-pointer shadow-2xs"
                      >
                        Today ({format(new Date(), 'MMMM yyyy')})
                      </button>
                    </div>

                    <div className="flex items-center gap-3.5 text-[11px] font-bold text-slate-600 flex-wrap">
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-[#3D87D3] mr-1.5 inline-block shadow-2xs" /> My Leaves</span>
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-indigo-700 mr-1.5 inline-block shadow-2xs" /> Mandatory Closure</span>
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 mr-1.5 inline-block shadow-2xs" /> Holiday</span>
                    </div>
                  </div>

                  {/* Day of Week Headers with Mobile Swipe Support */}
                  <div className="overflow-x-auto mt-2 pb-1">
                    <div className="min-w-[750px] w-full">
                      <div className="grid grid-cols-7 border-t border-b border-slate-200 bg-slate-50/80 text-center text-xs font-extrabold text-slate-600 uppercase tracking-wider py-3 rounded-t-xl">
                        <div>Monday</div>
                    <div>Tuesday</div>
                    <div>Wednesday</div>
                    <div>Thursday</div>
                    <div>Friday</div>
                    <div className="text-rose-600 font-black">Saturday</div>
                    <div className="text-rose-600 font-black">Sunday</div>
                  </div>

                  {/* Date Grid - Solid Multi-Day Spanning Week-Row Architecture */}
                  <div className="flex flex-col bg-slate-200/20 rounded-b-xl overflow-hidden border-l border-r border-b border-slate-200/80 select-none">
                    {(() => {
                      const gridStart = startOfWeek(startOfMonth(calendarMonth), { weekStartsOn: 1 });
                      const gridEnd = endOfWeek(endOfMonth(calendarMonth), { weekStartsOn: 1 });
                      const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

                      const weeks: Date[][] = [];
                      for (let i = 0; i < days.length; i += 7) {
                        weeks.push(days.slice(i, i + 7));
                      }

                      return weeks.map((weekDays, wIdx) => {
                        const weekStartStr = format(weekDays[0], 'yyyy-MM-dd');
                        const weekEndStr = format(weekDays[6], 'yyyy-MM-dd');

                        // Collect unique events that overlap this week
                        const weekHolidays = publicHolidays.filter(h => h.date >= weekStartStr && h.date <= weekEndStr);
                        const weekMandatory = mandatoryLeaves.filter(m => !(m.end_date < weekStartStr || m.start_date > weekEndStr));
                        const weekMyLeaves = leaveRequests.filter(r => 
                          r.profile_id === currentUser.id && 
                          r.origin !== 'mandatory' && 
                          !['cancelled', 'rejected', 'expired'].includes(r.status) &&
                          !(r.end_date < weekStartStr || r.start_date > weekEndStr)
                        );

                        return (
                          <div key={wIdx} className="relative min-h-[135px] border-b border-slate-200/80 last:border-b-0 flex flex-col">
                            {/* Layer 1: Background Interactive Day Grid */}
                            <div className="absolute inset-0 grid grid-cols-7 divide-x divide-slate-200/80 pointer-events-auto">
                              {weekDays.map(d => {
                                const dayStr = format(d, 'yyyy-MM-dd');
                                const isCurrentMonth = isSameMonth(d, calendarMonth);
                                const isSelected = isSelectedDuringDrag(dayStr);
                                const isDayToday = isSameDay(d, new Date());
                                const isWeekend = format(d, 'EEE') === 'Sat' || format(d, 'EEE') === 'Sun';

                                return (
                                  <div
                                    key={dayStr}
                                    onMouseDown={() => handleDayMouseDown(dayStr)}
                                    onMouseEnter={() => handleDayMouseEnter(dayStr)}
                                    className={`h-full transition-colors cursor-pointer ${
                                      isSelected
                                        ? 'bg-[#3D87D3]/20 ring-2 ring-inset ring-[#3D87D3] shadow-inner'
                                        : !isCurrentMonth
                                          ? 'bg-slate-50/70 opacity-75'
                                          : isDayToday
                                            ? 'bg-blue-50/40 ring-2 ring-inset ring-[#3D87D3]'
                                            : isWeekend ? 'bg-slate-50/40 hover:bg-slate-100/70' : 'bg-white hover:bg-slate-50/90'
                                    }`}
                                  />
                                );
                              })}
                            </div>

                            {/* Layer 2: Foreground Content (Dates & Solid Spanning Banners) */}
                            <div className="relative z-10 pointer-events-none pb-2 flex flex-col justify-start">
                              {/* Date Numeral Header */}
                              <div className="grid grid-cols-7 pt-1 px-1 mb-1">
                                {weekDays.map(d => {
                                  const dayStr = format(d, 'yyyy-MM-dd');
                                  const isCurrentMonth = isSameMonth(d, calendarMonth);
                                  const isDayToday = isSameDay(d, new Date());
                                  const isWeekend = format(d, 'EEE') === 'Sat' || format(d, 'EEE') === 'Sun';

                                  return (
                                    <div key={dayStr} className="flex items-center justify-between px-1 h-6">
                                      <div className="flex items-center space-x-1">
                                      </div>
                                      <span
                                        className={`text-xs font-mono font-bold w-6 h-6 flex items-center justify-center rounded-full transition-colors ${
                                          isDayToday
                                            ? 'bg-[#3D87D3] text-white font-black shadow-sm'
                                            : isCurrentMonth
                                              ? (isWeekend ? 'text-rose-600 font-extrabold' : 'text-slate-800 font-extrabold')
                                              : 'text-slate-400'
                                        }`}
                                      >
                                        {format(d, 'd')}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Spanning Event Tracks */}
                              <div className="space-y-1 flex flex-col">
                                {/* Public Holidays */}
                                {weekHolidays.map(h => {
                                  const startCol = weekDays.findIndex(d => format(d, 'yyyy-MM-dd') === h.date) + 1;
                                  return (
                                    <div key={`hol-${h.date}`} className="grid grid-cols-7 px-1 pointer-events-auto">
                                      <div 
                                        style={{ gridColumn: `${startCol} / span 1` }} 
                                        className="py-1 px-2 rounded-lg bg-rose-50 text-rose-900 border border-rose-200/80 text-[10px] font-extrabold truncate shadow-2xs flex items-center" 
                                        title={h.name_en}
                                      >
                                        <span className="mr-1">🔴</span>
                                        <span className="truncate">{h.name_en}</span>
                                      </div>
                                    </div>
                                  );
                                })}

                                {/* Mandatory Closures */}
                                {weekMandatory.map((m, mIdx) => {
                                  let startCol = 1;
                                  let endCol = 7;
                                  let isActualStart = false;
                                  let isActualEnd = false;

                                  if (m.start_date >= weekStartStr) {
                                    const idx = weekDays.findIndex(d => format(d, 'yyyy-MM-dd') >= m.start_date);
                                    if (idx !== -1) { startCol = idx + 1; isActualStart = true; }
                                  }
                                  if (m.end_date <= weekEndStr) {
                                    const idx = weekDays.findIndex(d => format(d, 'yyyy-MM-dd') >= m.end_date);
                                    if (idx !== -1) { endCol = idx + 1; isActualEnd = true; }
                                    else { endCol = weekDays.findIndex(d => format(d, 'yyyy-MM-dd') <= m.end_date) + 1; isActualEnd = true; }
                                  }
                                  const span = Math.max(1, endCol - startCol + 1);

                                  return (
                                    <div key={`m-${m.id || mIdx}`} className="grid grid-cols-7 px-1 pointer-events-auto">
                                      <div
                                        style={{ gridColumn: `${startCol} / span ${span}` }}
                                        className={`py-1.5 px-2.5 text-[11px] font-extrabold text-white shadow-xs flex items-center justify-between bg-purple-700 transition-transform hover:scale-[1.01] ${
                                          isActualStart && isActualEnd ? 'rounded-lg' :
                                          isActualStart ? 'rounded-l-lg rounded-r-none pr-1' :
                                          isActualEnd ? 'rounded-r-lg rounded-l-none pl-1' :
                                          'rounded-none px-1'
                                        }`}
                                        title={`Company Closure: ${m.start_date} → ${m.end_date}`}
                                      >
                                        <span className="truncate flex items-center font-black">
                                          <span className="mr-1.5">🔒</span>
                                          <span className="truncate">{'name' in m ? m.name : 'Company Closure'}</span>
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}

                                {/* Employee Leaves */}
                                {weekMyLeaves.map((req, rIdx) => {
                                  const lt = leaveTypes.find(t => t.id === req.leave_type_id);
                                  let startCol = 1;
                                  let endCol = 7;
                                  let isActualStart = false;
                                  let isActualEnd = false;

                                  if (req.start_date >= weekStartStr) {
                                    const idx = weekDays.findIndex(d => format(d, 'yyyy-MM-dd') === req.start_date);
                                    if (idx !== -1) { startCol = idx + 1; isActualStart = true; }
                                  }
                                  if (req.end_date <= weekEndStr) {
                                    const idx = weekDays.findIndex(d => format(d, 'yyyy-MM-dd') === req.end_date);
                                    if (idx !== -1) { endCol = idx + 1; isActualEnd = true; }
                                  }
                                  const span = Math.max(1, endCol - startCol + 1);

                                  return (
                                    <div key={`l-${req.id || rIdx}`} className="grid grid-cols-7 px-1 pointer-events-auto">
                                      <div
                                        style={{ gridColumn: `${startCol} / span ${span}`, backgroundColor: lt?.colour || '#3D87D3' }}
                                        className={`py-1.5 px-2.5 text-[11px] font-extrabold text-white shadow-xs flex items-center justify-between transition-transform hover:scale-[1.01] ${
                                          isActualStart && isActualEnd ? 'rounded-lg' :
                                          isActualStart ? 'rounded-l-lg rounded-r-none pr-1' :
                                          isActualEnd ? 'rounded-r-lg rounded-l-none pl-1' :
                                          'rounded-none px-1'
                                        }`}
                                        title={`${lt?.name_en} (${req.start_date} → ${req.end_date})`}
                                      >
                                        <span className="truncate flex items-center font-black text-white">
                                          <span className="mr-1.5">🏖️</span>
                                          <span className="truncate">{lt?.name_el || 'Leave'}</span>
                                        </span>
                                        {isActualEnd && (
                                          <span className="ml-2 text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-black/25 text-white font-black shrink-0">
                                            {req.status === 'pending' ? '⏳ PENDING' : '✓ APPROVED'}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <Card 
            title={`Annual Leave Grid (${selectedYear})`}
            subtitle="Detailed table breakdown of your scheduled leave records, status, and remaining available quota for the selected year."
            className="border-slate-200 shadow-sm"
          >
            <div className="space-y-5 mt-3">
              <div className="flex items-center justify-end space-x-2 pb-1">
                <span className="text-xs font-extrabold text-slate-600">Select Grid Year:</span>
                <select
                  value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value))}
                  className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-extrabold text-slate-800 shadow-2xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value={2027}>2027</option>
                  <option value={2026}>2026</option>
                  <option value={2025}>2025</option>
                </select>
              </div>

              {/* Annual Quota Status Ribbon */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-sm border border-slate-700">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-extrabold block mb-0.5">Total Allowance Quota</span>
                  <strong className="text-xl font-mono font-extrabold text-white">{exportYearBalance.entitlement + exportYearBalance.carryOver} <span className="text-xs font-sans text-slate-300">days</span></strong>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Annual entitlement</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-extrabold block mb-0.5">Consumed / Scheduled</span>
                  <strong className="text-xl font-mono font-extrabold text-amber-300">{exportYearBalance.taken + exportYearBalance.reserved} <span className="text-xs font-sans text-slate-300">days</span></strong>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Deducted working days</span>
                </div>
                <div className="p-2.5 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex flex-col justify-center">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-extrabold block mb-0.5 flex items-center">
                    <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-400 shrink-0" /> Available Remaining
                  </span>
                  <strong className="text-2xl font-mono font-black text-emerald-300">{exportYearBalance.available} <span className="text-xs font-sans text-emerald-200 font-bold">working days</span></strong>
                </div>
              </div>

              {/* Table Grid (AG Grid) */}
              <LeaveGrid
                leaves={exportYearLeaves}
                leaveTypes={leaveTypes}
                getEffectiveDays={getEffectiveDays}
              />
            </div>
          </Card>
        )}
        </div>

        {/* RIGHT COLUMN: PERSONAL LEAVE HISTORY & LEAVE CATEGORY QUOTAS (5 COLS) */}
        <div className="lg:col-span-5 space-y-6 flex flex-col">
              {/* LEAVE CATEGORIES BREAKDOWN ("THE BIG PICTURE") */}
              <div className="space-y-3 order-2">
                <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center">
                  <Briefcase className="w-4 h-4 mr-2 text-[#3D87D3]" /> Leave Category Quotas &amp; Policy Rules
                </h3>
                <div className="space-y-3">
                  {leaveTypes.map(lt => {
                    const myCatLeaves = leaveRequests.filter(r => r.profile_id === currentUser.id && r.leave_type_id === lt.id && r.origin !== 'mandatory');
                    const approvedDays = myCatLeaves.filter(r => r.status === 'approved' || r.status === 'taken').reduce((a, b) => a + getEffectiveDays(b), 0);
                    const pendingDays = myCatLeaves.filter(r => r.status === 'pending').reduce((a, b) => a + getEffectiveDays(b), 0);
                    const isAnnual = lt.id === 'lt-annual' || lt.id === 'vacation' || lt.name_en?.toLowerCase().includes('annual') || lt.name_en?.toLowerCase().includes('vacation');

                    return (
                      <Card key={lt.id} className="border-slate-200 shadow-2xs hover:shadow-xs transition-all relative overflow-hidden p-4 bg-white">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="w-3 h-3 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: lt.colour || '#3D87D3' }} />
                              <h4 className="font-extrabold text-slate-900 text-sm">{lt.name_el}</h4>
                              <span className="text-xs text-slate-500 font-bold">({lt.name_en})</span>
                              {lt.is_hidden && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-bold">Hidden from New Requests</span>}
                            </div>
                            <p className="text-[11px] text-slate-500 font-medium">
                              Min Notice: <strong className="text-slate-800 font-bold">{lt.min_notice_days}d prior</strong> &bull; Quota Rule: <strong className="text-slate-800 font-bold">{lt.counts_against_balance ? 'Deducted from Allowance' : 'No Balance Deduction'}</strong>{lt.requires_document && <span className="text-amber-700 font-bold"> &bull; Doc Required</span>}
                            </p>
                          </div>
                          <Badge variant={approvedDays > 0 ? "info" : "neutral"} className="text-xs shrink-0 font-bold py-1 px-2">
                            {approvedDays}d Used
                          </Badge>
                        </div>

                        {isAnnual ? (
                          <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1.5">
                            <div className="flex justify-between text-[11px] font-extrabold text-slate-700">
                              <span>Annual Pool Utilization</span>
                              <span>{approvedDays + myBalance.mandatory} / {myBalance.entitlement + myBalance.carryOver} Total Pool</span>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden flex shadow-inner">
                              <div 
                                className="bg-[#3D87D3] h-full transition-all duration-500 rounded-full" 
                                style={{ width: `${Math.min(100, ((approvedDays + myBalance.mandatory) / (myBalance.entitlement + myBalance.carryOver || 1)) * 100)}%` }} 
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                            <span>Pending requests: <strong className="text-slate-800 font-bold">{pendingDays}d</strong></span>
                            <span>Total logged in 2026: <strong className="text-slate-800 font-bold">{approvedDays + pendingDays}d</strong></span>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>

              {/* MY PERSONAL LEAVE HISTORY & REQUESTS LOG */}
              <Card 
                title="My Personal Leave History" 
                subtitle="Audit trail of all your applications (scroll to view full history)" 
                className="border-slate-200 shadow-xs order-1"
              >
                <div className="space-y-2.5 mt-2.5 max-h-[320px] overflow-y-auto overflow-x-hidden pr-1.5 p-1 bg-slate-50/60 border border-slate-200/80 rounded-xl shadow-inner scrollbar-thin scrollbar-thumb-slate-300">
                  {(() => {
                    const myHistory = leaveRequests.filter(r => r.profile_id === currentUser.id);
                    if (myHistory.length === 0) {
                      return (
                        <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-200 rounded-xl bg-white">
                          You have not filed any leave requests yet. Click &amp; drag on the calendar to file your first holiday!
                        </div>
                      );
                    }
                    return myHistory.map(req => {
                      const lType = leaveTypes.find(lt => lt.id === req.leave_type_id);
                      const isMandatory = req.origin === 'mandatory';
                      const isFuture = isAfter(parseISO(req.start_date), parseISO(todayStr));

                      return (
                        <div key={req.id} className={`p-3.5 rounded-xl bg-white border transition-all flex flex-col gap-2.5 shadow-2xs ${
                          req.status === 'cancellation_requested' ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 hover:border-slate-300'
                        }`}>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between flex-wrap gap-1">
                              <div className="flex items-center space-x-2">
                                <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: lType?.colour }} />
                                <span className="font-extrabold text-sm text-slate-900">{lType?.name_el || 'Leave'} ({lType?.name_en})</span>
                              </div>
                              <Badge variant={
                                req.status === 'approved' || req.status === 'taken' ? 'success' : 
                                req.status === 'rejected' ? 'error' : 
                                req.status === 'cancelled' ? 'neutral' : 'warning'
                              } className="text-[10px] py-0.5 px-2 uppercase font-extrabold">
                                {req.status.replace('_', ' ')}
                              </Badge>
                            </div>

                            <p className="text-xs text-slate-500 font-medium">
                              Dates: <strong className="text-slate-800 font-mono font-bold">{req.start_date} &rarr; {req.end_date}</strong> &bull; Deduction: <strong className="text-[#3D87D3] font-black">{getEffectiveDays(req)}d</strong>
                            </p>
                            {req.note && <p className="text-[11px] text-slate-600 italic font-medium">&ldquo;{req.note}&rdquo;</p>}

                            {req.rejection_reason && (
                              <div className="mt-1 p-2 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800 font-bold">
                                <strong>Rejection:</strong> {req.rejection_reason}
                              </div>
                            )}
                            {req.admin_edit_reason && (
                              <div className="mt-1 p-2 rounded bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-900 flex items-center font-bold">
                                <Edit3 className="w-3 h-3 mr-1 text-indigo-600 shrink-0" />
                                <span><strong>Mod Note:</strong> {req.admin_edit_reason}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-100 gap-2 flex-wrap">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase border ${
                              req.ergani_status === 'submitted' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                              req.ergani_status === 'needs_amendment' ? 'bg-rose-50 text-rose-800 border-rose-300 animate-pulse font-black' :
                              req.ergani_status === 'pending' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}>
                              ΕΡΓΑΝΗ: {req.ergani_status}
                            </span>

                            {req.status === 'pending' && (
                              <Button size="sm" variant="outline" className="text-[11px] py-1 px-2 font-bold text-rose-600 border-rose-300 hover:bg-rose-50 cursor-pointer" onClick={() => updateLeaveRequestStatus(req.id, 'cancelled')}>
                                Cancel Request
                              </Button>
                            )}
                            {req.status === 'approved' && isFuture && (
                              <Button size="sm" variant="outline" className="text-[11px] py-1 px-2 font-bold text-amber-700 border-amber-300 hover:bg-amber-50 cursor-pointer" onClick={() => requestLeaveCancellation(req.id)}>
                                Request Cancellation
                              </Button>
                            )}
                            {isAdmin && (
                              <Button size="sm" variant="outline" className="text-[11px] py-1 px-2 font-bold text-rose-600 border-rose-300 hover:bg-rose-50 cursor-pointer flex items-center ml-auto" onClick={async () => {
                                if (window.confirm("Are you sure you want to permanently delete this leave entry?")) {
                                  await deleteLeaveRequest(req.id);
                                }
                              }}>
                                <Trash2 className="w-3 h-3 mr-1" /> Delete
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </Card>
          </div>
        </div>
      </div>

      {/* FILE LEAVE REQUEST MODAL (WITH NOTICE PERIOD RULES) */}
      <Modal isOpen={isRequestOpen} onClose={() => setIsRequestOpen(false)} title="File Leave Request">
        <form onSubmit={handleCreateRequest} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1">Leave Category</label>
            <select 
              value={reqType} 
              onChange={e => setReqType(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded p-2.5 text-slate-800 font-medium text-sm"
            >
              {leaveTypes.filter(lt => !lt.is_hidden || lt.id === reqType).map(lt => <option key={lt.id} value={lt.id}>{lt.name_el} ({lt.name_en})</option>)}
            </select>
          </div>

          {/* Notice rule indicator (§3) */}
          <div className={`p-3 rounded-xl border flex items-center justify-between font-medium text-xs ${
            minNoticeDays === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-100 border-slate-200 text-slate-700'
          }`}>
            <span>Minimum Notice Rule ({selectedLeaveType?.name_en}):</span>
            <span className="font-bold font-mono">
              {minNoticeDays === 0 ? '0 Days (Immediate / Retroactive Allowed)' : `${minNoticeDays} Days (Earliest: ${earliestValidDate})`}
            </span>
          </div>

          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1">Leave Period (Start → End)</label>
            <DateRangePicker
              start={startDate}
              end={endDate}
              minDate={isAdmin ? undefined : earliestValidDate}
              onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
            />
          </div>

          <div className="p-3.5 rounded-xl bg-[#3D87D3]/10 border border-[#3D87D3]/20 flex items-center justify-between text-xs text-slate-800 font-medium">
            <span>Calculated Working Days (Excludes Weekends & Greek Holidays):</span>
            <span className="text-lg font-extrabold text-[#3D87D3] font-mono">{currentWorkingDays} Days</span>
          </div>

          <div>
            <label className="block font-semibold uppercase text-slate-500 mb-1">Note / Reason (Optional)</label>
            <textarea
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Summer vacation, family event, medical visit..."
              className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 placeholder:text-slate-400"
            />
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsRequestOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" className="bg-[#3D87D3] hover:bg-[#3D87D3]/90">
              {isAdmin ? 'Record Approved Admin Entry →' : 'Submit for Approval →'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Export Year Selection Modal */}
      <Modal 
        isOpen={isExportModalOpen} 
        onClose={() => setIsExportModalOpen(false)} 
        title="Export Annual Leave Report (XLSX)"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed font-medium">
            Select a report year to download an official spreadsheet detailing your leave records, working days deducted, and remaining available quota.
          </p>
          <div>
            <label className="block font-bold uppercase tracking-wider text-slate-600 mb-1.5">Target Report Year</label>
            <select
              value={exportTargetYear}
              onChange={e => setExportTargetYear(Number(e.target.value))}
              className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-extrabold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
            >
              <option value={2027}>2027</option>
              <option value={2026}>2026</option>
              <option value={2025}>2025</option>
              <option value={2024}>2024</option>
            </select>
          </div>

          {isAdmin && (
            <div>
              <label className="block font-bold uppercase tracking-wider text-slate-600 mb-1.5">Employee / Report Scope</label>
              <select
                value={exportScope}
                onChange={e => setExportScope(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-extrabold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
              >
                <option value="me">👤 My Personal Leave Report ({currentUser.last_name})</option>
                <option value="all">🌟 All Employees (Company-Wide &amp; Detailed Ledger)</option>
                {profiles
                  .filter(p => p.id !== currentUser.id && (p.employment_type !== 'contractor' || p.status === 'active'))
                  .sort((a, b) => a.last_name.localeCompare(b.last_name))
                  .map(p => (
                    <option key={p.id} value={p.id}>👥 {p.last_name} {p.first_name} ({p.role})</option>
                  ))}
              </select>
            </div>
          )}

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-slate-600">
            <p className="font-semibold text-slate-800 flex items-center">
              <FileText className="w-4 h-4 mr-1.5 text-[#3D87D3] shrink-0" /> Included Report Data
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-500 font-medium">
              <li>Total Annual Allowance Quota &amp; Carryover Days</li>
              <li>Consumed working days &amp; exact remaining balance</li>
              <li>Detailed ledger of all scheduled, approved, and pending time-off</li>
            </ul>
          </div>

          <div className="pt-3 flex justify-end space-x-2.5 border-t border-slate-200/80">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsExportModalOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              size="sm" 
              type="button" 
              onClick={handleConfirmExport}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-4 py-2 cursor-pointer flex items-center shadow-xs"
            >
              <Download className="w-4 h-4 mr-1.5 shrink-0" /> Download Excel Report
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
