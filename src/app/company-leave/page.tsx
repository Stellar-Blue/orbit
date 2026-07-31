"use client";

import React, { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, Modal } from '@/components/ui/primitives';
import { 
  Calendar, Clock, CheckCircle2, AlertTriangle, 
  Users, Filter, Edit3, ShieldAlert,
  Briefcase, Plus, Search, Settings, Trash2, Tag, Sliders
} from 'lucide-react';
import { parseISO, format, eachDayOfInterval } from 'date-fns';
import { LeaveRequest, LeaveType } from '@/lib/types';

export default function CompanyLeaveManagementPage() {
  const { 
    currentUser, profiles, leaveTypes, leaveRequests, mandatoryLeaves, publicHolidays, 
    updateLeaveRequestStatus, addMandatoryLeave,
    editLeaveRequest, decideLeaveCancellation,
    addLeaveType, updateLeaveType, deleteLeaveType
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';

  // Tabs
  const [activeTab, setActiveTab] = useState<'approvals' | 'categories'>('approvals');

  // Filter state for approval queue
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
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
  const [mName, setMName] = useState('Mandatory August Summer Bridge 2026');
  const [mStart, setMStart] = useState('2026-08-10');
  const [mEnd, setMEnd] = useState('2026-08-14');
  const [mNote, setMNote] = useState('Company-wide summer vacation week.');
  const [previewMode, setPreviewMode] = useState(false);

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

  // Calculate working days excluding Greek holidays and weekends
  const calculateWorkingDays = (startStr: string, endStr: string, schedule?: string[]) => {
    try {
      const days = eachDayOfInterval({ start: parseISO(startStr), end: parseISO(endStr) });
      let count = 0;
      const effectiveSchedule = schedule || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      days.forEach(d => {
        const dayStr = format(d, 'yyyy-MM-dd');
        const dayOfWeek = format(d, 'EEE');
        const isHol = (publicHolidays || []).some(h => h.date === dayStr);
        if (!isHol && effectiveSchedule.includes(dayOfWeek)) {
          count++;
        }
      });
      return count;
    } catch {
      return 0;
    }
  };

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

  // Handle Publish Mandatory Leave
  const handlePublishMandatory = () => {
    addMandatoryLeave({
      name: mName,
      leave_type_id: leaveTypes[0]?.id || 'lt-annual',
      start_date: mStart,
      end_date: mEnd,
      note: mNote,
      status: 'published',
      created_by: currentUser.id
    });
    setIsMandatoryOpen(false);
    setPreviewMode(false);
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
      allow_retroactive: Number(catMinNotice) === 0
    };

    if (catEditingId) {
      await updateLeaveType(catEditingId, payload);
      alert('Leave category updated successfully!');
    } else {
      await addLeaveType(payload);
      alert('New leave category created! Employees can now select this option when applying for leave.');
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

  return (
    <div className="space-y-8 animate-in fade-in duration-200 max-w-7xl mx-auto pb-20">
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
          {activeTab === 'categories' && (
            <Button
              onClick={openNewCategoryModal}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs px-4 py-2 shadow-sm flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Create New Leave Category
            </Button>
          )}
          <Button
            onClick={() => setIsMandatoryOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-4 py-2 shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Declare Mandatory Company Closure
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
                {(['pending', 'approved', 'rejected', 'all'] as const).map(st => (
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
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600 min-w-[800px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase font-extrabold tracking-wider text-[11px]">
                      <tr>
                        <th className="p-4">Employee Member</th>
                        <th className="p-4">Leave Category</th>
                        <th className="p-4">Date Horizon</th>
                        <th className="p-4">Working Days</th>
                        <th className="p-4">Reason / Notes</th>
                        <th className="p-4">Status &amp; ΕΡΓΑΝΗ</th>
                        <th className="p-4 text-right">Admin Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white font-medium">
                      {displayedRequests.map(req => {
                        const prof = profiles.find(p => p.id === req.profile_id);
                        const lType = leaveTypes.find(lt => lt.id === req.leave_type_id);
                        const workDays = getEffectiveDays(req);
                        const isPendingCancel = req.status === 'cancellation_requested';

                        return (
                          <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-4">
                              <div className="font-extrabold text-slate-900 text-sm">
                                {prof ? `${prof.first_name} ${prof.last_name}` : 'Unknown Team Member'}
                              </div>
                              <div className="text-[11px] text-slate-400 font-semibold">
                                {prof?.title || 'Team Member'} &bull; {prof?.employment_type.toUpperCase()}
                              </div>
                            </td>
                            <td className="p-4">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-extrabold border shadow-2xs" style={{ 
                                backgroundColor: `${lType?.colour || '#3D87D3'}15`,
                                color: lType?.colour || '#3D87D3',
                                borderColor: `${lType?.colour || '#3D87D3'}30`
                              }}>
                                <span className="w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: lType?.colour || '#3D87D3' }} />
                                {lType?.name_el || 'Leave'} ({lType?.name_en || 'Other'})
                              </span>
                              {req.origin === 'mandatory' && (
                                <span className="block mt-1 text-[10px] font-extrabold text-indigo-700">📌 Company Mandatory Closure</span>
                              )}
                            </td>
                            <td className="p-4 font-mono font-bold text-slate-800">
                              {req.start_date} &rarr; {req.end_date}
                            </td>
                            <td className="p-4 font-mono font-black text-slate-900 text-sm">
                              {workDays}d
                            </td>
                            <td className="p-4 text-slate-600 max-w-xs truncate">
                              {req.note ? <span className="italic text-slate-800">&ldquo;{req.note}&rdquo;</span> : <span className="text-slate-300 font-normal">None provided</span>}
                            </td>
                            <td className="p-4 space-y-1">
                              <div className="flex items-center space-x-1.5">
                                {req.status === 'approved' || req.status === 'taken' ? (
                                  <Badge variant="success" className="font-extrabold">✓ APPROVED</Badge>
                                ) : req.status === 'rejected' ? (
                                  <Badge variant="error" className="font-extrabold">× REJECTED</Badge>
                                ) : (
                                  <Badge variant="warning" className="font-extrabold animate-pulse">⏳ PENDING</Badge>
                                )}
                              </div>
                              {isPendingCancel && (
                                <Badge variant="warning" className="text-[10px] font-black bg-amber-100 text-amber-950 border-amber-300 block w-fit">
                                  ⚠️ Cancellation Requested
                                </Badge>
                              )}
                              <div className="text-[10px] font-mono text-slate-400 uppercase">
                                ΕΡΓΑΝΗ: <span className="text-slate-600 font-bold">{req.ergani_status}</span>
                              </div>
                            </td>
                            <td className="p-4 text-right space-x-2 whitespace-nowrap">
                              {req.status === 'pending' && !isPendingCancel && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    onClick={() => updateLeaveRequestStatus(req.id, 'approved', 'Approved by Administration')}
                                    className="bg-emerald-600 hover:bg-emerald-500 font-black px-3 py-1.5 shadow-2xs text-xs cursor-pointer"
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => setRejectModalTarget(req.id)}
                                    className="font-black px-3 py-1.5 shadow-2xs text-xs cursor-pointer"
                                  >
                                    Reject
                                  </Button>
                                </>
                              )}

                              {isPendingCancel && (
                                <div className="flex items-center justify-end space-x-2">
                                  <Button
                                    size="sm"
                                    className="bg-amber-600 hover:bg-amber-700 text-white font-black text-[11px] py-1 px-2 cursor-pointer"
                                    onClick={() => decideLeaveCancellation(req.id, true)}
                                  >
                                    Approve Cancellation
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-[11px] py-1 px-2 text-slate-700 cursor-pointer"
                                    onClick={() => decideLeaveCancellation(req.id, false)}
                                  >
                                    Keep Leave Active
                                  </Button>
                                </div>
                              )}

                              {(req.status === 'approved' || req.status === 'taken') && !isPendingCancel && req.origin !== 'mandatory' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setEditingLeave(req);
                                    setEditStartDate(req.start_date);
                                    setEditEndDate(req.end_date);
                                    setEditNote(req.note || '');
                                    setEditReason('');
                                  }}
                                  className="text-[11px] font-bold py-1 px-2.5 text-slate-700 border-slate-300 hover:bg-slate-100 cursor-pointer flex items-center ml-auto"
                                >
                                  <Edit3 className="w-3.5 h-3.5 mr-1.5 text-[#3D87D3]" /> Modify / Cut Short
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Mandatory Leaves Register */}
          <Card title="Company-Wide Mandatory Closure Register" subtitle="Admin-declared mandatory breaks (such as August Summer Bridge or Christmas) counting directly against employee allowances" className="shadow-xs border-slate-200/90">
            <div className="space-y-4 mt-3">
              {mandatoryLeaves.map(ml => (
                <div key={ml.id} className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-3 hover:border-slate-300 transition-all">
                  <div className="flex items-center justify-between">
                    <h4 className="font-extrabold text-base text-slate-900 flex items-center">
                      <Calendar className="w-5 h-5 mr-2 text-indigo-600" /> {ml.name}
                    </h4>
                    <Badge variant="info" className="font-bold">{ml.status.toUpperCase()}</Badge>
                  </div>
                  <p className="text-xs text-slate-600">
                    Dates Horizon: <strong className="text-[#3D87D3] font-mono">{ml.start_date} &rarr; {ml.end_date}</strong> &bull; Announcement Notes: {ml.note}
                  </p>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-700 text-xs flex items-center justify-between font-medium">
                    <span>Fan-Out Status: <strong className="text-slate-900 font-extrabold">Active</strong> across all full-time and part-time staff (external contractors excluded).</span>
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
                        {isSystemDefault ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase tracking-wider shrink-0">
                            Core Type
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider shrink-0">
                            Custom
                          </span>
                        )}
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

      {/* MANDATORY LEAVE DECLARATION MODAL */}
      <Modal isOpen={isMandatoryOpen} onClose={() => { setIsMandatoryOpen(false); setPreviewMode(false); }} title="Declare Mandatory Company Closure">
        <div className="space-y-4 text-xs">
          {!previewMode ? (
            <>
              <p className="text-slate-600 text-[11px]">
                Declare organization-wide breaks (e.g., August Summer Bridge). Orbit will automatically fan out this closure across all staff members, respecting individual schedules and part-time multipliers while skipping external contractor partners.
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
                <Button variant="outline" size="sm" onClick={() => setIsMandatoryOpen(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={() => setPreviewMode(true)} className="bg-indigo-600 hover:bg-indigo-700 font-black">Preview Fan-Out Impact &rarr;</Button>
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
                      <div>
                        <span className="font-extrabold text-slate-900">{p.first_name} {p.last_name}</span>
                        <span className="text-[10px] font-bold text-slate-500 ml-1.5">({p.employment_type.toUpperCase()})</span>
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

          <div className="grid grid-cols-2 gap-3">
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
              <label className="block font-extrabold uppercase text-slate-500 mb-1 text-[11px]">Badge &amp; Calendar Color</label>
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
    </div>
  );
}
