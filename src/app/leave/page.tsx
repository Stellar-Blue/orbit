"use client";

import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess, notifyValidation } from '@/lib/validation-modal';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Calendar, Plus, Clock, CheckCircle2, XCircle, AlertTriangle, 
  Users, ShieldCheck, FileText, Sparkles, Filter, HelpCircle, ArrowRight, ShieldAlert,
  BarChart3, CalendarDays, ChevronLeft, ChevronRight, Table, Download, LayoutGrid
} from 'lucide-react';
import { parseISO, format, eachDayOfInterval, addDays, isAfter, isBefore, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, isSameMonth, isSameDay } from 'date-fns';
import * as XLSX from 'xlsx';
import { LeaveRequest } from '@/lib/types';
import { formatDate, todayKey } from '@/lib/date';
import { DateRangePicker } from '@/components/leave/date-range-picker';
import {
  DETAILED_LEDGER_HEADERS, LEAVE_EXPORT_MONTHS, detailedLedgerAoa, filterLeaveExport,
  groupLeavesByEmployee, leaveCategoryName, leaveExportEmployees, leaveExportScopeLabel,
  type LeaveExportFilters, type LeaveExportPeriod,
} from '@/lib/leave-export';
import { countWorkingDays, holidayDates } from '@/lib/leave-days';
import { findCoverageViolations, describeViolation } from '@/lib/coverage-rules';
import { CarryoverWarning } from '@/components/leave/carryover-warning';

const LeaveGrid = dynamic(() => import('@/components/leave/leave-grid').then(m => m.LeaveGrid), { ssr: false });

export default function LeaveManagementPage() {
  const { 
    currentUser, profiles, leaveTypes, 
    leaveRequests, mandatoryLeaves, publicHolidays, 
    splitAndAddLeaveRequest,
    getEmployeeLeaveBalance,
    leaveExceptionRequests, requestLeaveException, getCoverageLoadForProfile,
    requestLeaveCancellation, cancelLeaveRequest,
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';
  const isContractor = currentUser.employment_type === 'contractor';

  // Interactive Calendar State in My Leaves tab
  const [calendarMonth, setCalendarMonth] = useState(() => new Date()); // opens on the current month
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
  const [startDate, setStartDate] = useState(todayKey);
  const [endDate, setEndDate] = useState(todayKey);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (leaveTypes.length > 0 && (!reqType || reqType === 'lt-annual' || !leaveTypes.some(lt => lt.id === reqType))) {
      const valid = leaveTypes.find(lt => !lt.is_hidden && (lt.code === 'annual' || (lt.name_en && lt.name_en.toLowerCase().includes('annual')))) || leaveTypes.find(lt => !lt.is_hidden) || leaveTypes[0];
      if (valid) setReqType(valid.id);
    }
  }, [leaveTypes, reqType]);

  // Home's "Request Leave" button lands here as /leave?request=leave and files straight away.
  // Read from window (not useSearchParams) so the page stays statically renderable, then strip the
  // param so a refresh or a back-navigation doesn't reopen the modal.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('request') !== 'leave') return;
    setIsRequestOpen(true);
    window.history.replaceState(null, '', '/leave');
  }, []);

  // Working days for an individual schedule: weekends off-schedule, Greek holidays and mandatory
  // company closures excluded. Counting itself lives in @/lib/leave-days so every leave surface agrees.
  const calculateWorkingDays = (startStr: string, endStr: string, schedule: string[], targetProfileId: string = currentUser.id) => {
    const excluded = new Set<string>(holidayDates(publicHolidays));
    const addRange = (s: string, e: string) =>
      eachDayOfInterval({ start: parseISO(s), end: parseISO(e) }).forEach(d => excluded.add(format(d, 'yyyy-MM-dd')));
    mandatoryLeaves.forEach(m => addRange(m.start_date, m.end_date));
    leaveRequests
      .filter(r => r.origin === 'mandatory' && r.profile_id === targetProfileId)
      .forEach(r => addRange(r.start_date, r.end_date));
    return countWorkingDays(startStr, endStr, schedule, excluded);
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

  // Days already approved/pending for the current user — blocked in the request picker
  const myBlockedLeaveDates = useMemo(() => {
    const dates = new Set<string>();
    leaveRequests
      .filter(r => r.profile_id === currentUser.id && r.origin !== 'mandatory' && ['approved', 'pending', 'in_progress'].includes(r.status))
      .forEach(r => {
        eachDayOfInterval({ start: parseISO(r.start_date), end: parseISO(r.end_date) }).forEach(d => {
          dates.add(format(d, 'yyyy-MM-dd'));
        });
      });
    return Array.from(dates);
  }, [leaveRequests, currentUser.id]);

  const selectedLeaveType = useMemo(() => {
    return leaveTypes.find(t => t.id === reqType) || leaveTypes[0];
  }, [reqType, leaveTypes]);

  const currentYear = new Date(startDate).getFullYear() || 2026;
  const myBalance = useMemo(() => {
    return getEmployeeLeaveBalance(currentUser.id, currentYear);
  }, [currentUser.id, currentYear, getEmployeeLeaveBalance, leaveRequests]);

  // Coverage exception requests filed when a team rule blocked a request. Admins see
  // everyone's rows, so scope to the current employee.
  const myLeaveExceptions = useMemo(
    () => leaveExceptionRequests.filter(r => r.profile_id === currentUser.id),
    [leaveExceptionRequests, currentUser.id]
  );

  // Earliest valid start date based on min_notice_days (§3)
  const minNoticeDays = selectedLeaveType?.min_notice_days ?? 7;
  const todayStr = format(new Date(), 'yyyy-MM-dd'); // Current local reference date
  const earliestValidDate = useMemo(() => {
    if (minNoticeDays === 0) return todayStr;
    return format(addDays(parseISO(todayStr), minNoticeDays), 'yyyy-MM-dd');
  }, [minNoticeDays]);

  const handleCreateRequest = async (e: React.FormEvent) => {
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
      alert('VALIDATION ERROR: This leave request overlaps with days you already have approved or pending in your register.');
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

    // 5. Team coverage rule: a group may not all be away at the same time.
    if (!isAdmin) {
      const loads = await getCoverageLoadForProfile(currentUser.id, 'leave', startDate, endDate);
      const violations = loads.flatMap(l => findCoverageViolations({ group: l.group, kind: 'leave', rows: l.rows }));
      const hit = violations[0];
      if (hit) {
        const clashDays = Array.from(new Set(violations.map(v => v.day))).sort();
        notifyValidation({
          type: 'warning',
          title: 'Team coverage rule',
          message: `${describeViolation(hit)} Your group may not all be away at once, so this request cannot be filed as is.${clashDays.length > 1 ? ` ${clashDays.length} days clash.` : ''} You can ask an admin for an exception.`,
          items: [
            { label: 'Rule', value: hit.group.name },
            { label: 'First clash', value: hit.day },
            { label: 'Already away', value: `${hit.others} of ${hit.cap} allowed` },
            ...(hit.names.length > 0 ? [{ label: 'Who', value: hit.names.join(', ') }] : []),
          ],
          action: {
            label: 'Request admin approval',
            onClick: async () => {
              const ok = await requestLeaveException({
                profile_id: currentUser.id,
                leave_type_id: selectedLeaveType?.id || reqType,
                start_date: startDate,
                end_date: endDate,
                working_days: currentWorkingDays,
                note: note.trim() || `${selectedLeaveType.name_en} Request`,
                reason: describeViolation(hit),
                group_id: hit.group.id,
              });
              if (ok) {
                setIsRequestOpen(false);
                notifySuccess('Your request was sent to an admin. If approved, the leave is filed for you.', 'Request sent');
              }
            }
          }
        });
        return;
      }
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
  const [viewMode, setViewMode] = useState<'calendar' | 'grid' | 'category'>('calendar');
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportTargetYear, setExportTargetYear] = useState<number>(() => new Date().getFullYear() || 2026);
  const [exportScope, setExportScope] = useState<string>('me');
  const [exportPeriod, setExportPeriod] = useState<LeaveExportPeriod>('full_year');
  const [exportMonth, setExportMonth] = useState(() => new Date().getMonth() + 1);
  const [exportApprovedOnly, setExportApprovedOnly] = useState(false);
  const [exportActiveOnly, setExportActiveOnly] = useState(false);

  const exportFilters: LeaveExportFilters = {
    year: exportTargetYear, period: exportPeriod, month: exportMonth,
    approvedOnly: exportApprovedOnly, activeOnly: exportActiveOnly,
  };
  /** Exactly the leave rows the "Download" button will write, so the modal can preview them. */
  const exportLeaves = useMemo(
    () => filterLeaveExport(leaveRequests, exportFilters, profiles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leaveRequests, exportTargetYear, exportPeriod, exportMonth, exportApprovedOnly, exportActiveOnly, profiles]
  );

  const exportYearLeaves = useMemo(() => {
    return leaveRequests.filter(r => 
      r.profile_id === currentUser.id && r.start_date.startsWith(String(selectedYear))
    ).sort((a, b) => b.start_date.localeCompare(a.start_date));
  }, [leaveRequests, currentUser.id, selectedYear]);

  /**
   * Employee self-service on their own leave rows: a still-pending request is withdrawn
   * outright (no admin decision needed), while an upcoming approved one becomes an admin
   * cancellation request — already-taken/in-progress leave can only be corrected by an admin.
   */
  const handleCancelLeaveRequest = async (req: LeaveRequest) => {
    if (req.status === 'pending') {
      if (!window.confirm(`Withdraw your pending leave request for ${formatDate(req.start_date)} – ${formatDate(req.end_date)}?\n\nIt will be cancelled immediately.`)) return;
      const ok = await cancelLeaveRequest(req.id);
      if (ok) notifySuccess('Your pending leave request was withdrawn.', 'Request cancelled');
      else notifyValidation({ type: 'error', title: 'Could not withdraw request', message: 'The request was not cancelled — please try again.' });
      return;
    }
    if (!window.confirm(`Request cancellation of your approved leave for ${formatDate(req.start_date)} – ${formatDate(req.end_date)}?\n\nAn administrator will review the cancellation.`)) return;
    const ok = await requestLeaveCancellation(req.id);
    if (ok) notifySuccess('An administrator will review your cancellation request.', 'Cancellation requested');
    else notifyValidation({ type: 'error', title: 'Could not request cancellation', message: 'Nothing was changed — please try again.' });
  };

  const handleConfirmExport = () => {
    const targetLeaves = exportLeaves;
    const scopedProfiles = leaveExportEmployees(profiles, exportActiveOnly);
    const scopeLabel = leaveExportScopeLabel(exportFilters, undefined, { employees: isAdmin });

    const wb = XLSX.utils.book_new();

    if (exportScope === 'all') {
      // Company-Wide Summary
      const summaryData: (string | number)[][] = [
        ['STELLARBLUE ORBIT — COMPANY-WIDE DEDUCTED LEAVE DAYS REPORT'],
        ['Report Year:', String(exportTargetYear)],
        ['Export Filters:', scopeLabel],
        ['Generated On:', formatDate(new Date())],
        [''],
        ['Employee Name', 'Work Email', 'Employment Type', 'Total Allowance Quota', 'Regular Deducted (Days)', 'Mandatory Closure (Days)', 'Total Deducted Days', 'Remaining Available Balance']
      ];

      scopedProfiles.forEach(p => {
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

      // Detailed Deductions Ledger — grouped per employee, column headers on row 1.
      const detailData: (string | number)[][] = [
        DETAILED_LEDGER_HEADERS,
        ...detailedLedgerAoa(groupLeavesByEmployee(targetLeaves, profiles, getEffectiveDays), leaveTypes, getEffectiveDays),
      ];

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
        ['Export Filters:', scopeLabel],
        ['Total Annual Allowance Quota:', `${targetBalance.entitlement + targetBalance.carryOver} working days`],
        ['Regular Deducted Days:', `${targetBalance.taken} working days`],
        ['Mandatory Closure Deducted Days:', `${targetBalance.mandatory} working days`],
        ['TOTAL DEDUCTED LEAVE DAYS:', `${totalDeducted} working days`],
        ['AVAILABLE / REMAINING LEAVES:', `${targetBalance.available} working days`],
        [''],
        ['START DATE', 'END DATE', 'LEAVE CATEGORY / TYPE', 'WORKING DAYS DEDUCTED', 'STATUS', 'ORIGIN', 'MEMO & REASON']
      ];

      if (empLeaves.length === 0) {
        wsData.push(['No recorded leave deductions for the selected filters', '', '', '', '', '', '']);
      } else {
        empLeaves.forEach(req => {
          const effDays = getEffectiveDays(req);
          wsData.push([
            req.start_date,
            req.end_date,
            leaveCategoryName(req, leaveTypes),
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

      {/* Carried-over days with a use-by date */}
      <CarryoverWarning />

      {/* Coverage exceptions: filed here, decided by an admin */}
      {myLeaveExceptions.length > 0 && (
        <Card className="shadow-xs border-amber-200 bg-amber-50/40">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-2 min-w-0 flex-1">
              <span className="text-xs font-extrabold text-slate-900 block">Team coverage exception requests</span>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                A team coverage rule blocked these requests because too many of your group would be away at once.
                An admin reviews them; if approved, the leave is filed on your behalf.
              </p>
              <div className="space-y-1.5">
                {myLeaveExceptions.map(ex => (
                  <div key={ex.id} className="flex items-center gap-2 flex-wrap text-[11px] bg-white rounded-xl border border-slate-200 px-3 py-2">
                    <Badge
                      variant={ex.status === 'pending' ? 'warning' : ex.status === 'approved' ? 'success' : 'neutral'}
                      className="text-[10px] px-1.5 py-0 capitalize"
                    >
                      {ex.status}
                    </Badge>
                    <span className="font-bold text-slate-800 font-mono">
                      {formatDate(ex.start_date)} → {formatDate(ex.end_date)}
                    </span>
                    <span className="text-slate-500 font-semibold">{Number(ex.working_days)}d</span>
                    <span className="text-slate-400 truncate min-w-0 flex-1">{ex.reason || ''}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

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
                  .filter(r => r.profile_id === currentUser.id && r.origin !== 'mandatory' && (r.status === 'approved' || r.status === 'in_progress') && isAfter(parseISO(r.end_date), parseISO(todayStr)))
                  .sort((a, b) => a.start_date.localeCompare(b.start_date));

                if (myApprovedFuture.length > 0) {
                  const nextLeave = myApprovedFuture[0];
                  const lt = leaveTypes.find(t => t.id === nextLeave.leave_type_id);
                  return (
                    <div className="w-full p-4 rounded-xl bg-gradient-to-r from-emerald-900 to-teal-800 text-white shadow-sm border border-emerald-700/80 flex flex-col justify-between">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-300 flex items-center">
                          <CalendarDays className="w-3.5 h-3.5 mr-1.5 shrink-0" /> Next Leave
                        </span>
                        <Badge variant="success" className="bg-emerald-500/40 text-white border-emerald-300/60 text-[10px] py-0.5 px-2 font-black shadow-2xs shrink-0">
                          Confirmed
                        </Badge>
                      </div>
                      <div className="mt-2 pt-2 border-t border-white/10">
                        <h4 className="text-xs font-black text-white truncate">{lt?.name_en || 'Scheduled Leave'} &bull; <span className="font-mono text-emerald-200">{formatDate(nextLeave.start_date)} → {formatDate(nextLeave.end_date)}</span></h4>
                        <p className="text-[11px] text-emerald-100/90 mt-0.5 font-medium truncate">{nextLeave.working_days}d deduction {nextLeave.note ? `— "${nextLeave.note}"` : ''}</p>
                      </div>
                    </div>
                  );
                } else {
                  return (
                    <div className="w-full p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-2xs flex flex-col justify-between">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-extrabold text-slate-800 flex items-center">
                          <Sparkles className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3] shrink-0" /> No leaves yet
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

          {/* FULL-WIDTH LAYOUT: INTERACTIVE LEAVE CALENDAR & ANNUAL LEAVE GRID */}
          <div className="space-y-5" onMouseUp={handleCalendarMouseUp} onMouseLeave={() => { if (isDragging) { setIsDragging(false); setDragStart(null); setDragCurrent(null); } }}>
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
                  <button
                    type="button"
                    onClick={() => setViewMode('category')}
                    className={`px-3.5 py-1.5 rounded-lg font-bold text-xs flex items-center transition-all cursor-pointer ${
                      viewMode === 'category' ? 'bg-[#3D87D3] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5 mr-1.5" /> Per Category View
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
                                        title={`Company Closure: ${formatDate(m.start_date)} → ${formatDate(m.end_date)}`}
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
                                        title={`${lt?.name_en} (${formatDate(req.start_date)} → ${formatDate(req.end_date)})`}
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
        ) : viewMode === 'grid' ? (
          <Card 
            title="Annual Leave Grid"
            subtitle="Detailed table breakdown of your scheduled leave records, status, and remaining available quota for the selected year."
            className="border-slate-200 shadow-sm"
            action={
              <div className="flex items-center space-x-2">
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
            }
          >
            <div className="space-y-5 mt-3">
              {/* Table Grid (AG Grid) */}
              <LeaveGrid
                leaves={exportYearLeaves}
                leaveTypes={leaveTypes}
                getEffectiveDays={getEffectiveDays}
                onCancelRequest={handleCancelLeaveRequest}
              />
            </div>
          </Card>
        ) : (
          <Card
            title="Per Category View"
            subtitle="Leave categories, policy rules, and quota utilization at a glance."
            className="border-slate-200 shadow-sm"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mt-2">
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
          </Card>
        )}
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
              blockedDates={myBlockedLeaveDates}
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
            Select the report scope and filters to download an official spreadsheet detailing the leave records you choose, the working days deducted, and the remaining available quota.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div>
              <label className="block font-bold uppercase tracking-wider text-slate-600 mb-1.5">Leaves To Include (Period)</label>
              <select
                value={exportPeriod}
                onChange={e => setExportPeriod(e.target.value as LeaveExportPeriod)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-extrabold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
              >
                <option value="full_year">🗓️ Whole year ({exportTargetYear})</option>
                <option value="ytd">⏱️ Year to date (01/01 → today)</option>
                <option value="month">📅 Single month…</option>
              </select>
            </div>

            {exportPeriod === 'month' && (
              <div>
                <label className="block font-bold uppercase tracking-wider text-slate-600 mb-1.5">Month</label>
                <select
                  value={exportMonth}
                  onChange={e => setExportMonth(Number(e.target.value))}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-extrabold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  {LEAVE_EXPORT_MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m} {exportTargetYear}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-bold uppercase tracking-wider text-slate-600 mb-1.5">Leave Status</label>
              <select
                value={exportApprovedOnly ? 'approved' : 'all'}
                onChange={e => setExportApprovedOnly(e.target.value === 'approved')}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-extrabold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
              >
                <option value="all">📋 All statuses (incl. pending &amp; rejected)</option>
                <option value="approved">✅ Approved &amp; deducted leaves only</option>
              </select>
            </div>

            {isAdmin && (
              <div>
                <label className="block font-bold uppercase tracking-wider text-slate-600 mb-1.5">Employees</label>
                <select
                  value={exportActiveOnly ? 'active' : 'all'}
                  onChange={e => setExportActiveOnly(e.target.value === 'active')}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-extrabold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value="all">👥 All employees (incl. departed)</option>
                  <option value="active">🟢 Active employees only</option>
                </select>
              </div>
            )}
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

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-600 font-medium leading-relaxed">
            <span className="font-extrabold text-slate-800">{leaveExportScopeLabel(exportFilters, undefined, { employees: isAdmin })}</span>
            {' — '}
            {exportScope === 'all'
              ? `${exportLeaves.length} leave record(s) across ${groupLeavesByEmployee(exportLeaves, profiles).length} employee(s) will be exported (grouped per employee), plus the annual balance summary.`
              : `${exportLeaves.filter(r => r.profile_id === (exportScope === 'me' ? currentUser.id : exportScope)).length} leave record(s) will be exported.`}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-slate-600">
            <p className="font-semibold text-slate-800 flex items-center">
              <FileText className="w-4 h-4 mr-1.5 text-[#3D87D3] shrink-0" /> Included Report Data
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-500 font-medium">
              <li>Total Annual Allowance Quota &amp; Carryover Days</li>
              <li>Consumed working days &amp; exact remaining balance</li>
              <li>Detailed ledger of the selected leaves, grouped per employee</li>
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
