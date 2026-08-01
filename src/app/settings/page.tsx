"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { 
  Settings, Globe, ShieldCheck, CheckCircle2, AlertTriangle, 
  Building2, Sliders, Calendar, Clock, Save, Info, RefreshCw, Sparkles, Plus, Users, Trash2, Edit2, X 
} from 'lucide-react';
import { PolicyPeriod, RemotePolicy, Team, LeaveType } from '@/lib/types';

export default function CompanySettingsPage() {
  const { 
    currentUser, remotePolicies, updateRemotePolicy, 
    teams, profiles, addTeam, updateTeam, deleteTeam,
    leaveTypes, addLeaveType, updateLeaveType, deleteLeaveType
  } = useAuth();
  const isAdmin = currentUser.role === 'admin';

  const [selectedTab, setSelectedTab] = useState<'remote' | 'teams' | 'leaves' | 'general'>('remote');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Locate the company-wide remote policy
  const activeCompanyPolicy = remotePolicies.find(p => p.scope_type === 'company');

  // Local state for remote policy form
  const [maxDays, setMaxDays] = useState<number>(8);
  const [periodType, setPeriodType] = useState<PolicyPeriod>('month');

  // Local states for Team management
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamLeadId, setNewTeamLeadId] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [editTeamLeadId, setEditTeamLeadId] = useState('');
  const [isSubmittingTeam, setIsSubmittingTeam] = useState(false);

  // Local states for Leave Type management
  const [newLeaveCode, setNewLeaveCode] = useState('');
  const [newLeaveNameEn, setNewLeaveNameEn] = useState('');
  const [newLeaveNameEl, setNewLeaveNameEl] = useState('');
  const [newLeaveColor, setNewLeaveColor] = useState('#3b82f6');
  const [newLeaveCountsAgainstBalance, setNewLeaveCountsAgainstBalance] = useState(false);
  const [newLeaveRequiresDocument, setNewLeaveRequiresDocument] = useState(false);
  const [newLeaveRequiresApproval, setNewLeaveRequiresApproval] = useState(true);
  const [isSubmittingLeaveType, setIsSubmittingLeaveType] = useState(false);

  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);
  const [editLeaveNameEn, setEditLeaveNameEn] = useState('');
  const [editLeaveNameEl, setEditLeaveNameEl] = useState('');
  const [editLeaveColor, setEditLeaveColor] = useState('#3b82f6');
  const [editLeaveCountsAgainstBalance, setEditLeaveCountsAgainstBalance] = useState(false);
  const [editLeaveRequiresDocument, setEditLeaveRequiresDocument] = useState(false);
  const [editLeaveRequiresApproval, setEditLeaveRequiresApproval] = useState(true);

  useEffect(() => {
    if (activeCompanyPolicy) {
      setMaxDays(activeCompanyPolicy.max_days ?? activeCompanyPolicy.max_days_per_month ?? 8);
      setPeriodType(activeCompanyPolicy.period_type || 'month');
    }
  }, [activeCompanyPolicy, remotePolicies]);

  if (!isAdmin) {
    return (
      <div className="p-10 text-center bg-slate-50 border border-slate-200 rounded-2xl max-w-xl mx-auto my-12 space-y-3 shadow-xs">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-600" />
        <h3 className="text-lg font-bold text-slate-800">Access Restricted: Admin Clearance Required</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          The Company Settings console allows modifying organization-wide compliance parameters, teams, and quotas. Your current profile does not have administrative permissions.
        </p>
      </div>
    );
  }

  const handleSaveRemotePolicy = async () => {
    if (!activeCompanyPolicy) {
      alert("No company-wide remote policy found in Supabase database. Please check migrations.");
      return;
    }
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await updateRemotePolicy(activeCompanyPolicy.id, {
        max_days: maxDays,
        period_type: periodType
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err) {
      console.error("Error updating settings:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) {
      alert('Team Name is required!');
      return;
    }
    setIsSubmittingTeam(true);
    const success = await addTeam(newTeamName.trim(), newTeamLeadId || undefined);
    setIsSubmittingTeam(false);
    if (success) {
      alert(`Team "${newTeamName.trim()}" successfully created and saved to PostgreSQL!`);
      setNewTeamName('');
      setNewTeamLeadId('');
    }
  };

  const handleUpdateTeam = async (id: string) => {
    if (!editTeamName.trim()) {
      alert('Team Name cannot be empty!');
      return;
    }
    const success = await updateTeam(id, editTeamName.trim(), editTeamLeadId || undefined);
    if (success) {
      setEditingTeamId(null);
      alert('Team successfully updated!');
    }
  };

  const handleCreateLeaveType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeaveCode.trim() || !newLeaveNameEn.trim() || !newLeaveNameEl.trim()) {
      alert('Code, English Name, and Greek Name are required!');
      return;
    }
    if (leaveTypes.some(lt => lt.code.toLowerCase() === newLeaveCode.trim().toLowerCase())) {
      alert('A leave category with this unique code identifier already exists!');
      return;
    }
    setIsSubmittingLeaveType(true);
    const success = await addLeaveType({
      code: newLeaveCode.trim().toLowerCase().replace(/\s+/g, '_'),
      name_en: newLeaveNameEn.trim(),
      name_el: newLeaveNameEl.trim(),
      colour: newLeaveColor,
      counts_against_balance: newLeaveCountsAgainstBalance,
      requires_document: newLeaveRequiresDocument,
      requires_approval: newLeaveRequiresApproval
    });
    setIsSubmittingLeaveType(false);
    if (success) {
      alert(`Leave category "${newLeaveNameEn.trim()}" successfully registered to Supabase!`);
      setNewLeaveCode('');
      setNewLeaveNameEn('');
      setNewLeaveNameEl('');
      setNewLeaveColor('#3b82f6');
      setNewLeaveCountsAgainstBalance(false);
      setNewLeaveRequiresDocument(false);
      setNewLeaveRequiresApproval(true);
    }
  };

  const handleUpdateLeaveType = async (id: string) => {
    if (!editLeaveNameEn.trim() || !editLeaveNameEl.trim()) {
      alert('Names cannot be empty!');
      return;
    }
    const success = await updateLeaveType(id, {
      name_en: editLeaveNameEn.trim(),
      name_el: editLeaveNameEl.trim(),
      colour: editLeaveColor,
      counts_against_balance: editLeaveCountsAgainstBalance,
      requires_document: editLeaveRequiresDocument,
      requires_approval: editLeaveRequiresApproval
    });
    if (success) {
      setEditingLeaveId(null);
      alert('Leave category successfully updated in database!');
    }
  };

  const getPeriodDisplay = (period: PolicyPeriod) => {
    switch (period) {
      case 'week': return 'Week';
      case 'month': return 'Month';
      case 'quarter': return 'Quarter';
      case 'year': return 'Year';
      default: return 'Month';
    }
  };

  const activeEmployees = profiles.filter(p => p.status === 'active' && p.employment_type !== 'contractor');

  return (
    <div className="space-y-8 pb-16 animate-in fade-in duration-200">
      {/* Header section with modern backdrop */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-[#225287] p-8 text-white shadow-md">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[11px] font-semibold tracking-wider uppercase text-[#73A7E3]">
              <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-300 animate-pulse" />
              <span>Global Organizational Controls</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white flex items-center">
              <Settings className="w-7 h-7 mr-3 text-[#73A7E3]" /> Company Settings & Policies
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              Configure company-wide rules, departmental team structures, and automated compliance thresholds. Changes persisted here directly update PostgreSQL tables and immediately apply across all member modules.
            </p>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <Badge variant="info">Live Supabase Storage</Badge>
            <span className="text-[11px] text-slate-400 mt-1 font-mono">Tables: public.teams / remote_policies</span>
          </div>
        </div>
        <div className="absolute -right-10 -bottom-10 w-64 h-64 rounded-full bg-[#3D87D3]/20 blur-3xl pointer-events-none" />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6 text-sm font-medium">
        <button
          onClick={() => setSelectedTab('remote')}
          className={`pb-3 border-b-2 transition-all flex items-center space-x-2 cursor-pointer ${
            selectedTab === 'remote'
              ? 'border-[#3D87D3] text-[#3D87D3] font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Globe className="w-4 h-4 text-blue-500" />
          <span>Remote Work Quotas & Patterns</span>
        </button>
        <button
          onClick={() => setSelectedTab('teams')}
          className={`pb-3 border-b-2 transition-all flex items-center space-x-2 cursor-pointer ${
            selectedTab === 'teams'
              ? 'border-[#3D87D3] text-[#3D87D3] font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-4 h-4 text-emerald-500" />
          <span>Company Departments & Teams ({teams.length})</span>
        </button>
        <button
          onClick={() => setSelectedTab('leaves')}
          className={`pb-3 border-b-2 transition-all flex items-center space-x-2 cursor-pointer ${
            selectedTab === 'leaves'
              ? 'border-[#3D87D3] text-[#3D87D3] font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Calendar className="w-4 h-4 text-amber-500" />
          <span>Leave Categories & Policies ({leaveTypes.length})</span>
        </button>
        <button
          onClick={() => setSelectedTab('general')}
          className={`pb-3 border-b-2 transition-all flex items-center space-x-2 cursor-pointer ${
            selectedTab === 'general'
              ? 'border-[#3D87D3] text-[#3D87D3] font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4 text-slate-400" />
          <span>General Corporate Profile <span className="ml-1 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-normal">Soon</span></span>
        </button>
      </div>

      {/* TAB 1: REMOTE WORK POLICY */}
      {selectedTab === 'remote' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Main Configuration Card */}
          <Card 
            title="Remote Work Company Quota" 
            subtitle="Define the legal and policy limits for remote work across the organization"
            className="lg:col-span-2 shadow-xs border-slate-200"
          >
            <div className="space-y-6 pt-2">
              <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-blue-900 flex items-start space-x-3">
                <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-extrabold">Strict Quota Enforcement Enabled:</p>
                  <p className="text-blue-900/90 leading-relaxed">
                    When employees attempt to save recurring weekly patterns or submit daily overrides, Orbit automatically verifies their remote work total against this threshold. Any submission exceeding this quota is rejected to ensure regulatory labor compliance.
                  </p>
                </div>
              </div>

              {/* Input Group: Quota Amount & Period */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 tracking-wide mb-2">
                    Max Allowed Days
                  </label>
                  <div className="relative rounded-xl shadow-2xs">
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={maxDays}
                      onChange={(e) => setMaxDays(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#3D87D3] focus:border-transparent transition-all shadow-2xs"
                    />
                    <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-xs text-slate-400 font-extrabold">
                      DAYS
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Specify 0 to disable remote work company-wide.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 tracking-wide mb-2">
                    Evaluation Timeframe
                  </label>
                  <select
                    value={periodType}
                    onChange={(e) => setPeriodType(e.target.value as PolicyPeriod)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#3D87D3] focus:border-transparent transition-all cursor-pointer shadow-2xs"
                  >
                    <option value="week">Per Week (Weekly Quota)</option>
                    <option value="month">Per Month (Monthly Quota)</option>
                    <option value="quarter">Per Quarter (3-Month Quota)</option>
                    <option value="year">Per Year (Annual Quota)</option>
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Determines the recurring interval for quota calculation.
                  </p>
                </div>
              </div>

              {/* Period selection grid cards for quick visual toggling */}
              <div className="pt-2">
                <label className="block text-[11px] font-bold uppercase text-slate-500 tracking-wider mb-3">
                  Quick Select Timeframe
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(['week', 'month', 'quarter', 'year'] as PolicyPeriod[]).map((period) => {
                    const isActive = periodType === period;
                    return (
                      <button
                        key={period}
                        type="button"
                        onClick={() => setPeriodType(period)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer shadow-2xs ${
                          isActive
                            ? 'bg-[#3D87D3]/10 border-[#3D87D3] ring-1 ring-[#3D87D3]/50 text-[#3D87D3] shadow-xs font-extrabold'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <div className="text-xs capitalize font-extrabold">{period}ly</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 font-medium">
                          {period === 'week' && '7-day interval'}
                          {period === 'month' && 'Calendar month'}
                          {period === 'quarter' && 'Q1-Q4 period'}
                          {period === 'year' && 'Full calendar year'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs">
                  {saveSuccess && (
                    <span className="flex items-center text-emerald-600 font-bold animate-in fade-in">
                      <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-500" />
                      Policy successfully persisted to Supabase!
                    </span>
                  )}
                </div>
                <Button 
                  onClick={handleSaveRemotePolicy}
                  disabled={isSaving}
                  variant="primary"
                  className="px-6 py-3 rounded-xl shadow-xs hover:shadow-md transition-all text-sm flex items-center space-x-2 font-extrabold cursor-pointer"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      <span>Saving to DB...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      <span>Save Global Quota</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>

          {/* Live Preview / Impact KPI Card */}
          <div className="space-y-6">
            <Card 
              title="Live Employee UI Impact Preview" 
              subtitle="Preview of employee dashboard enforcement"
              className="bg-slate-50/80 border-slate-200 shadow-xs"
            >
              <div className="space-y-4 pt-1">
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-slate-500">Policy Quota Banner</span>
                    <Badge variant="success">
                      Max {maxDays} {maxDays === 1 ? 'Day' : 'Days'} / {getPeriodDisplay(periodType)}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-700 border-l-4 border-emerald-500 pl-3 py-0.5 font-semibold">
                    Within company threshold for this {periodType}.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-slate-500">Over-Quota Attempted Save</span>
                    <Badge variant="warning">
                      Blocked Action
                    </Badge>
                  </div>
                  <p className="text-xs text-rose-700 border-l-4 border-rose-500 pl-3 py-0.5 font-semibold">
                    POLICY VIOLATION: Planned remote days exceed allowed maximum limit ({maxDays} days per {periodType}). Save blocked.
                  </p>
                </div>

                <div className="text-[11px] text-slate-500 leading-relaxed pt-2 border-t border-slate-200 font-medium">
                  <span className="font-extrabold text-slate-800 block mb-1">Scope & Applicability</span>
                  Globally enforced across the <span className="font-bold text-slate-900">Entire Organization</span> for all standard full-time and part-time staff.
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: COMPANY TEAMS CONFIGURATION */}
      {selectedTab === 'teams' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Active Teams List */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center">
                <Users className="w-5 h-5 mr-2 text-emerald-600" /> Active Company Departments & Teams
              </h2>
              <Badge variant="info">Synced with public.teams table</Badge>
            </div>
            <div className="space-y-3">
              {teams.length === 0 ? (
                <Card className="p-10 text-center text-slate-500 text-xs border-dashed">
                  No departments have been configured yet. Use the tool on the right to add your first team.
                </Card>
              ) : (
                teams.map((t) => {
                  const leadProfile = profiles.find(p => p.id === t.lead_profile_id);
                  const memberCount = profiles.filter(p => p.team_id === t.id || p.team?.id === t.id).length;
                  const isEditing = editingTeamId === t.id;

                  if (isEditing) {
                    return (
                      <div key={t.id} className="p-4 rounded-xl bg-slate-50 border-2 border-[#3D87D3] shadow-xs space-y-3">
                        <div className="flex items-center justify-between font-bold text-xs text-[#3D87D3]">
                          <span>Editing Team Record</span>
                          <button onClick={() => setEditingTeamId(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">Team Name</label>
                            <input
                              type="text"
                              value={editTeamName}
                              onChange={(e) => setEditTeamName(e.target.value)}
                              className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">Department Lead / Manager</label>
                            <select
                              value={editTeamLeadId}
                              onChange={(e) => setEditTeamLeadId(e.target.value)}
                              className="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold text-slate-900 cursor-pointer"
                            >
                              <option value="">-- No Lead Assigned --</option>
                              {activeEmployees.map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name} ({emp.title || 'Staff'})</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="flex justify-end space-x-2 pt-1">
                          <Button size="sm" variant="outline" onClick={() => setEditingTeamId(null)}>Cancel</Button>
                          <Button size="sm" variant="primary" onClick={() => handleUpdateTeam(t.id)} className="bg-[#3D87D3] font-bold cursor-pointer">
                            Save Changes
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={t.id} className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center space-x-2.5">
                          <h3 className="font-extrabold text-slate-900 text-sm">{t.name}</h3>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                            {memberCount} {memberCount === 1 ? 'Employee' : 'Employees'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 font-medium">
                          Department Lead: <strong className="text-slate-800 font-bold">{leadProfile ? `${leadProfile.first_name} ${leadProfile.last_name}` : 'Unassigned'}</strong>
                        </p>
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => {
                            setEditingTeamId(t.id);
                            setEditTeamName(t.name);
                            setEditTeamLeadId(t.lead_profile_id || '');
                          }}
                          className="text-xs py-1.5 font-bold border-slate-300 hover:bg-slate-50 cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5 mr-1 text-blue-600" /> Edit
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => {
                            if (confirm(`Are you certain you wish to delete team "${t.name}"?`)) {
                              deleteTeam(t.id);
                            }
                          }}
                          className="text-xs py-1.5 font-bold text-rose-700 border-rose-200 hover:bg-rose-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1 text-rose-600" /> Delete
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Add New Team Form Card */}
          <div>
            <Card title="Register New Department" subtitle="Create an organizational group in Postgres" className="shadow-xs border-slate-200">
              <form onSubmit={handleCreateTeam} className="space-y-4 text-xs mt-3">
                <div>
                  <label className="block font-bold uppercase text-slate-700 mb-1">Department / Team Name *</label>
                  <input
                    type="text"
                    placeholder="e.g., AI Research & Development"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    required
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#3D87D3] focus:outline-none shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block font-bold uppercase text-slate-700 mb-1">Department Head / Lead</label>
                  <select
                    value={newTeamLeadId}
                    onChange={(e) => setNewTeamLeadId(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#3D87D3] focus:outline-none shadow-2xs cursor-pointer text-xs"
                  >
                    <option value="">-- No Lead Assigned (Optional) --</option>
                    {activeEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name} ({emp.title || 'Team Member'})</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Designated leads govern departmental reporting in People and Roster modules.
                  </p>
                </div>

                <Button 
                  variant="primary" 
                  type="submit" 
                  disabled={isSubmittingTeam}
                  className="w-full py-3 bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-white font-extrabold rounded-xl shadow-xs cursor-pointer flex items-center justify-center"
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Add Team to Organization
                </Button>
              </form>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 3: LEAVE CATEGORIES CONFIGURATION */}
      {selectedTab === 'leaves' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Active Leave Types List */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center">
                <Calendar className="w-5 h-5 mr-2 text-amber-500" /> Authorized Employee Leave Categories
              </h2>
              <Badge variant="info">Synced with public.leave_types</Badge>
            </div>
            <div className="space-y-3">
              {leaveTypes.length === 0 ? (
                <Card className="p-10 text-center text-slate-500 text-xs border-dashed">
                  No leave categories configured. Add your first leave type on the right.
                </Card>
              ) : (
                leaveTypes.map((t) => {
                  const isEditing = editingLeaveId === t.id;

                  if (isEditing) {
                    return (
                      <div key={t.id} className="p-4 rounded-xl bg-slate-50 border-2 border-[#3D87D3] shadow-xs space-y-3">
                        <div className="flex items-center justify-between font-bold text-xs text-[#3D87D3]">
                          <span>Editing Leave Category: {t.code}</span>
                          <button onClick={() => setEditingLeaveId(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">Name (English)</label>
                            <input
                              type="text"
                              value={editLeaveNameEn}
                              onChange={(e) => setEditLeaveNameEn(e.target.value)}
                              className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">Name (Greek)</label>
                            <input
                              type="text"
                              value={editLeaveNameEl}
                              onChange={(e) => setEditLeaveNameEl(e.target.value)}
                              className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-900"
                            />
                          </div>
                        </div>
                        <div className="text-xs">
                          <label className="block font-bold text-slate-700 mb-1">Ribbon Color</label>
                          <div className="flex items-center space-x-3">
                            <input
                              type="color"
                              value={editLeaveColor}
                              onChange={(e) => setEditLeaveColor(e.target.value)}
                              className="w-9 h-9 p-0.5 rounded-lg border border-slate-300 bg-white cursor-pointer"
                            />
                            <span className="font-mono font-bold uppercase text-slate-700">{editLeaveColor}</span>
                          </div>
                        </div>
                        <div className="space-y-2 pt-2 border-t border-slate-200 text-xs font-bold text-slate-700">
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editLeaveCountsAgainstBalance}
                              onChange={(e) => setEditLeaveCountsAgainstBalance(e.target.checked)}
                              className="rounded text-[#3D87D3] focus:ring-[#3D87D3] w-4 h-4"
                            />
                            <span>Deduct from Employee's Annual Entitlement Balance</span>
                          </label>
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editLeaveRequiresDocument}
                              onChange={(e) => setEditLeaveRequiresDocument(e.target.checked)}
                              className="rounded text-[#3D87D3] focus:ring-[#3D87D3] w-4 h-4"
                            />
                            <span>Requires Uploading Official Supporting Document (e.g., Medical Note)</span>
                          </label>
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editLeaveRequiresApproval}
                              onChange={(e) => setEditLeaveRequiresApproval(e.target.checked)}
                              className="rounded text-[#3D87D3] focus:ring-[#3D87D3] w-4 h-4"
                            />
                            <span>Requires Manager / Founder Approval (Not Auto-approved)</span>
                          </label>
                        </div>
                        <div className="flex justify-end space-x-2 pt-1">
                          <Button size="sm" variant="outline" onClick={() => setEditingLeaveId(null)}>Cancel</Button>
                          <Button size="sm" variant="primary" onClick={() => handleUpdateLeaveType(t.id)} className="bg-[#3D87D3] font-bold cursor-pointer">
                            Save Changes
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={t.id} className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                          <span className="w-3.5 h-3.5 rounded-full shadow-2xs shrink-0" style={{ backgroundColor: t.colour || '#3b82f6' }} />
                          <h3 className="font-extrabold text-slate-900 text-base">{t.name_el} ({t.name_en})</h3>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                            {t.code}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-[11px] font-bold">
                          <span className={`px-2 py-0.5 rounded-full border ${t.counts_against_balance ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                            {t.counts_against_balance ? '⚖️ Deducted from Balance' : '🔓 Uncapped (Not Deducted)'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full border ${t.requires_document ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                            {t.requires_document ? '📎 Doc Required' : '📄 No Doc Needed'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full border ${t.requires_approval ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-purple-50 text-purple-800 border-purple-200'}`}>
                            {t.requires_approval ? '✓ Approval Required' : '⚡ Auto-approved'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => {
                            setEditingLeaveId(t.id);
                            setEditLeaveNameEn(t.name_en);
                            setEditLeaveNameEl(t.name_el);
                            setEditLeaveColor(t.colour || '#3b82f6');
                            setEditLeaveCountsAgainstBalance(t.counts_against_balance);
                            setEditLeaveRequiresDocument(t.requires_document);
                            setEditLeaveRequiresApproval(t.requires_approval);
                          }}
                          className="text-xs py-1.5 font-bold border-slate-300 hover:bg-slate-50 cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5 mr-1 text-blue-600" /> Edit
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => {
                            if (confirm(`Are you sure you want to completely remove leave category "${t.name_en}"?`)) {
                              deleteLeaveType(t.id);
                            }
                          }}
                          className="text-xs py-1.5 font-bold text-rose-700 border-rose-200 hover:bg-rose-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1 text-rose-600" /> Delete
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Add New Leave Type Form Card */}
          <div>
            <Card title="New Leave Category" subtitle="Add customizable absence types" className="shadow-xs border-slate-200">
              <form onSubmit={handleCreateLeaveType} className="space-y-4 text-xs mt-3">
                <div>
                  <label className="block font-bold uppercase text-slate-700 mb-1">Unique Code Identifier *</label>
                  <input
                    type="text"
                    placeholder="e.g., sabbatical, study_leave"
                    value={newLeaveCode}
                    onChange={(e) => setNewLeaveCode(e.target.value)}
                    required
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#3D87D3] focus:outline-none shadow-2xs font-mono lowercase"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Unique code used internally in database storage.</p>
                </div>

                <div>
                  <label className="block font-bold uppercase text-slate-700 mb-1">English Title *</label>
                  <input
                    type="text"
                    placeholder="e.g., Study Leave"
                    value={newLeaveNameEn}
                    onChange={(e) => setNewLeaveNameEn(e.target.value)}
                    required
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#3D87D3] focus:outline-none shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block font-bold uppercase text-slate-700 mb-1">Greek Title (Ελληνικά) *</label>
                  <input
                    type="text"
                    placeholder="e.g., Φοιτητική Άδεια"
                    value={newLeaveNameEl}
                    onChange={(e) => setNewLeaveNameEl(e.target.value)}
                    required
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#3D87D3] focus:outline-none shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block font-bold uppercase text-slate-700 mb-1">Calendar & Ribbon Color</label>
                  <div className="flex items-center space-x-3">
                    <input
                      type="color"
                      value={newLeaveColor}
                      onChange={(e) => setNewLeaveColor(e.target.value)}
                      className="w-10 h-10 p-0.5 rounded-xl border border-slate-300 bg-white cursor-pointer shadow-2xs"
                    />
                    <span className="font-mono font-bold uppercase text-slate-700">{newLeaveColor}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'].map(c => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => setNewLeaveColor(c)}
                        className={`w-6 h-6 rounded-full border-2 transition-transform cursor-pointer ${newLeaveColor === c ? 'scale-125 border-slate-900 shadow-sm' : 'border-white hover:scale-110'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2.5 pt-2 border-t border-slate-200 font-bold text-slate-700">
                  <label className="flex items-start space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newLeaveCountsAgainstBalance}
                      onChange={(e) => setNewLeaveCountsAgainstBalance(e.target.checked)}
                      className="rounded text-[#3D87D3] focus:ring-[#3D87D3] w-4 h-4 mt-0.5"
                    />
                    <span>Deduct from Annual Entitlement Balance (usually OFF for sick/parental)</span>
                  </label>
                  <label className="flex items-start space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newLeaveRequiresDocument}
                      onChange={(e) => setNewLeaveRequiresDocument(e.target.checked)}
                      className="rounded text-[#3D87D3] focus:ring-[#3D87D3] w-4 h-4 mt-0.5"
                    />
                    <span>Require Employee to Attach Medical/Legal Document</span>
                  </label>
                  <label className="flex items-start space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newLeaveRequiresApproval}
                      onChange={(e) => setNewLeaveRequiresApproval(e.target.checked)}
                      className="rounded text-[#3D87D3] focus:ring-[#3D87D3] w-4 h-4 mt-0.5"
                    />
                    <span>Require Founder / Manager Approval Sign-off</span>
                  </label>
                </div>

                <Button 
                  variant="primary" 
                  type="submit" 
                  disabled={isSubmittingLeaveType}
                  className="w-full py-3 bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-white font-extrabold rounded-xl shadow-xs cursor-pointer flex items-center justify-center mt-4"
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Register Leave Category
                </Button>
              </form>
            </Card>
          </div>
        </div>
      )}

      {/* Placeholders for Future Setting Modules */}
      {selectedTab === 'general' && (
        <Card className="p-12 text-center border-dashed border-slate-300 bg-slate-50/50 rounded-2xl">
          <Sliders className="w-12 h-12 mx-auto text-slate-300 mb-3" />
          <h3 className="text-base font-bold text-slate-700">General Company Profile Under Architecture</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
            We are structuring database schemas for corporate tax registry, HQ legal addresses, and default billing parameter settings.
          </p>
        </Card>
      )}
    </div>
  );
}
