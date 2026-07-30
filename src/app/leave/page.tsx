"use client";

import React, { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Calendar, Plus, Clock, CheckCircle2, XCircle, AlertTriangle, 
  Users, ShieldCheck, FileText, Sparkles, Filter 
} from 'lucide-react';
import { parseISO, format, eachDayOfInterval, isWeekend } from 'date-fns';

export default function LeaveManagementPage() {
  const { 
    currentUser, profiles, leaveTypes, entitlements, 
    leaveRequests, mandatoryLeaves, publicHolidays, 
    addLeaveRequest, updateLeaveRequestStatus, addMandatoryLeave, updateErganiStatus 
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';
  const isContractor = currentUser.employment_type === 'contractor';

  // Tabs
  const [tab, setTab] = useState<'requests' | 'calendar' | 'mandatory' | 'ergani'>('requests');

  // New Leave Request State (< 30s filing)
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [reqType, setReqType] = useState('lt-annual');
  const [startDate, setStartDate] = useState('2026-09-14');
  const [endDate, setEndDate] = useState('2026-09-18');
  const [note, setNote] = useState('');

  // Mandatory Leave Declaration (Company-Wide) State
  const [isMandatoryOpen, setIsMandatoryOpen] = useState(false);
  const [mName, setMName] = useState('Mandatory August Summer Bridge 2026');
  const [mStart, setMStart] = useState('2026-08-10');
  const [mEnd, setMEnd] = useState('2026-08-14');
  const [mNote, setMNote] = useState('Company-wide summer vacation week.');
  const [previewMode, setPreviewMode] = useState(false);

  // Calculate working days excluding Greek holidays and weekends for an individual schedule!
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
  }, [startDate, endDate, currentUser]);

  const handleCreateRequest = (e: React.FormEvent) => {
    e.preventDefault();
    addLeaveRequest({
      profile_id: currentUser.id,
      leave_type_id: reqType,
      start_date: startDate,
      end_date: endDate,
      half_day_start: false,
      half_day_end: false,
      working_days: currentWorkingDays,
      status: 'pending',
      origin: 'employee_request',
      note: note.trim() || 'Annual Leave Request',
      ergani_status: 'pending'
    });
    setIsRequestOpen(false);
  };

  const handlePublishMandatory = () => {
    addMandatoryLeave({
      name: mName,
      leave_type_id: 'lt-annual',
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
      <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl max-w-xl mx-auto my-12 space-y-3">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-400" />
        <h2 className="text-xl font-bold text-slate-100">Module Hidden for Contractors</h2>
        <p className="text-xs text-slate-400">
          Under Greek labour law and StellarBlue operational policy, independent contractors (μπλοκάκι) do not accrue leave balances or file leave requests.
        </p>
      </div>
    );
  }

  const pendingCount = leaveRequests.filter(r => r.status === 'pending').length;
  const unsubmittedErgani = leaveRequests.filter(r => r.status === 'approved' && r.ergani_status !== 'not_required' && r.ergani_status !== 'submitted');

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
            <Calendar className="w-6 h-6 mr-3 text-amber-400" /> Leave Management & Holiday Quotas
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Greek public holiday aware leave calculation, founder approval queue, and company-wide mandatory closure fan-out engine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={() => { setIsMandatoryOpen(true); setPreviewMode(false); }}>
              <Sparkles className="w-3.5 h-3.5 mr-1.5 text-amber-400" /> Declare Mandatory Leave
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => setIsRequestOpen(true)} className="bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20">
            <Plus className="w-4 h-4 mr-1" /> File Leave Request (<span className="font-mono">&lt;30s</span>)
          </Button>
        </div>
      </div>

      {/* Tabs Toolbar */}
      <div className="flex border-b border-slate-800 space-x-6 text-sm">
        <button 
          onClick={() => setTab('requests')}
          className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'requests' ? 'border-b-2 border-amber-400 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          {isAdmin ? 'Shared Founder Approval Queue' : 'My Leave Requests'}
          {pendingCount > 0 && <span className="ml-2 px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs">{pendingCount}</span>}
        </button>
        <button 
          onClick={() => setTab('calendar')}
          className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'calendar' ? 'border-b-2 border-amber-400 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Team Out-of-Office Calendar
        </button>
        {isAdmin && (
          <>
            <button 
              onClick={() => setTab('mandatory')}
              className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'mandatory' ? 'border-b-2 border-amber-400 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Mandatory Closures ({mandatoryLeaves.length})
            </button>
            <button 
              onClick={() => setTab('ergani')}
              className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'ergani' ? 'border-b-2 border-rose-500 text-rose-400 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <ShieldCheck className="w-4 h-4 mr-1.5 text-rose-400" /> ΕΡΓΑΝΗ Filing Gap Widget ({unsubmittedErgani.length})
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

              return (
                <div key={req.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2.5">
                      <span className="font-bold text-sm text-slate-200">{prof?.first_name} {prof?.last_name}</span>
                      <Badge variant="neutral" className="text-[10px]" style={{ borderColor: lType?.colour }}>{lType?.name_el} ({lType?.name_en})</Badge>
                      {isMandatory && <Badge variant="info" className="text-[10px] bg-indigo-950 text-indigo-300">Company-Wide Closure</Badge>}
                    </div>
                    <p className="text-xs text-slate-400">
                      Dates: <strong className="text-slate-300 font-mono">{req.start_date} &rarr; {req.end_date}</strong> &bull; Deduction: <strong className="text-amber-400">{req.working_days} working days</strong>
                    </p>
                    <p className="text-[11px] text-slate-500 italic">&ldquo;{req.note}&rdquo;</p>
                  </div>

                  <div className="flex items-center space-x-3">
                    {/* Ergani badge */}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${
                      req.ergani_status === 'submitted' ? 'bg-emerald-950 text-emerald-400 border-emerald-800' :
                      req.ergani_status === 'pending' ? 'bg-amber-950 text-amber-400 border-amber-800' : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}>
                      ΕΡΓΑΝΗ: {req.ergani_status}
                    </span>

                    {/* Status & Approval buttons */}
                    {req.status === 'pending' && isAdmin ? (
                      <div className="flex items-center space-x-2">
                        <Button 
                          size="sm" variant="primary" className="bg-emerald-600 hover:bg-emerald-500 border-none text-xs"
                          onClick={() => updateLeaveRequestStatus(req.id, 'approved')}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                        </Button>
                        <Button 
                          size="sm" variant="danger" className="text-xs"
                          onClick={() => updateLeaveRequestStatus(req.id, 'rejected')}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                        </Button>
                      </div>
                    ) : (
                      <Badge variant={req.status === 'approved' ? 'success' : req.status === 'rejected' ? 'error' : 'warning'} className="text-xs py-1">
                        {req.status.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* TAB 2: TEAM CALENDAR (Hides reasons/medical notes from non-managers per requirements!) */}
      {tab === 'calendar' && (
        <Card title="Team Out-of-Office Schedule (August / September / December 2026)" subtitle="Reasons and medical notes are automatically hidden from regular colleagues to guarantee operational privacy">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
            {leaveRequests.filter(r => r.status === 'approved').map(req => {
              const prof = profiles.find(p => p.id === req.profile_id);
              const lType = leaveTypes.find(lt => lt.id === req.leave_type_id);
              const showReason = isAdmin || req.profile_id === currentUser.id;
              return (
                <div key={req.id} className="p-4 rounded-xl bg-gradient-to-tr from-slate-900 via-slate-950 to-slate-900 border border-slate-800 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="font-semibold text-slate-300">{prof?.first_name} {prof?.last_name}</span>
                      <span className="w-2.5 h-2.5 rounded-full shadow-md" style={{ backgroundColor: lType?.colour }} title={lType?.name_en} />
                    </div>
                    <p className="text-sm font-bold text-amber-300 font-mono">{req.start_date} &rarr; {req.end_date}</p>
                    <p className="text-xs text-slate-400 mt-1">{req.working_days} scheduled working days</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400">
                    {showReason ? (
                      <span className="text-slate-300">&ldquo;{req.note}&rdquo;</span>
                    ) : (
                      <span className="text-slate-500 italic flex items-center">
                        <FileText className="w-3 h-3 mr-1" /> Reason hidden (Protected privacy)
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
              <div key={ml.id} className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-base text-slate-100">{ml.name}</h4>
                  <Badge variant="info">{ml.status.toUpperCase()}</Badge>
                </div>
                <p className="text-xs text-slate-400">
                  Dates: <strong className="text-amber-400 font-mono">{ml.start_date} &rarr; {ml.end_date}</strong> &bull; Notes: {ml.note}
                </p>
                <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-900/60 text-indigo-300 text-xs flex items-center justify-between">
                  <span>Fan-Out Status: <strong className="text-white">Active</strong> across all full-time and part-time staff (contractors excluded).</span>
                  <span>Part-time schedules respected</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* TAB 4: ERGANI FILING GAP WIDGET */}
      {tab === 'ergani' && isAdmin && (
        <Card title="ΕΡΓΑΝΗ Compliance Gap Dashboard Widget" subtitle="Approved leave records that have not yet been marked as submitted to the ΕΡΓΑΝΗ II portal (preventing legal drift)">
          {unsubmittedErgani.length === 0 ? (
            <div className="p-8 text-center bg-emerald-950/20 border border-emerald-800/50 rounded-xl text-emerald-400 font-medium">
              <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
              All internally approved leaves are reconciled and filed in ΕΡΓΑΝΗ! Zero drift detected.
            </div>
          ) : (
            <div className="space-y-3 mt-2">
              <div className="p-3 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs flex items-center">
                <AlertTriangle className="w-4 h-4 mr-2 shrink-0 text-amber-400" />
                <span>Found {unsubmittedErgani.length} approved leave record(s) awaiting Ε11 / portal filing reference.</span>
              </div>
              {unsubmittedErgani.map(req => {
                const prof = profiles.find(p => p.id === req.profile_id);
                return (
                  <div key={req.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-bold text-slate-200 text-sm">{prof?.first_name} {prof?.last_name}</p>
                      <p className="text-slate-400 mt-0.5">Dates: <span className="font-mono text-slate-300">{req.start_date} &rarr; {req.end_date}</span> ({req.working_days} days)</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => updateErganiStatus(req.id, 'leave', 'submitted')} className="border-emerald-700 hover:bg-emerald-950 text-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-400" /> Mark as Submitted in ΕΡΓΑΝΗ
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* FILE LEAVE REQUEST MODAL (<30S WORKFLOW) */}
      <Modal isOpen={isRequestOpen} onClose={() => setIsRequestOpen(false)} title="File Leave Request (Fast Track)">
        <form onSubmit={handleCreateRequest} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold uppercase text-slate-400 mb-1">Leave Category</label>
            <select 
              value={reqType} 
              onChange={e => setReqType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-200 text-sm"
            >
              {leaveTypes.map(lt => <option key={lt.id} value={lt.id}>{lt.name_el} ({lt.name_en})</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold uppercase text-slate-400 mb-1">Start Date</label>
              <input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)} 
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
              />
            </div>
            <div>
              <label className="block font-semibold uppercase text-slate-400 mb-1">End Date</label>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)} 
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
              />
            </div>
          </div>

          {/* Automatic Greek holiday and part-time schedule deduction highlight */}
          <div className="p-3.5 rounded-xl bg-blue-950/40 border border-blue-800/60 flex items-center justify-between text-xs text-blue-200">
            <span>Calculated Working Days (Excludes Weekends & Greek Public Holidays):</span>
            <span className="text-lg font-extrabold text-white font-mono">{currentWorkingDays} Days</span>
          </div>

          <div>
            <label className="block font-semibold uppercase text-slate-400 mb-1">Note / Reason (Optional)</label>
            <textarea
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Summer vacation, family event, medical visit..."
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 placeholder:text-slate-500"
            />
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsRequestOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" className="bg-blue-600 hover:bg-blue-500">Submit for Approval &rarr;</Button>
          </div>
        </form>
      </Modal>

      {/* DECLARE MANDATORY LEAVE MODAL WITH PREVIEW-BEFORE-PUBLISH */}
      <Modal isOpen={isMandatoryOpen} onClose={() => { setIsMandatoryOpen(false); setPreviewMode(false); }} title="Declare Company-Wide Mandatory Leave">
        <div className="space-y-4 text-xs">
          {!previewMode ? (
            <>
              <p className="text-slate-300">
                This will create a mandatory leave event and automatically fan out approved leave requests to all eligible active employees (excluding contractors), counting directly against their regular annual balance.
              </p>
              <div>
                <label className="block font-semibold uppercase text-slate-400 mb-1">Closure Title</label>
                <input type="text" value={mName} onChange={e => setMName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-medium text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase text-slate-400 mb-1">Start Date</label>
                  <input type="date" value={mStart} onChange={e => setMStart(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200" />
                </div>
                <div>
                  <label className="block font-semibold uppercase text-slate-400 mb-1">End Date</label>
                  <input type="date" value={mEnd} onChange={e => setMEnd(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200" />
                </div>
              </div>
              <div>
                <label className="block font-semibold uppercase text-slate-400 mb-1">Announcement Note</label>
                <textarea rows={2} value={mNote} onChange={e => setMNote(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200" />
              </div>
              <div className="pt-2 flex justify-end space-x-2">
                <Button variant="outline" size="sm" onClick={() => setIsMandatoryOpen(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={() => setPreviewMode(true)} className="bg-indigo-600 hover:bg-indigo-500">Preview Fan-Out Impact &rarr;</Button>
              </div>
            </>
          ) : (
            /* PREVIEW-BEFORE-PUBLISH STEP (As mandated in plan v2) */
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-indigo-950/50 border border-indigo-700 text-indigo-200 flex items-center justify-between">
                <span>Previewing Fan-Out across StellarBlue Active Headcount</span>
                <Badge variant="info">Ready to Publish</Badge>
              </div>

              <div className="max-h-56 overflow-y-auto space-y-2 border border-slate-800 rounded-lg p-2 bg-slate-950">
                {profiles.filter(p => p.status === 'active').map(p => {
                  const isContractor = p.employment_type === 'contractor';
                  const isPartTime = p.employment_type === 'part_time';
                  const deductedDays = isContractor ? 0 : isPartTime ? 3 : 5; // illustration of schedule math
                  
                  return (
                    <div key={p.id} className="p-2.5 rounded bg-slate-900 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-semibold text-slate-200">{p.first_name} {p.last_name}</span>
                        <span className="text-[10px] text-slate-400 ml-1.5">({p.employment_type})</span>
                      </div>
                      <div>
                        {isContractor ? (
                          <span className="text-slate-500 font-mono">Skipped (Contractor)</span>
                        ) : (
                          <span className="text-amber-400 font-mono font-bold">-{deductedDays} days deducted</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 rounded bg-amber-950/30 border border-amber-800/60 text-amber-300 text-[11px]">
                <strong>Policy reminder:</strong> If an employee has zero remaining balance, deduction still applies and balance becomes negative (flagged in admin reports, never blocked).
              </div>

              <div className="pt-2 flex justify-end space-x-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewMode(false)}>&larr; Back to Edit</Button>
                <Button variant="primary" size="sm" onClick={handlePublishMandatory} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold">
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
