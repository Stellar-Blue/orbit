"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Calendar, Plus, Clock, CheckCircle2, XCircle, AlertTriangle, 
  Users, ShieldCheck, FileText, Sparkles, Filter, Edit3, HelpCircle, ArrowRight, ShieldAlert
} from 'lucide-react';
import { parseISO, format, eachDayOfInterval, addDays, isAfter, isBefore } from 'date-fns';
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
  const [tab, setTab] = useState<'requests' | 'calendar' | 'mandatory' | 'ergani'>('requests');

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

      {/* BALANCE EQUATION CLARITY CARD (§7) */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-[#3D87D3] text-white shadow-md border border-slate-700">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3 pb-3 border-b border-white/10">
          <div className="flex items-center space-x-2">
            <HelpCircle className="w-5 h-5 text-sky-400 shrink-0" />
            <div>
              <h3 className="text-sm font-bold tracking-wide uppercase text-white">Your 2026 Leave Equation (Balance Breakdown)</h3>
              <p className="text-[11px] text-slate-300">Complete transparency on how your available balance is calculated in real time</p>
            </div>
          </div>
          <div className="flex items-center space-x-3 text-right">
            <span className="text-xs uppercase text-slate-300 font-semibold">Net Available:</span>
            <span className="px-3 py-1 rounded-full bg-emerald-500 text-white font-black text-lg font-mono shadow-xs">
              {myBalance.available} Days
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-white/10 border border-white/15">
            <p className="text-[10px] uppercase text-slate-300 font-bold">Annual Entitlement</p>
            <p className="text-lg font-extrabold font-mono text-white mt-0.5">{myBalance.entitlement} days</p>
          </div>
          <div className="p-3 rounded-xl bg-white/10 border border-white/15">
            <p className="text-[10px] uppercase text-sky-300 font-bold">+ Carry-Over</p>
            <p className="text-lg font-extrabold font-mono text-sky-400 mt-0.5">{myBalance.carryOver} days</p>
            <p className="text-[9px] text-slate-300 mt-0.5">Expires {myBalance.carryOverExpires}</p>
          </div>
          <div className="p-3 rounded-xl bg-white/10 border border-white/15">
            <p className="text-[10px] uppercase text-amber-300 font-bold">− Taken / Approved</p>
            <p className="text-lg font-extrabold font-mono text-amber-300 mt-0.5">−{myBalance.taken} days</p>
          </div>
          <div className="p-3 rounded-xl bg-white/10 border border-white/15">
            <p className="text-[10px] uppercase text-purple-300 font-bold">− Reserved (Pending)</p>
            <p className="text-lg font-extrabold font-mono text-purple-300 mt-0.5">−{myBalance.reserved} days</p>
          </div>
          <div className="p-3 rounded-xl bg-white/10 border border-white/15">
            <p className="text-[10px] uppercase text-indigo-300 font-bold">− Mandatory Closures</p>
            <p className="text-lg font-extrabold font-mono text-indigo-300 mt-0.5">−{myBalance.mandatory} days</p>
          </div>
        </div>
      </div>

      {/* Tabs Toolbar */}
      <div className="flex border-b border-slate-200 space-x-6 text-sm">
        <button 
          onClick={() => setTab('requests')}
          className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'requests' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
        >
          {isAdmin ? 'Shared Founder Approval Queue & Register' : 'My Leave Requests & History'}
          {pendingCount > 0 && <span className="ml-2 px-2 py-0.5 rounded-full bg-[#3D87D3]/10 border border-[#3D87D3]/20 text-[#3D87D3] font-bold text-xs">{pendingCount}</span>}
        </button>
        <button 
          onClick={() => setTab('calendar')}
          className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'calendar' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Team Out-of-Office Calendar (Privacy Lens)
        </button>
        {isAdmin && (
          <>
            <button 
              onClick={() => setTab('mandatory')}
              className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'mandatory' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Mandatory Closures ({mandatoryLeaves.length})
            </button>
            <button 
              onClick={() => setTab('ergani')}
              className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'ergani' ? 'border-b-2 border-rose-600 text-rose-600 font-bold' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <ShieldCheck className="w-4 h-4 mr-1.5 text-rose-600" /> ΕΡΓΑΝΗ Filing & Amendment Drift ({unsubmittedErgani.length})
            </button>
          </>
        )}
      </div>

      {/* TAB 1: REQUESTS & APPROVAL QUEUE */}
      {tab === 'requests' && (
        <Card title={isAdmin ? "Shared Admin Queue & Leave Register" : "My Submitted Leaves & Balances"}>
          <div className="space-y-3 mt-2">
            {leaveRequests.filter(r => isAdmin || r.profile_id === currentUser.id).map(req => {
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
                      <span className="font-bold text-sm text-slate-800">{prof?.first_name} {prof?.last_name}</span>
                      <Badge variant="neutral" className="text-[10px]" style={{ borderColor: lType?.colour }}>{lType?.name_el} ({lType?.name_en})</Badge>
                      {isMandatory && <Badge variant="info" className="text-[10px] bg-[#3D87D3]/10 text-[#3D87D3] border-[#3D87D3]/20">Company-Wide Closure</Badge>}
                      {req.origin === 'admin_entry' && <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold">Admin Entry</span>}
                    </div>
                    <p className="text-xs text-slate-500">
                      Dates: <strong className="text-slate-700 font-mono">{req.start_date} &rarr; {req.end_date}</strong> &bull; Deduction: <strong className="text-[#3D87D3]">{req.working_days} working days</strong>
                    </p>
                    <p className="text-[11px] text-slate-600 italic">&ldquo;{req.note}&rdquo;</p>

                    {/* Audit explanations (§1 & §2) */}
                    {req.rejection_reason && (
                      <div className="mt-1 p-2 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                        <strong>Rejection Reason:</strong> {req.rejection_reason}
                      </div>
                    )}
                    {req.admin_edit_reason && (
                      <div className="mt-1 p-2 rounded bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-900 flex items-center">
                        <Edit3 className="w-3.5 h-3.5 mr-1.5 text-indigo-600 shrink-0" />
                        <span><strong>Admin Modification:</strong> {req.admin_edit_reason}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Ergani badge */}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${
                      req.ergani_status === 'submitted' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                      req.ergani_status === 'needs_amendment' ? 'bg-rose-50 text-rose-800 border-rose-300 animate-pulse' :
                      req.ergani_status === 'pending' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}>
                      ΕΡΓΑΝΗ: {req.ergani_status}
                    </span>

                    {/* Status & Approval / Cancellation action buttons */}
                    {req.status === 'pending' && isAdmin ? (
                      <div className="flex items-center space-x-1.5">
                        <Button 
                          size="sm" variant="primary" className="bg-emerald-600 hover:bg-emerald-500 border-none text-xs cursor-pointer"
                          onClick={() => updateLeaveRequestStatus(req.id, 'approved')}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                        </Button>
                        <Button 
                          size="sm" variant="danger" className="text-xs cursor-pointer"
                          onClick={() => setRejectModalTarget(req.id)}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" /> Reject...
                        </Button>
                      </div>
                    ) : req.status === 'cancellation_requested' && isAdmin ? (
                      <div className="flex items-center space-x-1.5">
                        <Button size="sm" variant="primary" className="bg-amber-600 hover:bg-amber-500 text-xs cursor-pointer" onClick={() => decideLeaveCancellation(req.id, true)}>
                          Accept Cancel
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs cursor-pointer" onClick={() => decideLeaveCancellation(req.id, false)}>
                          Decline
                        </Button>
                      </div>
                    ) : (
                      <Badge variant={
                        req.status === 'approved' || req.status === 'taken' ? 'success' : 
                        req.status === 'rejected' ? 'error' : 
                        req.status === 'cancelled' ? 'neutral' : 'warning'
                      } className="text-xs py-1 uppercase">
                        {req.status.replace('_', ' ')}
                      </Badge>
                    )}

                    {/* Employee actions (§1): Cancel freely when pending; Request cancellation when approved future */}
                    {isSelf && req.status === 'pending' && (
                      <Button size="sm" variant="outline" className="text-[11px] text-rose-600 border-rose-300 hover:bg-rose-50 cursor-pointer" onClick={() => updateLeaveRequestStatus(req.id, 'cancelled')}>
                        Cancel Request
                      </Button>
                    )}
                    {isSelf && req.status === 'approved' && isFuture && (
                      <Button size="sm" variant="outline" className="text-[11px] text-amber-700 border-amber-300 hover:bg-amber-50 cursor-pointer" onClick={() => requestLeaveCancellation(req.id)}>
                        Request Cancellation
                      </Button>
                    )}

                    {/* Admin Post-Approval Editor button (§2) */}
                    {isAdmin && (req.status === 'approved' || req.status === 'in_progress' || req.status === 'taken') && (
                      <Button size="sm" variant="outline" className="text-[11px] text-indigo-700 border-indigo-200 hover:bg-indigo-50 cursor-pointer flex items-center" onClick={() => {
                        setEditingLeave(req);
                        setEditStartDate(req.start_date);
                        setEditEndDate(req.end_date);
                        setEditNote(req.note || '');
                        setEditReason('');
                      }}>
                        <Edit3 className="w-3 h-3 mr-1" /> Admin Edit
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

      {/* TAB 4: ERGANI FILING & AMENDMENT DRIFT WIDGET (§2 & §5) */}
      {tab === 'ergani' && isAdmin && (
        <Card title="ΕΡΓΑΝΗ II Compliance & Amendment Drift Widget" subtitle="Approved or post-approval modified leaves requiring initial submission or portal amendment (needs_amendment)">
          {unsubmittedErgani.length === 0 ? (
            <div className="p-8 text-center bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 font-medium">
              <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-emerald-600" />
              All internally approved leaves and admin amendments are fully reconciled in ΕΡΓΑΝΗ! Zero legal drift detected.
            </div>
          ) : (
            <div className="space-y-3 mt-2">
              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center font-medium">
                <AlertTriangle className="w-4 h-4 mr-2 shrink-0 text-amber-600" />
                <span>Found {unsubmittedErgani.length} leave record(s) requiring portal action (pending filing or mandatory amendment).</span>
              </div>
              {unsubmittedErgani.map(req => {
                const prof = profiles.find(p => p.id === req.profile_id);
                const isAmendment = req.ergani_status === 'needs_amendment';

                return (
                  <div key={req.id} className={`p-4 rounded-xl bg-white border shadow-2xs flex items-center justify-between text-xs ${isAmendment ? 'border-rose-300 bg-rose-50/20' : 'border-slate-200'}`}>
                    <div>
                      <div className="flex items-center space-x-2">
                        <p className="font-bold text-slate-800 text-sm">{prof?.first_name} {prof?.last_name}</p>
                        {isAmendment && <Badge variant="error" className="text-[10px] animate-pulse">Needs Amendment</Badge>}
                      </div>
                      <p className="text-slate-500 mt-1">Dates: <span className="font-mono font-bold text-slate-700">{req.start_date} &rarr; {req.end_date}</span> ({req.working_days} working days)</p>
                      {req.admin_edit_reason && <p className="text-indigo-800 text-[11px] mt-0.5"><strong>Change reason:</strong> {req.admin_edit_reason}</p>}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => updateErganiStatus(req.id, 'leave', 'submitted')} className="border-emerald-600 hover:bg-emerald-50 text-emerald-700 font-semibold cursor-pointer shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Mark as Filed in ΕΡΓΑΝΗ
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
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
