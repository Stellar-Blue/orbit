"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Calendar, Plus, Clock, CheckCircle2, XCircle, AlertTriangle, 
  Users, ShieldCheck, FileText, Sparkles, Filter, Edit3, HelpCircle, ArrowRight, ShieldAlert,
  BarChart3, CalendarDays, Briefcase, ChevronLeft, ChevronRight
} from 'lucide-react';
import { parseISO, format, eachDayOfInterval, addDays, isAfter, isBefore, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, isSameMonth } from 'date-fns';
import { LeaveRequest } from '@/lib/types';

export default function LeaveManagementPage() {
  const { 
    currentUser, profiles, leaveTypes, entitlements, 
    leaveRequests, mandatoryLeaves, publicHolidays, 
    addLeaveRequest, updateLeaveRequestStatus, addMandatoryLeave, updateErganiStatus,
    editLeaveRequest, requestLeaveCancellation, decideLeaveCancellation, splitAndAddLeaveRequest,
    getEmployeeLeaveBalance
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';
  const isContractor = currentUser.employment_type === 'contractor';

  // Tabs
  const [tab, setTab] = useState<'my_leaves' | 'requests' | 'calendar' | 'mandatory'>('my_leaves');

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
  const [reqType, setReqType] = useState(leaveTypes[0]?.id || 'lt-annual');
  const [startDate, setStartDate] = useState('2026-09-14');
  const [endDate, setEndDate] = useState('2026-09-18');
  const [note, setNote] = useState('');

  // Rejection reason modal
  const [rejectModalTarget, setRejectModalTarget] = useState<string | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');

  // Admin Post-Approval Editor modal state
  const [editingLeave, setEditingLeave] = useState<LeaveRequest | null>(null);
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editReason, setEditReason] = useState('');

  // Mandatory Leave Declaration (Company-Wide) State
  const [isMandatoryOpen, setIsMandatoryOpen] = useState(false);
  const [mName, setMName] = useState('Mandatory August Summer Bridge 2026');
  const [mStart, setMStart] = useState('2026-08-10');
  const [mEnd, setMEnd] = useState('2026-08-14');
  const [mNote, setMNote] = useState('Company-wide summer vacation week.');
  const [previewMode, setPreviewMode] = useState(false);

  // Calculate working days excluding Greek holidays and weekends for an individual schedule
  const calculateWorkingDays = (startStr: string, endStr: string, schedule: string[]) => {
    try {
      const days = eachDayOfInterval({ start: parseISO(startStr), end: parseISO(endStr) });
      let count = 0;
      days.forEach(d => {
        const dayStr = d.toISOString().split('T')[0];
        const dayOfWeek = format(d, 'EEE'); // Mon, Tue, etc.
        const isHoliday = publicHolidays.some(h => h.date === dayStr);
        if (!isHoliday && schedule.includes(dayOfWeek)) {
          count++;
        }
      });
      return count;
    } catch {
      return 0;
    }
  };

  const currentWorkingDays = useMemo(() => {
    return calculateWorkingDays(startDate, endDate, currentUser.work_schedule);
  }, [startDate, endDate, currentUser, publicHolidays]);

  const editedWorkingDays = useMemo(() => {
    if (!editingLeave) return 0;
    const targetProfile = profiles.find(p => p.id === editingLeave.profile_id);
    return calculateWorkingDays(editStartDate, editEndDate, targetProfile?.work_schedule || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  }, [editStartDate, editEndDate, editingLeave, profiles, publicHolidays]);

  const selectedLeaveType = useMemo(() => {
    return leaveTypes.find(t => t.id === reqType) || leaveTypes[0];
  }, [reqType, leaveTypes]);

  const currentYear = new Date(startDate).getFullYear() || 2026;
  const myBalance = useMemo(() => {
    return getEmployeeLeaveBalance(currentUser.id, currentYear);
  }, [currentUser.id, currentYear, getEmployeeLeaveBalance, leaveRequests]);

  // Earliest valid start date based on min_notice_days (§3)
  const minNoticeDays = selectedLeaveType?.min_notice_days ?? 7;
  const todayStr = '2026-07-31'; // Baseline dev reference date
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
      leave_type_id: reqType,
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
    alert(isAdmin ? 'Leave entered directly as approved admin entry!' : 'Leave request submitted for admin queue review!');
  };

  const handleConfirmReject = () => {
    if (!rejectModalTarget) return;
    updateLeaveRequestStatus(rejectModalTarget, 'rejected', rejectionReasonInput || 'No specific reason provided.');
    setRejectModalTarget(null);
    setRejectionReasonInput('');
  };

  const handleSaveAdminEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLeave) return;
    if (!editReason.trim()) {
      alert('MANDATORY REASON: Please provide a brief reason for this post-approval correction or partial cancellation.');
      return;
    }

    const wasSubmitted = editingLeave.ergani_status === 'submitted';
    editLeaveRequest(editingLeave.id, {
      start_date: editStartDate,
      end_date: editEndDate,
      working_days: editedWorkingDays,
      note: editNote
    }, editReason);

    setEditingLeave(null);
    alert(`Leave modified successfully!${wasSubmitted ? ' Since this leave was previously filed in ΕΡΓΑΝΗ, its status has automatically flipped to NEEDS_AMENDMENT in the compliance dashboard.' : ''}`);
  };

  const handlePublishMandatory = () => {
    addMandatoryLeave({
      name: mName,
      leave_type_id: leaveTypes.find(t => t.code === 'annual')?.id || 'lt-annual',
      start_date: mStart,
      end_date: mEnd,
      status: 'published',
      created_by: currentUser.id,
      note: mNote
    });
    setIsMandatoryOpen(false);
    setPreviewMode(false);
    alert('Mandatory Leave Published! Fan-out engine has automatically created approved entries for all eligible employees.');
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

  const pendingCount = leaveRequests.filter(r => r.status === 'pending' || r.status === 'cancellation_requested').length;
  const unsubmittedErgani = leaveRequests.filter(r => (r.status === 'approved' || r.status === 'cancelled' || r.status === 'in_progress') && (r.ergani_status === 'pending' || r.ergani_status === 'needs_amendment'));

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
            <Calendar className="w-6 h-6 mr-3 text-[#3D87D3]" /> Leave Management & Holiday Quotas
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Greek public holiday aware leave calculation, explicit state-machine lifecycle, and company-wide mandatory closure fan-out engine.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/calendar" className="px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs border border-indigo-200 transition-all flex items-center shadow-2xs">
            <Calendar className="w-3.5 h-3.5 mr-1.5 text-indigo-600" /> View Unified Calendar
          </Link>
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={() => { setIsMandatoryOpen(true); setPreviewMode(false); }} className="cursor-pointer">
              <Sparkles className="w-3.5 h-3.5 mr-1.5 text-amber-600" /> Declare Mandatory Leave
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => setIsRequestOpen(true)} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 shadow-xs cursor-pointer">
            <Plus className="w-4 h-4 mr-1" /> File Leave Request (<span className="font-mono">&lt;30s</span>)
          </Button>
        </div>
      </div>

      {/* Tabs Toolbar */}
      <div className="flex border-b border-slate-200 space-x-6 text-sm flex-wrap gap-y-2">
        <button 
          onClick={() => setTab('my_leaves')}
          className={`pb-3 font-extrabold transition-all flex items-center cursor-pointer ${tab === 'my_leaves' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' : 'text-slate-500 hover:text-slate-800'}`}
        >
          <BarChart3 className="w-4 h-4 mr-1.5 text-[#3D87D3]" /> My Leaves & Big Picture
        </button>
        <button 
          onClick={() => setTab('calendar')}
          className={`pb-3 font-extrabold transition-all flex items-center cursor-pointer ${tab === 'calendar' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' : 'text-slate-500 hover:text-slate-800'}`}
        >
          <CalendarDays className="w-4 h-4 mr-1.5 text-indigo-500" /> Team Out-of-Office Calendar
        </button>
        {isAdmin && (
          <>
            <button 
              onClick={() => setTab('requests')}
              className={`pb-3 font-extrabold transition-all flex items-center cursor-pointer ${tab === 'requests' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <span>Shared Founder Approval Queue & Register</span>
              {pendingCount > 0 && <span className="ml-2 px-2 py-0.5 rounded-full bg-[#3D87D3]/10 border border-[#3D87D3]/20 text-[#3D87D3] font-bold text-xs">{pendingCount}</span>}
            </button>
            <button 
              onClick={() => setTab('mandatory')}
              className={`pb-3 font-extrabold transition-all flex items-center cursor-pointer ${tab === 'mandatory' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <span>Mandatory Closures ({mandatoryLeaves.length})</span>
            </button>
          </>
        )}
      </div>

      {/* TAB 0: MY LEAVES (THE BIG PICTURE) */}
      {tab === 'my_leaves' && (
        <div className="space-y-8 animate-in fade-in duration-200">
          {/* BALANCE EQUATION CLARITY CARD */}
          <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-[#255e96] text-white shadow-md border border-slate-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-white/10">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-sky-500/20 rounded-xl border border-sky-400/30">
                  <BarChart3 className="w-6 h-6 text-sky-400" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold tracking-wide uppercase text-white">Your 2026 Leave Balance & Big Picture</h3>
                  <p className="text-xs text-slate-300 mt-0.5">Complete transparency on how your available vacation pool is calculated in real time</p>
                </div>
              </div>
              <div className="flex items-center space-x-3 text-right">
                <span className="text-xs uppercase text-slate-300 font-extrabold tracking-wider">Net Available Pool:</span>
                <span className="px-4 py-1.5 rounded-full bg-emerald-500 text-white font-black text-xl font-mono shadow-xs">
                  {myBalance.available} Days
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-white/10 border border-white/15">
                <p className="text-[10px] uppercase text-slate-300 font-extrabold">Annual Entitlement</p>
                <p className="text-xl font-extrabold font-mono text-white mt-1">{myBalance.entitlement} days</p>
                <p className="text-[10px] text-slate-300 mt-0.5 font-medium">Greek statutory base</p>
              </div>
              <div className="p-3.5 rounded-xl bg-white/10 border border-white/15">
                <p className="text-[10px] uppercase text-sky-300 font-extrabold">+ Carry-Over</p>
                <p className="text-xl font-extrabold font-mono text-sky-300 mt-1">{myBalance.carryOver} days</p>
                <p className="text-[10px] text-slate-300 mt-0.5 font-medium">Expires {myBalance.carryOverExpires}</p>
              </div>
              <div className="p-3.5 rounded-xl bg-white/10 border border-white/15">
                <p className="text-[10px] uppercase text-amber-300 font-extrabold">− Taken / Approved</p>
                <p className="text-xl font-extrabold font-mono text-amber-300 mt-1">−{myBalance.taken} days</p>
                <p className="text-[10px] text-slate-300 mt-0.5 font-medium">Confirmed holidays</p>
              </div>
              <div className="p-3.5 rounded-xl bg-white/10 border border-white/15">
                <p className="text-[10px] uppercase text-purple-300 font-extrabold">− Reserved (Pending)</p>
                <p className="text-xl font-extrabold font-mono text-purple-300 mt-1">−{myBalance.reserved} days</p>
                <p className="text-[10px] text-slate-300 mt-0.5 font-medium">Awaiting sign-off</p>
              </div>
              <div className="p-3.5 rounded-xl bg-white/10 border border-white/15">
                <p className="text-[10px] uppercase text-indigo-300 font-extrabold">− Mandatory Closures</p>
                <p className="text-xl font-extrabold font-mono text-indigo-300 mt-1">−{myBalance.mandatory} days</p>
                <p className="text-[10px] text-slate-300 mt-0.5 font-medium">Company bridge days</p>
              </div>
            </div>
          </div>

          {/* Upcoming scheduled time-off banner */}
          {(() => {
            const myApprovedFuture = leaveRequests
              .filter(r => r.profile_id === currentUser.id && (r.status === 'approved' || r.status === 'in_progress') && isAfter(parseISO(r.end_date), parseISO('2026-07-30')))
              .sort((a, b) => a.start_date.localeCompare(b.start_date));

            if (myApprovedFuture.length > 0) {
              const nextLeave = myApprovedFuture[0];
              const lt = leaveTypes.find(t => t.id === nextLeave.leave_type_id);
              return (
                <div className="p-5 rounded-xl bg-gradient-to-r from-emerald-900 to-teal-800 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm border border-emerald-700/80">
                  <div className="flex items-center space-x-3">
                    <div className="p-3 bg-white/10 rounded-xl text-emerald-300">
                      <CalendarDays className="w-6 h-6" />
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-widest font-extrabold text-emerald-300 block">Next Scheduled Time Off</span>
                      <h4 className="text-base font-black text-white mt-0.5">{lt?.name_en || 'Scheduled Leave'} &bull; {nextLeave.start_date} to {nextLeave.end_date}</h4>
                      <p className="text-xs text-emerald-100 mt-0.5 font-medium">{nextLeave.working_days} working days deduction {nextLeave.note ? `— "${nextLeave.note}"` : ''}</p>
                    </div>
                  </div>
                  <Badge variant="success" className="bg-emerald-500/40 text-white border-emerald-300/60 text-xs py-1.5 px-4 font-black shadow-2xs shrink-0">
                    Confirmed & Ready
                  </Badge>
                </div>
              );
            } else {
              return (
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
                  <div className="flex items-center space-x-3">
                    <div className="p-3 bg-[#3D87D3]/10 text-[#3D87D3] rounded-xl font-bold">
                      <Sparkles className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-slate-900">No upcoming time-off planned yet!</h4>
                      <p className="text-xs text-slate-500 mt-0.5 font-medium">You have <strong className="text-slate-800 font-extrabold">{myBalance.available} available vacation days</strong> remaining to spend in 2026. Plan ahead to maximize your rest!</p>
                    </div>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => setIsRequestOpen(true)} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 font-extrabold cursor-pointer shrink-0 py-2.5 px-5 rounded-xl shadow-xs">
                    <Plus className="w-4 h-4 mr-1.5" /> Plan Holiday Now
                  </Button>
                </div>
              );
            }
          })()}

          {/* TWO-COLUMN LAYOUT: CALENDAR ON LEFT, QUOTAS & HISTORY ON RIGHT */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: INTERACTIVE LEAVE CALENDAR (7 COLS) */}
            <div className="lg:col-span-7 space-y-6" onMouseUp={handleCalendarMouseUp} onMouseLeave={() => { if (isDragging) { setIsDragging(false); setDragStart(null); setDragCurrent(null); } }}>
              <Card 
                title="Interactive Leave & Holiday Calendar" 
                subtitle="View your holidays, public holidays, and company closures. Click & drag across dates to immediately file time-off!"
                className="border-slate-200 shadow-sm"
              >
                <div className="space-y-4 mt-2">
                  {/* Calendar Navigation Header */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <div className="flex items-center space-x-2">
                      <Button size="sm" variant="outline" onClick={() => setCalendarMonth(prev => subMonths(prev, 1))} className="p-2 cursor-pointer border-slate-200 bg-white shadow-2xs hover:bg-slate-100">
                        <ChevronLeft className="w-4 h-4 text-slate-700" />
                      </Button>
                      <h4 className="font-black text-slate-800 text-base min-w-[150px] text-center font-mono">
                        {format(calendarMonth, 'MMMM yyyy')}
                      </h4>
                      <Button size="sm" variant="outline" onClick={() => setCalendarMonth(prev => addMonths(prev, 1))} className="p-2 cursor-pointer border-slate-200 bg-white shadow-2xs hover:bg-slate-100">
                        <ChevronRight className="w-4 h-4 text-slate-700" />
                      </Button>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setCalendarMonth(new Date('2026-07-01T00:00:00'))} className="text-xs font-extrabold cursor-pointer border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 shadow-2xs">
                      Today (July 2026)
                    </Button>
                  </div>

                  {/* Quick Guide Banner */}
                  <div className="p-3 rounded-xl bg-gradient-to-r from-sky-500/10 via-[#3D87D3]/10 to-indigo-500/10 border border-[#3D87D3]/20 flex items-center justify-between text-xs text-[#2b6097] font-bold">
                    <span className="flex items-center">
                      <Sparkles className="w-4 h-4 mr-1.5 text-[#3D87D3] shrink-0" />
                      ✨ Click &amp; drag across dates on the grid below to instantly select your vacation dates and apply!
                    </span>
                  </div>

                  {/* Calendar Legend */}
                  <div className="flex items-center gap-4 text-[11px] font-bold text-slate-600 px-1 flex-wrap">
                    <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-[#3D87D3] mr-1.5 inline-block shadow-2xs" /> My Approved / Pending Leaves</span>
                    <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-indigo-600 mr-1.5 inline-block shadow-2xs" /> Mandatory Closure</span>
                    <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 mr-1.5 inline-block shadow-2xs" /> Greek Public Holiday</span>
                  </div>

                  {/* Day of Week Headers */}
                  <div className="grid grid-cols-7 gap-1 text-center font-extrabold text-[11px] text-slate-500 uppercase tracking-wider pt-2 border-t border-slate-100">
                    <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div className="text-rose-600">Sat</div><div className="text-rose-600">Sun</div>
                  </div>

                  {/* Date Grid */}
                  <div className="grid grid-cols-7 gap-1.5 select-none">
                    {(() => {
                      const gridStart = startOfWeek(startOfMonth(calendarMonth), { weekStartsOn: 1 });
                      const gridEnd = endOfWeek(endOfMonth(calendarMonth), { weekStartsOn: 1 });
                      const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

                      return days.map(d => {
                        const dayStr = format(d, 'yyyy-MM-dd');
                        const isCurrentMonth = isSameMonth(d, calendarMonth);
                        const isSelected = isSelectedDuringDrag(dayStr);

                        const pubHoliday = publicHolidays.find(h => h.date === dayStr);
                        const mandatory = mandatoryLeaves.find(m => dayStr >= m.start_date && dayStr <= m.end_date) || leaveRequests.find(r => r.origin === 'mandatory' && dayStr >= r.start_date && dayStr <= r.end_date);
                        const myLeavesOnDay = leaveRequests.filter(r => r.profile_id === currentUser.id && r.origin !== 'mandatory' && r.status !== 'cancelled' && r.status !== 'rejected' && dayStr >= r.start_date && dayStr <= r.end_date);
                        const isWeekend = format(d, 'EEE') === 'Sat' || format(d, 'EEE') === 'Sun';

                        return (
                          <div 
                            key={dayStr}
                            onMouseDown={() => handleDayMouseDown(dayStr)}
                            onMouseEnter={() => handleDayMouseEnter(dayStr)}
                            className={`min-h-[95px] p-2 rounded-xl border transition-all flex flex-col justify-between overflow-hidden cursor-pointer ${
                              isSelected 
                                ? 'bg-[#3D87D3]/20 border-2 border-[#3D87D3] shadow-md scale-[0.98]' 
                                : isCurrentMonth 
                                  ? isWeekend ? 'bg-slate-50/70 border-slate-200 hover:border-[#3D87D3]' : 'bg-white border-slate-200/90 shadow-2xs hover:border-[#3D87D3] hover:shadow-xs' 
                                  : 'bg-slate-100/50 border-slate-200/60 opacity-60 text-slate-400 hover:opacity-80'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-extrabold font-mono ${isSelected ? 'text-[#1e4872]' : isCurrentMonth ? (isWeekend ? 'text-rose-600' : 'text-slate-800') : 'text-slate-400'}`}>
                                {format(d, 'd')}
                              </span>
                              {dayStr === todayStr && (
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" title="Today" />
                              )}
                            </div>

                            <div className="space-y-1 mt-1 overflow-hidden">
                              {pubHoliday && (
                                <div className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 text-[10px] font-extrabold truncate" title={pubHoliday.name_en}>
                                  🔴 {pubHoliday.name_en}
                                </div>
                              )}
                              {mandatory && !pubHoliday && (
                                <div className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-extrabold truncate">
                                  🟣 Company Closure
                                </div>
                              )}
                              {myLeavesOnDay.map(req => {
                                const lt = leaveTypes.find(t => t.id === req.leave_type_id);
                                return (
                                  <div 
                                    key={req.id} 
                                    className="px-1.5 py-0.5 rounded text-[10px] font-extrabold text-white truncate shadow-2xs flex items-center justify-between"
                                    style={{ backgroundColor: lt?.colour || '#3D87D3' }}
                                    title={`${lt?.name_en} (${req.status})`}
                                  >
                                    <span className="truncate">{lt?.name_el || 'Leave'}</span>
                                    <span className="ml-1 text-[9px] uppercase font-mono opacity-90">{req.status === 'pending' ? '⏳' : '✓'}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </Card>
            </div>

            {/* RIGHT COLUMN: LEAVE CATEGORY QUOTAS & PERSONAL LEAVE HISTORY (5 COLS) */}
            <div className="lg:col-span-5 space-y-6">
              {/* LEAVE CATEGORIES BREAKDOWN ("THE BIG PICTURE") */}
              <div className="space-y-3">
                <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider flex items-center">
                  <Briefcase className="w-4 h-4 mr-2 text-[#3D87D3]" /> Leave Category Quotas &amp; Policy Rules
                </h3>
                <div className="space-y-3">
                  {leaveTypes.map(lt => {
                    const myCatLeaves = leaveRequests.filter(r => r.profile_id === currentUser.id && r.leave_type_id === lt.id);
                    const approvedDays = myCatLeaves.filter(r => r.status === 'approved' || r.status === 'taken').reduce((a, b) => a + b.working_days, 0);
                    const pendingDays = myCatLeaves.filter(r => r.status === 'pending').reduce((a, b) => a + b.working_days, 0);
                    const isAnnual = lt.id === 'lt-annual' || lt.id === 'vacation' || lt.name_en?.toLowerCase().includes('annual') || lt.name_en?.toLowerCase().includes('vacation');

                    return (
                      <Card key={lt.id} className="border-slate-200 shadow-2xs hover:shadow-xs transition-all relative overflow-hidden p-4 bg-white">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="w-3 h-3 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: lt.colour || '#3D87D3' }} />
                              <h4 className="font-extrabold text-slate-900 text-sm">{lt.name_el}</h4>
                              <span className="text-xs text-slate-500 font-bold">({lt.name_en})</span>
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
              <Card title="My Personal Leave History" subtitle="Audit trail of all applications submitted by you in 2026" className="border-slate-200 shadow-xs">
                <div className="space-y-3 mt-2 max-h-[550px] overflow-y-auto pr-1">
                  {(() => {
                    const myHistory = leaveRequests.filter(r => r.profile_id === currentUser.id);
                    if (myHistory.length === 0) {
                      return (
                        <div className="p-8 text-center text-slate-500 text-xs border border-dashed rounded-xl">
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
                              Dates: <strong className="text-slate-800 font-mono font-bold">{req.start_date} &rarr; {req.end_date}</strong> &bull; Deduction: <strong className="text-[#3D87D3] font-black">{req.working_days}d</strong>
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
      )}

      {/* TAB 1: SHARED FOUNDER APPROVAL QUEUE & REGISTER (ADMIN ONLY) */}
      {tab === 'requests' && isAdmin && (
        <Card title="Shared Founder Approval Queue & Team Register" subtitle="Organization-wide oversight of employee leave applications">
          <div className="space-y-3 mt-2">
            {leaveRequests.map(req => {
              const prof = profiles.find(p => p.id === req.profile_id);
              const lType = leaveTypes.find(lt => lt.id === req.leave_type_id);
              const isMandatory = req.origin === 'mandatory';
              const isSelf = req.profile_id === currentUser.id;
              const isFuture = isAfter(parseISO(req.start_date), parseISO(todayStr));

              return (
                <div key={req.id} className={`p-4 rounded-xl bg-white border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs ${
                  req.status === 'cancellation_requested' ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 hover:border-slate-300'
                }`}>
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center space-x-2.5">
                      <span className="font-extrabold text-sm text-slate-900">{prof?.first_name} {prof?.last_name}</span>
                      <Badge variant="neutral" className="text-[10px] font-bold" style={{ borderColor: lType?.colour }}>{lType?.name_el} ({lType?.name_en})</Badge>
                      {isMandatory && <Badge variant="info" className="text-[10px] bg-[#3D87D3]/10 text-[#3D87D3] border-[#3D87D3]/20 font-bold">Company-Wide Closure</Badge>}
                      {req.origin === 'admin_entry' && <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold">Admin Entry</span>}
                    </div>
                    <p className="text-xs text-slate-500 font-medium">
                      Dates: <strong className="text-slate-700 font-mono font-bold">{req.start_date} &rarr; {req.end_date}</strong> &bull; Deduction: <strong className="text-[#3D87D3] font-black">{req.working_days} working days</strong>
                    </p>
                    <p className="text-[11px] text-slate-600 italic">&ldquo;{req.note || 'No notes attached'}&rdquo;</p>

                    {req.rejection_reason && (
                      <div className="mt-1 p-2 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800 font-bold">
                        <strong>Rejection Reason:</strong> {req.rejection_reason}
                      </div>
                    )}
                    {req.admin_edit_reason && (
                      <div className="mt-1 p-2 rounded bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-900 flex items-center font-bold">
                        <Edit3 className="w-3.5 h-3.5 mr-1.5 text-indigo-600 shrink-0" />
                        <span><strong>Admin Modification:</strong> {req.admin_edit_reason}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${
                      req.ergani_status === 'submitted' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                      req.ergani_status === 'needs_amendment' ? 'bg-rose-50 text-rose-800 border-rose-300 animate-pulse' :
                      req.ergani_status === 'pending' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}>
                      ΕΡΓΑΝΗ: {req.ergani_status}
                    </span>

                    {req.status === 'pending' ? (
                      <div className="flex items-center space-x-1.5">
                        <Button 
                          size="sm" variant="primary" className="bg-emerald-600 hover:bg-emerald-500 font-extrabold border-none text-xs cursor-pointer"
                          onClick={() => updateLeaveRequestStatus(req.id, 'approved')}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                        </Button>
                        <Button 
                          size="sm" variant="danger" className="text-xs font-extrabold cursor-pointer"
                          onClick={() => setRejectModalTarget(req.id)}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" /> Reject...
                        </Button>
                      </div>
                    ) : req.status === 'cancellation_requested' ? (
                      <div className="flex items-center space-x-1.5">
                        <Button size="sm" variant="primary" className="bg-amber-600 hover:bg-amber-500 text-xs font-extrabold cursor-pointer" onClick={() => decideLeaveCancellation(req.id, true)}>
                          Accept Cancel
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs font-bold cursor-pointer" onClick={() => decideLeaveCancellation(req.id, false)}>
                          Decline
                        </Button>
                      </div>
                    ) : (
                      <Badge variant={
                        req.status === 'approved' || req.status === 'taken' ? 'success' : 
                        req.status === 'rejected' ? 'error' : 
                        req.status === 'cancelled' ? 'neutral' : 'warning'
                      } className="text-xs py-1 px-2.5 uppercase font-bold">
                        {req.status.replace('_', ' ')}
                      </Badge>
                    )}

                    {/* Admin Post-Approval Editor button */}
                    {(req.status === 'approved' || req.status === 'in_progress' || req.status === 'taken') && (
                      <Button size="sm" variant="outline" className="text-xs font-bold text-indigo-700 border-indigo-200 hover:bg-indigo-50 cursor-pointer flex items-center" onClick={() => {
                        setEditingLeave(req);
                        setEditStartDate(req.start_date);
                        setEditEndDate(req.end_date);
                        setEditNote(req.note || '');
                        setEditReason('');
                      }}>
                        <Edit3 className="w-3.5 h-3.5 mr-1 text-indigo-600" /> Admin Edit
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* TAB 2: TEAM CALENDAR WITH PRIVACY LENSES (§4) */}
      {tab === 'calendar' && (
        <Card title="Team Out-of-Office Calendar" subtitle={isAdmin ? "Admin view: Full leave types, medical reasons, and attachment notes visible." : "Colleague view: Strict operational privacy lens applied (Names and dates only; medical and personal reasons hidden)."}>
          <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-900 to-blue-800 text-white flex items-center justify-between mb-6 shadow-xs">
            <div>
              <h4 className="font-bold text-sm flex items-center">✨ Try our Interactive Unified Calendar!</h4>
              <p className="text-xs text-slate-200 mt-0.5">View leaves, public holidays, and remote teleworking schedules on an interactive monthly date grid.</p>
            </div>
            <Link href="/calendar" className="px-4 py-2 bg-white text-indigo-950 hover:bg-slate-100 font-extrabold text-xs rounded-xl transition-all shadow-sm shrink-0">
              Open Company Calendar &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
            {leaveRequests.filter(r => r.status === 'approved' || r.status === 'in_progress' || r.status === 'taken').map(req => {
              const prof = profiles.find(p => p.id === req.profile_id);
              const lType = leaveTypes.find(lt => lt.id === req.leave_type_id);
              const isSelf = req.profile_id === currentUser.id;
              const showFullDetail = isAdmin || isSelf;

              return (
                <div key={req.id} className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="font-bold text-slate-800 text-sm">{prof?.first_name} {prof?.last_name}</span>
                      {showFullDetail ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold text-white shadow-2xs" style={{ backgroundColor: lType?.colour }}>
                          {lType?.name_en}
                        </span>
                      ) : (
                        <Badge variant="neutral" className="text-[10px] bg-slate-100 text-slate-700 font-semibold">
                          Out-of-Office
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-bold text-[#3D87D3] font-mono mt-1">{req.start_date} &rarr; {req.end_date}</p>
                    <p className="text-xs text-slate-500 mt-1">{req.working_days} scheduled working days</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                    {showFullDetail ? (
                      <span className="text-slate-700 font-medium block italic">&ldquo;{req.note}&rdquo;</span>
                    ) : (
                      <span className="text-slate-400 italic flex items-center">
                        <FileText className="w-3.5 h-3.5 mr-1 text-slate-400" /> Details restricted (Privacy Lens)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* TAB 3: MANDATORY LEAVES */}
      {tab === 'mandatory' && isAdmin && (
        <Card title="Company-Wide Mandatory Leave Register" subtitle="Admin-declared mandatory breaks (Christmas, August closure) counting directly against employees' annual balances">
          <div className="space-y-4 mt-2">
            {mandatoryLeaves.map(ml => (
              <div key={ml.id} className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-base text-slate-800">{ml.name}</h4>
                  <Badge variant="info">{ml.status.toUpperCase()}</Badge>
                </div>
                <p className="text-xs text-slate-500">
                  Dates: <strong className="text-[#3D87D3] font-mono">{ml.start_date} &rarr; {ml.end_date}</strong> &bull; Notes: {ml.note}
                </p>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs flex items-center justify-between font-medium">
                  <span>Fan-Out Status: <strong className="text-slate-900">Active</strong> across all full-time and part-time staff (contractors excluded).</span>
                  <span>Part-time schedules respected</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}


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
              {leaveTypes.map(lt => <option key={lt.id} value={lt.id}>{lt.name_el} ({lt.name_en})</option>)}
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Start Date</label>
              <input 
                type="date" 
                value={startDate} 
                min={isAdmin || minNoticeDays === 0 ? undefined : earliestValidDate}
                onChange={e => setStartDate(e.target.value)} 
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">End Date</label>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)} 
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono"
              />
            </div>
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
              {isAdmin ? 'Record Approved Admin Entry &rarr;' : 'Submit for Approval &rarr;'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* REJECTION REASON MODAL (§1) */}
      <Modal isOpen={!!rejectModalTarget} onClose={() => setRejectModalTarget(null)} title="Provide Leave Rejection Explanation">
        <div className="space-y-4 text-xs">
          <p className="text-slate-600">
            Please provide an explanation for rejecting this leave request. This will be visible to the employee on their request card to maintain transparent communication.
          </p>
          <textarea
            rows={3}
            value={rejectionReasonInput}
            onChange={e => setRejectionReasonInput(e.target.value)}
            placeholder="e.g. Overlapping absences in critical team window, please propose alternative dates..."
            className="w-full bg-white border border-slate-200 rounded p-2.5 text-slate-800 placeholder:text-slate-400"
          />
          <div className="flex justify-end space-x-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setRejectModalTarget(null)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleConfirmReject}>Confirm Rejection &rarr;</Button>
          </div>
        </div>
      </Modal>

      {/* ADMIN POST-APPROVAL EDITOR & PARTIAL CANCELLATION MODAL (§2) */}
      <Modal isOpen={!!editingLeave} onClose={() => setEditingLeave(null)} title="Admin Post-Approval Modification / Partial Cancel">
        {editingLeave && (
          <form onSubmit={handleSaveAdminEdit} className="space-y-4 text-xs">
            <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-900 font-medium flex items-center justify-between">
              <span>Current Status: <strong>{editingLeave.status.toUpperCase()}</strong></span>
              <span>ΕΡΓΑΝΗ: <strong>{editingLeave.ergani_status.toUpperCase()}</strong></span>
            </div>
            <p className="text-slate-600 text-[11px]">
              Use this tool when reality diverges from plan (e.g., employee returned early on the 3rd day or dates shifted). Adjusting days will atomically update the employee's entitlement balance.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">New Start Date</label>
                <input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono" />
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">New End Date / Early Return Date</label>
                <input type="date" value={editEndDate} onChange={e => setEditEndDate(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-mono" />
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-xs font-medium">
              <span>Recomputed Working Days:</span>
              <span className="text-base font-extrabold text-[#3D87D3] font-mono">{editedWorkingDays} Days (from {editingLeave.working_days})</span>
            </div>

            <div>
              <label className="block font-semibold uppercase text-slate-500 mb-1">Mandatory Modification Reason (For Audit & Employee Notification)</label>
              <input 
                type="text" 
                required 
                value={editReason} 
                onChange={e => setEditReason(e.target.value)} 
                placeholder="e.g. Employee returned to office early on Wednesday"
                className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800" 
              />
            </div>

            {editingLeave.ergani_status === 'submitted' && (
              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold flex items-center">
                <AlertTriangle className="w-4 h-4 mr-2 text-amber-600 shrink-0" />
                <span>Notice: Since this leave was marked as submitted to ΕΡΓΑΝΗ, this edit will automatically flip its status to NEEDS_AMENDMENT in the compliance widget.</span>
              </div>
            )}

            <div className="pt-2 flex justify-end space-x-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setEditingLeave(null)}>Cancel</Button>
              <Button variant="primary" size="sm" type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold">
                Save & Apply Atomic Balance Adjustment &rarr;
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* DECLARE MANDATORY LEAVE MODAL WITH PREVIEW-BEFORE-PUBLISH */}
      <Modal isOpen={isMandatoryOpen} onClose={() => { setIsMandatoryOpen(false); setPreviewMode(false); }} title="Declare Company-Wide Mandatory Leave">
        <div className="space-y-4 text-xs">
          {!previewMode ? (
            <>
              <p className="text-slate-600">
                This will create a mandatory leave event and automatically fan out approved leave requests to all eligible active employees (excluding contractors), counting directly against their regular annual balance.
              </p>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Closure Title</label>
                <input type="text" value={mName} onChange={e => setMName(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 font-medium text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase text-slate-500 mb-1">Start Date</label>
                  <input type="date" value={mStart} onChange={e => setMStart(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800" />
                </div>
                <div>
                  <label className="block font-semibold uppercase text-slate-500 mb-1">End Date</label>
                  <input type="date" value={mEnd} onChange={e => setMEnd(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800" />
                </div>
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Announcement Note</label>
                <textarea rows={2} value={mNote} onChange={e => setMNote(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800" />
              </div>
              <div className="pt-2 flex justify-end space-x-2">
                <Button variant="outline" size="sm" onClick={() => setIsMandatoryOpen(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={() => setPreviewMode(true)} className="bg-[#3D87D3] hover:bg-[#3D87D3]/90">Preview Fan-Out Impact &rarr;</Button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-slate-100 border border-slate-200 text-slate-800 flex items-center justify-between font-semibold">
                <span>Previewing Fan-Out across StellarBlue Active Headcount</span>
                <Badge variant="info">Ready to Publish</Badge>
              </div>

              <div className="max-h-56 overflow-y-auto space-y-2 border border-slate-200 rounded-lg p-2 bg-slate-50">
                {profiles.filter(p => p.status === 'active').map(p => {
                  const isContractor = p.employment_type === 'contractor';
                  const isPartTime = p.employment_type === 'part_time';
                  const deductedDays = isContractor ? 0 : isPartTime ? 3 : 5;
                  
                  return (
                    <div key={p.id} className="p-2.5 rounded bg-white border border-slate-200 flex items-center justify-between text-xs shadow-2xs">
                      <div>
                        <span className="font-semibold text-slate-800">{p.first_name} {p.last_name}</span>
                        <span className="text-[10px] text-slate-500 ml-1.5">({p.employment_type})</span>
                      </div>
                      <div>
                        {isContractor ? (
                          <span className="text-slate-400 font-mono">Skipped (Contractor)</span>
                        ) : (
                          <span className="text-[#3D87D3] font-mono font-bold">-{deductedDays} days deducted</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-medium">
                <strong>Policy reminder:</strong> If an employee has zero remaining balance, deduction still applies and balance becomes negative (flagged in admin reports, never blocked).
              </div>

              <div className="pt-2 flex justify-end space-x-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewMode(false)}>&larr; Back to Edit</Button>
                <Button variant="primary" size="sm" onClick={handlePublishMandatory} className="bg-emerald-600 hover:bg-emerald-500 font-bold">
                  Confirm & Publish Mandatory Leave &rarr;
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
