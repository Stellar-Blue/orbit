"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { roleLabel } from '@/lib/profile-role';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { 
  Settings, Globe, CheckCircle2, AlertTriangle, 
  Building2, Sliders, Calendar, Clock, Save, Info, RefreshCw, Plus, Users, Trash2, Edit2, X, Layers, DollarSign, Tag,
  Receipt, ChevronRight, MessageSquare, FileText, ShieldCheck
} from 'lucide-react';
import { PolicyPeriod, RemotePolicy, Team, LeaveType, CatalogModule, CatalogItem } from '@/lib/types';
import { TieringSettings } from '@/components/settings/tiering-settings';
import { IntegrationsSettings } from '@/components/settings/integrations-settings';
import { PaymentDocumentTypesSettings } from '@/components/settings/payment-document-types-settings';
import { GeneralSettings } from '@/components/settings/general-settings';
import { RateCardMatrix } from '@/components/settings/rate-card-matrix';
import { EmployeeRemoteQuota } from '@/components/people/employee-remote-quota';
import { LeaveDefaultsCard, CarryoverPolicyCard } from '@/components/settings/leave-defaults';
import { CarryoverRecalculationCard } from '@/components/settings/carryover-recalculation';
import { HolidaysCard } from '@/components/settings/holidays';
import { CoverageRulesCard } from '@/components/settings/coverage-rules';
import { ScreenVisibilityCard } from '@/components/settings/screen-visibility';
import { notifySuccess, notifyValidation } from '@/lib/validation-modal';

export default function CompanySettingsPage() {
  const { 
    currentUser, remotePolicies, updateRemotePolicy, documentTypes, 
    coverageGroups,
    teams, profiles, addTeam, updateTeam, deleteTeam,
    leaveTypes, addLeaveType, updateLeaveType, deleteLeaveType,
    catalogModules, catalogItems, saveCatalogModule, deleteCatalogModule, saveCatalogItem, deleteCatalogItem,
    invoiceCategories, addInvoiceCategory, deleteInvoiceCategory,
    jobRoles, seniorityLevels, profileRoleHistory, rateCards, rateCardEntries,
    saveJobRole, deleteJobRole, saveSeniorityLevel, deleteSeniorityLevel,
    saveRateCard, deleteRateCard, saveRateCardEntry, deleteRateCardEntry
  } = useAuth();
  const isAdmin = currentUser.role === 'admin';

  const [selectedTab, setSelectedTab] = useState<'remote' | 'teams' | 'leaves' | 'coverage' | 'roles' | 'seniorities' | 'pricing' | 'timesheets' | 'invoices' | 'tiering' | 'integrations' | 'documents' | 'general'>('remote');
  const [newRoleName, setNewRoleName] = useState('');
  const [newSeniorityName, setNewSeniorityName] = useState('');
  const [selectedRateCardId, setSelectedRateCardId] = useState('');
  const [newCardName, setNewCardName] = useState('');

  const globalRateCards = rateCards.filter(c => !c.contract_id);
  const activeRateCard = globalRateCards.find(c => c.id === (selectedRateCardId || globalRateCards[0]?.id)) || globalRateCards[0] || null;
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');

  const handleTabChange = (tab: 'remote' | 'teams' | 'leaves' | 'coverage' | 'roles' | 'seniorities' | 'pricing' | 'timesheets' | 'invoices' | 'tiering' | 'integrations' | 'documents' | 'general') => {
    setSelectedTab(tab);
    if (typeof window !== 'undefined') localStorage.setItem('orbit_settings_active_tab', tab);
  };

  // Hydrate active tab across refreshes (Attio config lives in the dedicated AttioSettings component)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedTab = localStorage.getItem('orbit_settings_active_tab') as any;
    // A deep link wins over the last tab visited.
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested && ['remote', 'teams', 'leaves', 'coverage', 'pricing', 'invoices', 'tiering', 'integrations', 'documents', 'general'].includes(requested)) {
      setSelectedTab(requested as typeof selectedTab);
      return;
    }
    if (savedTab && ['remote', 'teams', 'leaves', 'coverage', 'pricing', 'invoices', 'tiering', 'integrations', 'documents', 'general'].includes(savedTab)) {
      setSelectedTab(savedTab);
    }
  }, []);

  const [newModuleId, setNewModuleId] = useState('');
  const MAN_HOUR_ROLES: Array<{ value: string; label: string }> = [
    { value: 'engineer', label: 'Engineer' },
    { value: 'consultant', label: 'Consultant' },
    { value: 'designer', label: 'Product Designer' },
    { value: 'project_manager', label: 'Project Manager' },
    { value: 'data_scientist', label: 'Data Scientist' },
    { value: 'devops', label: 'DevOps Engineer' },
  ];
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState<number>(1000);
  const [newItemUnit, setNewItemUnit] = useState('flat');
  const [newItemFreq, setNewItemFreq] = useState<'monthly' | 'quarterly' | 'annual' | 'one_time'>('monthly');
  const [newModuleName, setNewModuleName] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemName, setEditItemName] = useState<string>('');
  const [editItemPrice, setEditItemPrice] = useState<number>(0);
  const [editItemUnit, setEditItemUnit] = useState<string>('');
  const [editItemFreq, setEditItemFreq] = useState<'monthly' | 'quarterly' | 'annual' | 'one_time'>('monthly');
  const [editItemModuleId, setEditItemModuleId] = useState<string>('');
  const [newItemPricingKind, setNewItemPricingKind] = useState<'unit' | 'man_hours'>('unit');
  const [newItemRole, setNewItemRole] = useState('engineer');
  const [newItemSeniority, setNewItemSeniority] = useState<'junior' | 'mid' | 'senior'>('mid');
  const [editItemPricingKind, setEditItemPricingKind] = useState<'unit' | 'man_hours'>('unit');
  const [editItemRole, setEditItemRole] = useState('engineer');
  const [editItemSeniority, setEditItemSeniority] = useState<'junior' | 'mid' | 'senior'>('mid');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Locate the company-wide remote policy
  const activeCompanyPolicy = remotePolicies.find(p => p.scope_type === 'company');

  // Local state for remote policy form
  const [maxDays, setMaxDays] = useState<number>(8);
  const [periodType, setPeriodType] = useState<PolicyPeriod>('month');
  const [countsLeave, setCountsLeave] = useState(false);
  const [advanceDays, setAdvanceDays] = useState<number>(0);

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
  const [newLeaveSortOrder, setNewLeaveSortOrder] = useState(100);
  const [newLeaveIsHidden, setNewLeaveIsHidden] = useState(false);
  const [isSubmittingLeaveType, setIsSubmittingLeaveType] = useState(false);

  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);
  const [editLeaveNameEn, setEditLeaveNameEn] = useState('');
  const [editLeaveNameEl, setEditLeaveNameEl] = useState('');
  const [editLeaveColor, setEditLeaveColor] = useState('#3b82f6');
  const [editLeaveCountsAgainstBalance, setEditLeaveCountsAgainstBalance] = useState(false);
  const [editLeaveRequiresDocument, setEditLeaveRequiresDocument] = useState(false);
  const [editLeaveRequiresApproval, setEditLeaveRequiresApproval] = useState(true);
  const [editLeaveSortOrder, setEditLeaveSortOrder] = useState(100);
  const [editLeaveIsHidden, setEditLeaveIsHidden] = useState(false);

  useEffect(() => {
    if (activeCompanyPolicy) {
      setMaxDays(activeCompanyPolicy.max_days ?? activeCompanyPolicy.max_days_per_month ?? 8);
      setPeriodType(activeCompanyPolicy.period_type || 'month');
      setCountsLeave(activeCompanyPolicy.counts_leave ?? false);
      setAdvanceDays(activeCompanyPolicy.registration_advance_days ?? 0);
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
      notifyValidation({ type: 'error', title: 'Remote policy missing', message: "We couldn't find the company remote policy. Please contact an administrator." });
      return;
    }
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await updateRemotePolicy(activeCompanyPolicy.id, {
        max_days: maxDays,
        period_type: periodType,
        counts_leave: countsLeave,
        registration_advance_days: advanceDays
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
      notifySuccess(`Team "${newTeamName.trim()}" has been created.`);
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
      notifySuccess('Team updated.');
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
      requires_approval: newLeaveRequiresApproval,
      sort_order: Number(newLeaveSortOrder) || 100,
      is_hidden: newLeaveIsHidden
    });
    setIsSubmittingLeaveType(false);
    if (success) {
      notifySuccess(`Leave category "${newLeaveNameEn.trim()}" added.`);
      setNewLeaveCode('');
      setNewLeaveNameEn('');
      setNewLeaveNameEl('');
      setNewLeaveColor('#3b82f6');
      setNewLeaveCountsAgainstBalance(false);
      setNewLeaveRequiresDocument(false);
      setNewLeaveRequiresApproval(true);
      setNewLeaveSortOrder((leaveTypes.length + 2) * 10);
      setNewLeaveIsHidden(false);
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
      requires_approval: editLeaveRequiresApproval,
      sort_order: Number(editLeaveSortOrder) || 100,
      is_hidden: editLeaveIsHidden
    });
    if (success) {
      setEditingLeaveId(null);
      notifySuccess('Leave category updated.');
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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pb-16 animate-in fade-in duration-200">
      {/* MAIN SETTINGS CONTENT AREA (Left Column - 9 cols on large screens) */}
      <div className="lg:col-span-9 space-y-6">
        {/* TAB 1: REMOTE WORK POLICY */}
        {selectedTab === 'remote' && (
          <>
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
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2f6fa3] focus:border-transparent transition-all shadow-2xs"
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
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2f6fa3] focus:border-transparent transition-all cursor-pointer shadow-2xs"
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
                            ? 'bg-[#2f6fa3]/10 border-[#2f6fa3] ring-1 ring-[#2f6fa3]/50 text-[#2f6fa3] shadow-xs font-extrabold'
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

              {/* Count leave toward the remote quota */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-4">
                <div>
                  <span className="text-xs font-extrabold text-slate-800 block">Count approved leave toward the remote quota</span>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    When on, approved leave days in the period are added to remote-day usage. For example, with a quota of 2/week, 3 leave days that week use the whole quota, so no remote work can be declared that week.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCountsLeave(v => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer ${countsLeave ? 'bg-[#2f6fa3]' : 'bg-slate-300'}`}
                  title={countsLeave ? 'Leave counts toward remote quota' : 'Leave does not count toward remote quota'}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${countsLeave ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>

              {/* Advance registration notice: remote days must be declared N days ahead */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-xs font-extrabold text-slate-800 block">Remote days must be registered in advance</span>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    Number of calendar days before the work date that employees must declare remote work. Days inside this window are blocked from declaration (and auto-fill turns them to office) unless an admin approves an exception. Set 0 to disable the rule.
                  </p>
                  {advanceDays > 0 && (
                    <p className="text-[11px] text-[#2f6fa3] mt-1.5 font-bold flex items-center">
                      <Calendar className="w-3 h-3 mr-1" />
                      Employees can only register remote days on or after {advanceDays} day{advanceDays === 1 ? '' : 's'} from today.
                    </p>
                  )}
                </div>
                <div className="relative shrink-0 w-36">
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={advanceDays}
                    onChange={(e) => setAdvanceDays(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-lg font-bold text-slate-900 text-left focus:outline-none focus:ring-2 focus:ring-[#2f6fa3] focus:border-transparent shadow-2xs"
                  />
                  <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-[10px] text-slate-400 font-extrabold">
                    DAYS AHEAD
                  </div>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs">
                  {saveSuccess && (
                    <span className="flex items-center text-emerald-600 font-bold animate-in fade-in">
                      <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-500" />
                      Company remote policy saved.
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
                      <span>Saving…</span>
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

        {/* Per-Employee Remote Quotas */}
        <div className="rounded-2xl bg-white border border-slate-200 shadow-2xs p-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-extrabold text-slate-800">Per-Employee Remote Quotas</span>
            <Badge variant="info">{profiles.filter(p => remotePolicies.some(rp => rp.scope_type === 'employee' && rp.scope_id === p.id)).length} customized</Badge>
          </div>
          <p className="text-xs text-slate-500 mb-3">Employees without a personal quota use the company default above. A personal quota overrides it — edit or clear per person here.</p>
          <div className="divide-y divide-slate-100">
            {profiles.map(p => (
              <div key={p.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                <div className="min-w-[180px]">
                  <div className="text-xs font-bold text-slate-800">{p.first_name} {p.last_name}</div>
                  <div className="text-[10px] text-slate-400">{roleLabel(p, profileRoleHistory, jobRoles, seniorityLevels)}</div>
                </div>
                <div className="flex-1"><EmployeeRemoteQuota key={p.id} profileId={p.id} /></div>
              </div>
            ))}
          </div>
        </div>
        </>
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
                      <div key={t.id} className="p-4 rounded-xl bg-slate-50 border-2 border-[#2f6fa3] shadow-xs space-y-3">
                        <div className="flex items-center justify-between font-bold text-xs text-[#2f6fa3]">
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
                                <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name} ({emp.employment_type.replace('_', ' ')})</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="flex justify-end space-x-2 pt-1">
                          <Button size="sm" variant="outline" onClick={() => setEditingTeamId(null)}>Cancel</Button>
                          <Button size="sm" variant="primary" onClick={() => handleUpdateTeam(t.id)} className="bg-[#2f6fa3] font-bold cursor-pointer">
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
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#2f6fa3] focus:outline-none shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block font-bold uppercase text-slate-700 mb-1">Department Head / Lead</label>
                  <select
                    value={newTeamLeadId}
                    onChange={(e) => setNewTeamLeadId(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#2f6fa3] focus:outline-none shadow-2xs cursor-pointer text-xs"
                  >
                    <option value="">-- No Lead Assigned (Optional) --</option>
                    {activeEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name} ({emp.employment_type.replace('_', ' ')})</option>
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
                  className="w-full py-3 bg-[#2f6fa3] hover:bg-[#2f6fa3]/90 text-white font-extrabold rounded-xl shadow-xs cursor-pointer flex items-center justify-center"
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
          <div className="lg:col-span-3"><LeaveDefaultsCard /></div>
          <div className="lg:col-span-3"><CarryoverPolicyCard /></div>
          <div className="lg:col-span-3"><CarryoverRecalculationCard /></div>
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
                      <div key={t.id} className="p-4 rounded-xl bg-slate-50 border-2 border-[#2f6fa3] shadow-xs space-y-3">
                        <div className="flex items-center justify-between font-bold text-xs text-[#2f6fa3]">
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mt-2">
                          <div>
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
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">Sort Order</label>
                            <input
                              type="number"
                              value={editLeaveSortOrder}
                              onChange={(e) => setEditLeaveSortOrder(Number(e.target.value))}
                              className="w-full p-2 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900"
                            />
                          </div>
                        </div>
                        <div className="space-y-2 pt-2 border-t border-slate-200 text-xs font-bold text-slate-700">
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editLeaveCountsAgainstBalance}
                              onChange={(e) => setEditLeaveCountsAgainstBalance(e.target.checked)}
                              className="rounded text-[#2f6fa3] focus:ring-[#2f6fa3] w-4 h-4"
                            />
                            <span>Deduct from Employee's Annual Entitlement Balance</span>
                          </label>
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editLeaveRequiresDocument}
                              onChange={(e) => setEditLeaveRequiresDocument(e.target.checked)}
                              className="rounded text-[#2f6fa3] focus:ring-[#2f6fa3] w-4 h-4"
                            />
                            <span>Requires Uploading Official Supporting Document (e.g., Medical Note)</span>
                          </label>
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editLeaveRequiresApproval}
                              onChange={(e) => setEditLeaveRequiresApproval(e.target.checked)}
                              className="rounded text-[#2f6fa3] focus:ring-[#2f6fa3] w-4 h-4"
                            />
                            <span>Requires Manager / Founder Approval (Not Auto-approved)</span>
                          </label>
                          <label className="flex items-center space-x-2 cursor-pointer text-amber-800 pt-1">
                            <input
                              type="checkbox"
                              checked={editLeaveIsHidden}
                              onChange={(e) => setEditLeaveIsHidden(e.target.checked)}
                              className="rounded text-[#2f6fa3] focus:ring-[#2f6fa3] w-4 h-4"
                            />
                            <span>Hide Category from New Leave Requests (Archival / Disable)</span>
                          </label>
                        </div>
                        <div className="flex justify-end space-x-2 pt-1">
                          <Button size="sm" variant="outline" onClick={() => setEditingLeaveId(null)}>Cancel</Button>
                          <Button size="sm" variant="primary" onClick={() => handleUpdateLeaveType(t.id)} className="bg-[#2f6fa3] font-bold cursor-pointer">
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
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                            Order: {t.sort_order ?? 100}
                          </span>
                          {t.is_hidden && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                              👁️ Hidden from New Requests
                            </span>
                          )}
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
                            setEditLeaveSortOrder(t.sort_order ?? 100);
                            setEditLeaveIsHidden(!!t.is_hidden);
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
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#2f6fa3] focus:outline-none shadow-2xs font-mono lowercase"
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
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#2f6fa3] focus:outline-none shadow-2xs"
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
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-[#2f6fa3] focus:outline-none shadow-2xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold uppercase text-slate-700 mb-1">Display Sort Order</label>
                    <input
                      type="number"
                      placeholder="e.g., 10, 20"
                      value={newLeaveSortOrder}
                      onChange={(e) => setNewLeaveSortOrder(Number(e.target.value))}
                      required
                      className="w-full p-2.5 bg-white border border-slate-300 rounded-xl font-bold font-mono text-slate-900 shadow-2xs"
                    />
                  </div>
                  <div>
                    <label className="block font-bold uppercase text-slate-700 mb-1">Calendar Color</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={newLeaveColor}
                        onChange={(e) => setNewLeaveColor(e.target.value)}
                        className="w-10 h-10 p-0.5 rounded-xl border border-slate-300 bg-white cursor-pointer shadow-2xs shrink-0"
                      />
                      <span className="font-mono font-bold uppercase text-slate-700">{newLeaveColor}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1">
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

                <div className="space-y-2.5 pt-2 border-t border-slate-200 font-bold text-slate-700">
                  <label className="flex items-start space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newLeaveCountsAgainstBalance}
                      onChange={(e) => setNewLeaveCountsAgainstBalance(e.target.checked)}
                      className="rounded text-[#2f6fa3] focus:ring-[#2f6fa3] w-4 h-4 mt-0.5"
                    />
                    <span>Deduct from Annual Entitlement Balance (usually OFF for sick/parental)</span>
                  </label>
                  <label className="flex items-start space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newLeaveRequiresDocument}
                      onChange={(e) => setNewLeaveRequiresDocument(e.target.checked)}
                      className="rounded text-[#2f6fa3] focus:ring-[#2f6fa3] w-4 h-4 mt-0.5"
                    />
                    <span>Require Employee to Attach Medical/Legal Document</span>
                  </label>
                  <label className="flex items-start space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newLeaveRequiresApproval}
                      onChange={(e) => setNewLeaveRequiresApproval(e.target.checked)}
                      className="rounded text-[#2f6fa3] focus:ring-[#2f6fa3] w-4 h-4 mt-0.5"
                    />
                    <span>Require Founder / Manager Approval Sign-off</span>
                  </label>
                  <label className="flex items-start space-x-2.5 cursor-pointer text-amber-800 pt-1 border-t border-slate-100">
                    <input
                      type="checkbox"
                      checked={newLeaveIsHidden}
                      onChange={(e) => setNewLeaveIsHidden(e.target.checked)}
                      className="rounded text-[#2f6fa3] focus:ring-[#2f6fa3] w-4 h-4 mt-0.5"
                    />
                    <span>Hide from New Leave Requests (Archived / Disabled)</span>
                  </label>
                </div>

                <Button 
                  variant="primary" 
                  type="submit" 
                  disabled={isSubmittingLeaveType}
                  className="w-full py-3 bg-[#2f6fa3] hover:bg-[#2f6fa3]/90 text-white font-extrabold rounded-xl shadow-xs cursor-pointer flex items-center justify-center mt-4"
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Register Leave Category
                </Button>
              </form>
            </Card>
          </div>
          {/* Public holiday calendar — the single source of truth for working-day maths */}
          <div className="lg:col-span-3"><HolidaysCard /></div>
        </div>
      )}

      {/* TAB 4: MODULAR CONTRACT PRICING CATALOG */}
      {selectedTab === 'pricing' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Active Modules and Items List */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center">
                  <Layers className="w-5 h-5 mr-2 text-purple-600" /> Modular Rate Sheet Catalog ({catalogItems.length} Items)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure core ETRM subscriptions, optimization engines, and billing tiers for commercial proposals.
                </p>
              </div>
              <Badge variant="info">Synced with public.catalog_items</Badge>
            </div>

            <div className="p-4 rounded-xl bg-purple-50 border border-purple-200 flex items-start space-x-3">
              <Info className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
              <div className="text-xs text-purple-900">
                <span className="font-extrabold block mb-0.5">Snapshot Pricing Guarantee</span>
                Changing default prices or removing catalog items applies strictly to <strong>future contracts</strong>. Existing signed agreements independently copy and preserve their original line items and revenue schedules.
              </div>
            </div>

            <div className="space-y-6">
              {catalogModules.length === 0 ? (
                <Card className="p-12 text-center text-slate-500 text-xs border-dashed">
                  No catalog modules found. Create your first product tier on the right.
                </Card>
              ) : (
                catalogModules.map(mod => {
                  const items = catalogItems.filter(i => i.module_id === mod.id);
                  return (
                    <Card key={mod.id} className="overflow-hidden border-slate-200 shadow-xs">
                      <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-extrabold text-slate-800">{mod.name}</span>
                          <Badge variant="info">{items.length} rate items</Badge>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Delete module "${mod.name}" and its ${items.length} items?`)) {
                              deleteCatalogModule(mod.id);
                            }
                          }}
                          className="text-slate-400 hover:text-rose-600 transition-colors p-1 rounded hover:bg-rose-50 cursor-pointer text-xs flex items-center"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Module
                        </button>
                      </div>

                      {items.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 text-xs">
                          No rate items attached to this module yet.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {items.map(item => {
                            if (editingItemId === item.id) {
                              return (
                                <form
                                  key={item.id}
                                  onSubmit={async (e) => {
                                    e.preventDefault();
                                    await saveCatalogItem({
                                      id: item.id,
                                      module_id: editItemModuleId || item.module_id,
                                      name: editItemName.trim(),
                                      default_unit_price: Number(editItemPrice) || 0,
                                      unit_label: editItemUnit.trim() || 'unit',
                                      default_frequency: editItemFreq,
                                      active: item.active,
                                      pricing_kind: editItemPricingKind,
                                      role: editItemPricingKind === 'man_hours' ? editItemRole : null,
                                      seniority: editItemPricingKind === 'man_hours' ? editItemSeniority : null
                                    });
                                    setEditingItemId(null);
                                  }}
                                  className="p-4 bg-purple-50/70 border-l-4 border-purple-600 space-y-3"
                                >
                                  <div className="flex flex-col sm:flex-row items-center gap-3">
                                    <div className="flex-1 w-full">
                                      <label className="block text-[10px] font-extrabold uppercase text-purple-900 mb-1">Item Description / Name</label>
                                      <input
                                        type="text"
                                        value={editItemName}
                                        onChange={e => setEditItemName(e.target.value)}
                                        className="w-full bg-white border border-purple-300 rounded-lg p-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        required
                                      />
                                    </div>
                                    <div className="w-full sm:w-44">
                                      <label className="block text-[10px] font-extrabold uppercase text-purple-900 mb-1">Module Category</label>
                                      <select
                                        value={editItemModuleId || item.module_id}
                                        onChange={e => setEditItemModuleId(e.target.value)}
                                        className="w-full bg-white border border-purple-300 rounded-lg p-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                      >
                                        {catalogModules.map(m => (
                                          <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                      <label className="block text-[10px] font-extrabold uppercase text-purple-900 mb-1">Default Rate (€)</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={editItemPrice}
                                        onChange={e => setEditItemPrice(parseFloat(e.target.value) || 0)}
                                        className="w-full bg-white border border-purple-300 rounded-lg p-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        required
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-extrabold uppercase text-purple-900 mb-1">Unit Label</label>
                                      <input
                                        type="text"
                                        value={editItemUnit}
                                        onChange={e => setEditItemUnit(e.target.value)}
                                        placeholder="flat, MW, assets..."
                                        className="w-full bg-white border border-purple-300 rounded-lg p-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        required
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-extrabold uppercase text-purple-900 mb-1">Default Cadence</label>
                                      <select
                                        value={editItemFreq}
                                        onChange={e => setEditItemFreq(e.target.value as any)}
                                        className="w-full bg-white border border-purple-300 rounded-lg p-2 text-xs font-semibold uppercase text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                      >
                                        <option value="monthly">Monthly</option>
                                        <option value="quarterly">Quarterly</option>
                                        <option value="annual">Annual</option>
                                        <option value="one_time">One-time</option>
                                      </select>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                      <label className="block text-[10px] font-extrabold uppercase text-purple-900 mb-1">Pricing Type</label>
                                      <select
                                        value={editItemPricingKind}
                                        onChange={e => setEditItemPricingKind(e.target.value as any)}
                                        className="w-full bg-white border border-purple-300 rounded-lg p-2 text-xs font-semibold uppercase text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                      >
                                        <option value="unit">Unit (fixed recurring)</option>
                                        <option value="man_hours">Man-Hours (billed from timesheets)</option>
                                      </select>
                                    </div>
                                    {editItemPricingKind === 'man_hours' && (
                                      <>
                                        <div>
                                          <label className="block text-[10px] font-extrabold uppercase text-purple-900 mb-1">Role</label>
                                          <select
                                            value={editItemRole}
                                            onChange={e => setEditItemRole(e.target.value)}
                                            className="w-full bg-white border border-purple-300 rounded-lg p-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                          >
                                            {MAN_HOUR_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="block text-[10px] font-extrabold uppercase text-purple-900 mb-1">Seniority</label>
                                          <select
                                            value={editItemSeniority}
                                            onChange={e => setEditItemSeniority(e.target.value as any)}
                                            className="w-full bg-white border border-purple-300 rounded-lg p-2 text-xs font-semibold uppercase text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                          >
                                            <option value="junior">Junior</option>
                                            <option value="mid">Mid</option>
                                            <option value="senior">Senior</option>
                                          </select>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                  <div className="flex items-center justify-end space-x-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setEditingItemId(null)}
                                      className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-600 font-extrabold text-xs inline-flex items-center transition-colors cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5 mr-1" /> Cancel
                                    </button>
                                    <button
                                      type="submit"
                                      className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs inline-flex items-center shadow-md transition-colors cursor-pointer"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Save Changes
                                    </button>
                                  </div>
                                </form>
                              );
                            }

                            return (
                            <div key={item.id} className="p-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2">
                                  <span className="text-sm font-bold text-slate-900">{item.name}</span>
                                  <Badge variant={item.default_frequency === 'one_time' ? 'warning' : 'success'}>
                                    {item.default_frequency}
                                  </Badge>
                                </div>
                                <div className="text-xs text-slate-500 font-mono flex items-center space-x-3">
                                  <span>Default Rate: <strong className="text-slate-800">€{Number(item.default_unit_price).toLocaleString()}</strong> / {item.unit_label}</span>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingItemId(item.id);
                                    setEditItemName(item.name);
                                    setEditItemPrice(Number(item.default_unit_price));
                                    setEditItemUnit(item.unit_label);
                                    setEditItemFreq(item.default_frequency);
                                    setEditItemModuleId(item.module_id);
                                    setEditItemPricingKind(item.pricing_kind || 'unit');
                                    setEditItemRole(item.role || 'engineer');
                                    setEditItemSeniority((item.seniority as any) || 'mid');
                                  }}
                                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-purple-50 hover:border-purple-300 hover:text-purple-700 text-slate-600 font-bold text-xs inline-flex items-center transition-all cursor-pointer shadow-2xs"
                                  title="Edit rate item default values"
                                >
                                  <Edit2 className="w-3 h-3 mr-1" /> Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteCatalogItem(item.id)}
                                  className="text-slate-400 hover:text-rose-600 transition-colors p-1.5 rounded hover:bg-rose-50 cursor-pointer"
                                  title="Delete item from catalog"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Creation Form Cards */}
          <div className="space-y-6">
            <Card title="Register Rate Sheet Item" subtitle="Add a standardized fee or license item to the catalog" className="shadow-sm border-slate-200">
              <form onSubmit={async (e) => {
                e.preventDefault();
                const targetModule = newModuleId || (catalogModules[0]?.id || '');
                if (!targetModule || !newItemName.trim()) return;
                await saveCatalogItem({
                  module_id: targetModule,
                  name: newItemName.trim(),
                  default_unit_price: Number(newItemPrice) || 0,
                  unit_label: newItemUnit.trim() || 'unit',
                  default_frequency: newItemFreq,
                  active: true,
                  pricing_kind: newItemPricingKind,
                  role: newItemPricingKind === 'man_hours' ? newItemRole : null,
                  seniority: newItemPricingKind === 'man_hours' ? newItemSeniority : null
                });
                setNewItemName('');
                setNewItemPrice(1000);
              }} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Target Product Module</label>
                  <select
                    value={newModuleId || catalogModules[0]?.id || ''}
                    onChange={e => setNewModuleId(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-semibold focus:ring-2 focus:ring-purple-500 bg-white"
                    required
                  >
                    {catalogModules.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Fee / Service Item Name</label>
                  <input
                    type="text"
                    value={newItemName}
                    onChange={e => setNewItemName(e.target.value)}
                    placeholder="e.g. PV Dispatch 50–200 Band..."
                    className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-purple-500 font-medium"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Default Rate (€)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newItemPrice}
                      onChange={e => setNewItemPrice(parseFloat(e.target.value) || 0)}
                      className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-purple-500 font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Unit Label</label>
                    <input
                      type="text"
                      value={newItemUnit}
                      onChange={e => setNewItemUnit(e.target.value)}
                      placeholder="flat, MW, assets..."
                      className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-purple-500 font-medium"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Default Payment Cadence</label>
                  <select
                    value={newItemFreq}
                    onChange={e => setNewItemFreq(e.target.value as any)}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-semibold focus:ring-2 focus:ring-purple-500 bg-white uppercase"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                    <option value="one_time">One-time (undiscounted)</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Pricing Type</label>
                    <select
                      value={newItemPricingKind}
                      onChange={e => setNewItemPricingKind(e.target.value as any)}
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-semibold uppercase focus:ring-2 focus:ring-purple-500 bg-white"
                    >
                      <option value="unit">Unit (fixed recurring)</option>
                      <option value="man_hours">Man-Hours (billed from timesheets)</option>
                    </select>
                  </div>
                  {newItemPricingKind === 'man_hours' && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Role</label>
                        <select
                          value={newItemRole}
                          onChange={e => setNewItemRole(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-semibold focus:ring-2 focus:ring-purple-500 bg-white"
                        >
                          {MAN_HOUR_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Seniority</label>
                        <select
                          value={newItemSeniority}
                          onChange={e => setNewItemSeniority(e.target.value as any)}
                          className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-semibold uppercase focus:ring-2 focus:ring-purple-500 bg-white"
                        >
                          <option value="junior">Junior</option>
                          <option value="mid">Mid</option>
                          <option value="senior">Senior</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>
                <Button type="submit" variant="primary" className="w-full justify-center bg-purple-600 hover:bg-purple-700 text-white font-extrabold cursor-pointer shadow-md">
                  <Plus className="w-4 h-4 mr-1" /> Register Catalog Item
                </Button>
              </form>
            </Card>

            <Card title="Add Product Module" subtitle="Create a top-level category header in the catalog" className="shadow-sm border-slate-200">
              <form onSubmit={async (e) => {
                e.preventDefault();
                if (!newModuleName.trim()) return;
                await saveCatalogModule({ name: newModuleName.trim(), sort_order: (catalogModules.length + 1) * 10, active: true });
                setNewModuleName('');
              }} className="space-y-3">
                <input
                  type="text"
                  value={newModuleName}
                  onChange={e => setNewModuleName(e.target.value)}
                  placeholder="Module category name..."
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-purple-500 font-medium"
                  required
                />
                <Button type="submit" variant="outline" className="w-full justify-center text-xs font-bold border-purple-300 text-purple-700 hover:bg-purple-50 cursor-pointer">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Category Module
                </Button>
              </form>
            </Card>
          </div>
        </div>
      )}

      {/* TAB: TEAM COVERAGE RULES (max N of a group away on the same day) */}
      {selectedTab === 'coverage' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <CoverageRulesCard />
        </div>
      )}

      {/* TAB 4.3: JOB ROLES (workforce structure) */}
      {selectedTab === 'roles' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center"><Tag className="w-5 h-5 mr-2 text-blue-600" /> Job Roles</h2>
              <p className="text-xs text-slate-500 mt-0.5">Roles performed on engagements (workforce structure). Consumed by timesheets, rate cards, and assignments.</p>
            </div>
            <Badge variant="info">{jobRoles.filter(r => r.active).length} active roles</Badge>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 shadow-2xs p-5 space-y-3 max-w-2xl">
            {jobRoles.filter(r => r.active).sort((a, b) => a.sort_order - b.sort_order).map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 rounded-lg text-xs">
                <span className="font-semibold text-slate-700">{r.name}</span>
                <button onClick={async () => { if (confirm(`Delete role "${r.name}"?`)) await deleteJobRole(r.id); }} className="text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="New role…" className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              <Button variant="primary" size="sm" onClick={async () => { if (!newRoleName.trim()) { alert('Name required.'); return; } await saveJobRole({ name: newRoleName.trim(), sort_order: (jobRoles.length + 1) * 10 }); setNewRoleName(''); }} className="cursor-pointer"><Plus className="w-3.5 h-3.5 mr-1" /> Add Role</Button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4.4: SENIORITY LEVELS (workforce structure) */}
      {selectedTab === 'seniorities' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center"><Sliders className="w-5 h-5 mr-2 text-violet-600" /> Seniority Levels</h2>
              <p className="text-xs text-slate-500 mt-0.5">Ordered career levels (workforce structure). Consumed by timesheets, rate cards, and assignments.</p>
            </div>
            <Badge variant="info">{seniorityLevels.filter(s => s.active).length} active levels</Badge>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 shadow-2xs p-5 space-y-3 max-w-2xl">
            {seniorityLevels.filter(s => s.active).sort((a, b) => a.rank - b.rank).map(s => (
              <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 rounded-lg text-xs">
                <span className="font-semibold text-slate-700">{s.name}</span>
                <button onClick={async () => { if (confirm(`Delete level "${s.name}"?`)) await deleteSeniorityLevel(s.id); }} className="text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <input value={newSeniorityName} onChange={e => setNewSeniorityName(e.target.value)} placeholder="New level…" className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              <Button variant="primary" size="sm" onClick={async () => { if (!newSeniorityName.trim()) { alert('Name required.'); return; } await saveSeniorityLevel({ name: newSeniorityName.trim(), rank: seniorityLevels.length + 1 }); setNewSeniorityName(''); }} className="cursor-pointer"><Plus className="w-3.5 h-3.5 mr-1" /> Add Level</Button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4.5: TIMESHEET CONFIGURATION (overview of what affects timesheets + rate card source of truth) */}
      {selectedTab === 'timesheets' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center"><Clock className="w-5 h-5 mr-2 text-sky-600" /> Timesheet Configuration</h2>
              <p className="text-xs text-slate-500 mt-0.5">One view of everything that affects timesheets. Each item is configured at its own source of truth — quick links below.</p>
            </div>
            <Badge variant="info">{globalRateCards.length} rate card(s)</Badge>
          </div>

          {/* Sources & quick links */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button onClick={() => handleTabChange('roles')} className="rounded-2xl bg-white border border-slate-200 shadow-2xs p-4 text-left hover:border-blue-300 hover:shadow-md transition-all cursor-pointer">
              <div className="flex items-center justify-between"><Tag className="w-4 h-4 text-blue-500" /><ChevronRight className="w-4 h-4 text-slate-300" /></div>
              <div className="mt-2 text-sm font-extrabold text-slate-800">Job Roles</div>
              <div className="text-[11px] text-slate-400">{jobRoles.filter(r => r.active).length} active · Workforce Policies</div>
            </button>
            <button onClick={() => handleTabChange('seniorities')} className="rounded-2xl bg-white border border-slate-200 shadow-2xs p-4 text-left hover:border-violet-300 hover:shadow-md transition-all cursor-pointer">
              <div className="flex items-center justify-between"><Sliders className="w-4 h-4 text-violet-500" /><ChevronRight className="w-4 h-4 text-slate-300" /></div>
              <div className="mt-2 text-sm font-extrabold text-slate-800">Seniority Levels</div>
              <div className="text-[11px] text-slate-400">{seniorityLevels.filter(s => s.active).length} active · Workforce Policies</div>
            </button>
            <a href="/people" className="rounded-2xl bg-white border border-slate-200 shadow-2xs p-4 text-left hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer">
              <div className="flex items-center justify-between"><Users className="w-4 h-4 text-emerald-500" /><ChevronRight className="w-4 h-4 text-slate-300" /></div>
              <div className="mt-2 text-sm font-extrabold text-slate-800">Role & Seniority Assignments</div>
              <div className="text-[11px] text-slate-400">{profiles.filter(p => profileRoleHistory.some(h => h.profile_id === p.id && !h.valid_to)).length} assigned · per person in People</div>
            </a>
            <div className="rounded-2xl bg-sky-50 border border-sky-200 shadow-2xs p-4">
              <div className="flex items-center justify-between"><DollarSign className="w-4 h-4 text-sky-600" /></div>
              <div className="mt-2 text-sm font-extrabold text-slate-800">Rate Card</div>
              <div className="text-[11px] text-slate-500">Merged man-hours pricing · edited below</div>
            </div>
          </div>

          {/* Rate card matrix — single source of truth for man-hours hourly rates */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                <span className="text-sm font-extrabold text-slate-800">Rate Card Matrix (hourly €)</span>
                <div className="flex items-center gap-2">
                  <select value={activeRateCard?.id || ''} onChange={e => setSelectedRateCardId(e.target.value)} className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700">
                    {globalRateCards.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_default ? ' (default)' : ''}</option>)}
                  </select>
                  <button onClick={async () => { if (activeRateCard && confirm(`Delete rate card "${activeRateCard.name}"?`)) await deleteRateCard(activeRateCard.id); }} className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              {activeRateCard ? (
                <RateCardMatrix cardId={activeRateCard.id} />
              ) : (
                <div className="p-8 text-center text-xs text-slate-400">No global rate card yet — create one on the right.</div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl bg-white border border-slate-200 shadow-2xs p-4 space-y-2">
                <span className="text-xs font-extrabold text-slate-800 flex items-center"><Plus className="w-3.5 h-3.5 mr-1.5 text-sky-600" /> New Rate Card</span>
                <div className="flex gap-2">
                  <input value={newCardName} onChange={e => setNewCardName(e.target.value)} placeholder="Card name…" className="flex-1 bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
                  <Button variant="primary" size="sm" onClick={async () => { if (!newCardName.trim()) { alert('Name required.'); return; } await saveRateCard({ name: newCardName.trim(), is_default: globalRateCards.length === 0 }); setNewCardName(''); }} className="cursor-pointer"><Plus className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* TAB 6: INVOICE & BUDGET CATEGORIES */}
      {selectedTab === 'tiering' && (
        <TieringSettings />
      )}

      {selectedTab === 'invoices' && (
        <div className="space-y-8 animate-fadeIn">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-600" />
                Invoice Expense & Budgeting Categories
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                Configure standardized expenditure tags applied to unlinked supplier bills, one-off vendor invoices, and financial reports. Admins can expand the default catalog with customized corporate budget accounts.
              </p>
            </div>
            <Badge variant="success" className="px-3 py-1 text-xs">Synced with public.invoice_categories</Badge>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Create New Category Card */}
            <Card className="p-6 border-slate-200 shadow-sm bg-white rounded-2xl h-fit">
              <h4 className="font-bold text-slate-800 text-sm mb-4 flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#2f6fa3]" />
                Add Custom Budget Category
              </h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category / Tag Name</label>
                  <input
                    type="text"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="e.g., Software & R&D Licenses"
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-medium focus:outline-none focus:ring-2 focus:ring-[#2f6fa3]/20 focus:border-[#2f6fa3] transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Description & Usage Guide</label>
                  <textarea
                    rows={3}
                    value={newCatDesc}
                    onChange={(e) => setNewCatDesc(e.target.value)}
                    placeholder="Briefly describe what invoices should fall under this financial tag..."
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl bg-slate-50 font-medium focus:outline-none focus:ring-2 focus:ring-[#2f6fa3]/20 focus:border-[#2f6fa3] transition-all resize-none"
                  />
                </div>
                <Button
                  onClick={async () => {
                    if (!newCatName.trim()) {
                      alert('Please enter a category name.');
                      return;
                    }
                    await addInvoiceCategory(newCatName.trim(), newCatDesc.trim());
                    setNewCatName('');
                    setNewCatDesc('');
                  }}
                  disabled={!newCatName.trim()}
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-3.5 h-3.5" />
                  Add Category to Database
                </Button>
              </div>
            </Card>

            {/* Existing Categories List */}
            <div className="lg:col-span-2 space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100/80 border-b border-slate-200 font-bold text-slate-600 uppercase text-[11px] tracking-wider">
                    <tr>
                      <th className="p-4">Category / Account Tag</th>
                      <th className="p-4">Description</th>
                      <th className="p-4">Type</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white font-medium">
                    {invoiceCategories?.map((cat) => (
                      <tr key={cat.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-4 font-bold text-slate-900 flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                            <Tag className="w-4 h-4" />
                          </div>
                          <span>{cat.name}</span>
                        </td>
                        <td className="p-4 text-slate-600 max-w-sm">
                          {cat.description || <span className="text-slate-400 italic">No description provided</span>}
                        </td>
                        <td className="p-4">
                          {cat.is_default ? (
                            <span className="px-2 py-1 rounded-md bg-blue-50 text-[#2f6fa3] border border-blue-200/60 text-[11px] font-bold">
                              System Default
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-md bg-purple-50 text-purple-700 border border-purple-200/60 text-[11px] font-bold">
                              Custom Admin
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => {
                              if (confirm(`Are you sure you want to delete category "${cat.name}"?`)) {
                                deleteInvoiceCategory(cat.id);
                              }
                            }}
                            title="Remove Category"
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(!invoiceCategories || invoiceCategories.length === 0) && (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-400 font-medium italic">
                          No invoice expense categories found. Add your first category above!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <Card className="p-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl border-none shadow-md flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-emerald-400 border border-white/15">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-sm text-white">Commercial Payment Terms Configuration</h5>
                    <p className="text-xs text-slate-300">
                      Contracts across Orbit inherit a default commercial maturity of <strong className="text-emerald-400">Net 30 Days</strong> (payment_terms_days = 30), customizable per client/supplier contract agreement.
                    </p>
                  </div>
                </div>
                <span className="px-3 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl font-bold text-xs">
                  Standardized (AADE Compliant)
                </span>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* Placeholders for Future Setting Modules */}
      {selectedTab === 'documents' && (
        <PaymentDocumentTypesSettings />
      )}
      {selectedTab === 'integrations' && (
        <IntegrationsSettings />
      )}
      {selectedTab === 'general' && (
        <div className="space-y-6">
          <GeneralSettings />
          <ScreenVisibilityCard />
        </div>
      )}
      </div>

      {/* RIGHT SIDEBAR NAVIGATION PANEL (Right Side - 3 cols on large screens) */}
      <div className="lg:col-span-3 lg:sticky lg:top-6 space-y-6">
        {/* Navigation Card */}
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200/80">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#2f6fa3]/10 flex items-center justify-center text-[#2f6fa3]">
                <Settings className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 leading-tight">Company Settings</h3>
                <p className="text-[11px] text-slate-500">System Configurations</p>
              </div>
            </div>
            {isAdmin ? (
              <Badge variant="success" className="text-[10px] uppercase font-mono px-2 py-0.5">Admin Hub</Badge>
            ) : (
              <Badge variant="info" className="text-[10px] uppercase font-mono px-2 py-0.5">View Only</Badge>
            )}
          </div>

          {/* Section: Workforce & Organization */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-mono font-extrabold uppercase tracking-wider text-slate-400 px-3 block mb-2">
              Workforce Policies & Structure
            </span>

            <button
              onClick={() => handleTabChange('remote')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'remote'
                  ? 'bg-blue-50/70 border-blue-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'remote' ? 'bg-blue-500 text-white shadow-xs' : 'bg-blue-50 text-blue-600'}`}>
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Remote Work Quotas</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Patterns & compliance limits</div>
                </div>
              </div>
              <ChevronRight className={`w-4 h-4 transition-transform ${selectedTab === 'remote' ? 'text-blue-600 translate-x-0.5' : 'text-slate-300'}`} />
            </button>

            <button
              onClick={() => handleTabChange('teams')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'teams'
                  ? 'bg-emerald-50/70 border-emerald-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'teams' ? 'bg-emerald-500 text-white shadow-xs' : 'bg-emerald-50 text-emerald-600'}`}>
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Departments & Teams</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">{teams.length} registered departments</div>
                </div>
              </div>
              <Badge variant="success" className="text-[10px] px-1.5 py-0">{teams.length}</Badge>
            </button>

            <button
              onClick={() => handleTabChange('leaves')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'leaves'
                  ? 'bg-amber-50/70 border-amber-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'leaves' ? 'bg-amber-500 text-white shadow-xs' : 'bg-amber-50 text-amber-600'}`}>
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Leave Policies</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Vacation & sick allowances</div>
                </div>
              </div>
              <Badge variant="warning" className="text-[10px] px-1.5 py-0">{leaveTypes.length}</Badge>
            </button>

            <button
              onClick={() => handleTabChange('coverage')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'coverage'
                  ? 'bg-indigo-50/70 border-indigo-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'coverage' ? 'bg-indigo-500 text-white shadow-xs' : 'bg-indigo-50 text-indigo-600'}`}>
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Team Coverage Rules</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Prevent whole-group absence</div>
                </div>
              </div>
              <Badge variant="info" className="text-[10px] px-1.5 py-0">{coverageGroups.length}</Badge>
            </button>

            <button
              onClick={() => handleTabChange('roles')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'roles'
                  ? 'bg-blue-50/70 border-blue-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'roles' ? 'bg-blue-500 text-white shadow-xs' : 'bg-blue-50 text-blue-600'}`}>
                  <Tag className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Job Roles</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Roles performed on engagements</div>
                </div>
              </div>
              <Badge variant="info" className="text-[10px] px-1.5 py-0">{jobRoles.filter(r => r.active).length}</Badge>
            </button>

            <button
              onClick={() => handleTabChange('seniorities')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'seniorities'
                  ? 'bg-violet-50/70 border-violet-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'seniorities' ? 'bg-violet-500 text-white shadow-xs' : 'bg-violet-50 text-violet-600'}`}>
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Seniority Levels</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Junior → Principal</div>
                </div>
              </div>
              <Badge variant="info" className="text-[10px] px-1.5 py-0">{seniorityLevels.filter(s => s.active).length}</Badge>
            </button>
          </div>

          <div className="border-t border-slate-200/80 pt-4 space-y-1.5">
            <span className="text-[11px] font-mono font-extrabold uppercase tracking-wider text-slate-400 px-3 block mb-2">
              Commercials & Budgeting
            </span>

            <button
              onClick={() => handleTabChange('pricing')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'pricing'
                  ? 'bg-purple-50/70 border-purple-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'pricing' ? 'bg-purple-600 text-white shadow-xs' : 'bg-purple-50 text-purple-600'}`}>
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Contract Rate Sheet</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Modular contract pricing</div>
                </div>
              </div>
              <Badge variant="info" className="text-[10px] px-1.5 py-0">{catalogItems.length}</Badge>
            </button>

            <button
              onClick={() => handleTabChange('timesheets')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'timesheets'
                  ? 'bg-sky-50/70 border-sky-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'timesheets' ? 'bg-sky-500 text-white shadow-xs' : 'bg-sky-50 text-sky-600'}`}>
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Timesheets</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Roles, seniorities & rate cards</div>
                </div>
              </div>
              <Badge variant="info" className="text-[10px] px-1.5 py-0">{rateCards.length}</Badge>
            </button>

            <button
              onClick={() => handleTabChange('invoices')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'invoices'
                  ? 'bg-emerald-50/70 border-emerald-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'invoices' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-emerald-50 text-emerald-600'}`}>
                  <Receipt className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Invoice Categories</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Operating budget tags</div>
                </div>
              </div>
              <Badge variant="success" className="text-[10px] px-1.5 py-0">{invoiceCategories?.length || 0}</Badge>
            </button>
          </div>

          <div className="border-t border-slate-200/80 pt-4 space-y-1.5">
            <span className="text-[11px] font-mono font-extrabold uppercase tracking-wider text-slate-400 px-3 block mb-2">
              Integrations & System
            </span>

            <button
              onClick={() => handleTabChange('tiering')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'tiering'
                  ? 'bg-indigo-50/70 border-indigo-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'tiering' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-indigo-50 text-indigo-600'}`}>
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Counterparty Tiering</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Configurable scoring model & simulation</div>
                </div>
              </div>
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-100 text-indigo-700 font-black uppercase">Model</span>
            </button>

            <button
              onClick={() => handleTabChange('integrations')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'integrations'
                  ? 'bg-indigo-50/70 border-indigo-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'integrations' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-indigo-50 text-indigo-600'}`}>
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Integrations</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Slack, Attio, myDATA & mirroring</div>
                </div>
              </div>
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-100 text-indigo-700 font-black uppercase">Sync</span>
            </button>

            <button
              onClick={() => handleTabChange('documents')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'documents'
                  ? 'bg-emerald-50/70 border-emerald-200/80 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'documents' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-emerald-50 text-emerald-600'}`}>
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Payroll Document Types</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">Categories for uploaded payslips & receipts</div>
                </div>
              </div>
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-100 text-emerald-700 font-black uppercase">{documentTypes?.length || 0}</span>
            </button>

            <button
              onClick={() => handleTabChange('general')}
              className={`w-full flex items-center justify-between p-3 rounded-2xl transition-all border text-left cursor-pointer ${
                selectedTab === 'general'
                  ? 'bg-slate-100/80 border-slate-300 shadow-xs text-slate-900 font-extrabold'
                  : 'bg-transparent border-transparent hover:bg-slate-50/80 text-slate-500 hover:text-slate-800 font-semibold'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedTab === 'general' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs leading-tight">Corporate Profile</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">HQ address & entity VAT</div>
                </div>
              </div>
              <span className="px-1.5 py-0.5 text-[9px] rounded bg-slate-100 text-slate-500 uppercase font-bold">Soon</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
