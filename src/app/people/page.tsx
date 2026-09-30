"use client";

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Profile, EmploymentType } from '@/lib/types';
import { resolveCurrentRole } from '@/lib/profile-role';
import { formatDate } from '@/lib/date';
import { Button, Badge, Modal } from '@/components/ui/primitives';
import { EmployeeRoleAssigner } from '@/components/people/employee-role-assigner';
import { EmployeeLeaveEntitlement } from '@/components/people/employee-leave-entitlement';
import { EmployeeRemoteQuota } from '@/components/people/employee-remote-quota';
import {
  Users, Search, Download, Plus, Edit2, Check, Trash2, MessageSquare
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

const PeopleGrid = dynamic(() => import('@/components/people/people-grid').then(m => m.PeopleGrid), { ssr: false });

export default function PeopleDirectoryPage() {
  const { currentUser, profiles, teams, addProfile, updateProfile, deleteProfile, employeeIntegrations,
    employeeContracts, addEmployeeContract, updateEmployeeContract,
    jobRoles, seniorityLevels, profileRoleHistory } = useAuth();
  const params = useParams();
  const urlId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'schedule' | 'edit'>('overview');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  
  // Sync initial selection from URL ID
  useEffect(() => {
    if (urlId && profiles.length > 0 && !selectedProfile) {
      const target = profiles.find(p => p.id === urlId || p.work_email?.toLowerCase() === urlId.toLowerCase());
      if (target) {
        setSelectedProfile(target);
      }
    }
  }, [urlId, profiles]);

  // Sync address bar when profile is selected or closed
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedProfile) {
      window.history.pushState(null, '', `/people/${selectedProfile.id}`);
    } else if (window.location.pathname.startsWith('/people/')) {
      window.history.pushState(null, '', '/people');
    }
  }, [selectedProfile]);

  // Admin Add Person & Edit Person state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isCreatingPerson, setIsCreatingPerson] = useState(false);
  const [editData, setEditData] = useState<any>(null);

  // Employment contract editor state. Pay (rates, extras, bonuses) is NOT part of the dossier
  // any more — it all lives in the Effective-Dated Salary Ledger on Compensation & Payroll.
  const [editingContract, setEditingContract] = useState(false);
  const [contractForm, setContractForm] = useState({
    contract_type: 'indefinite' as 'indefinite' | 'fixed_term' | 'contractor',
    title: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: null as string | null,
    auto_renew: false,
    notice_days: 30,
    status: 'active' as 'active' | 'expired' | 'terminated',
    notes: '',
  });

  // New Person Form Fields
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newGreekName, setNewGreekName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newTeamId, setNewTeamId] = useState(teams[0]?.id || 'tm-ops');
  const [newEmploymentType, setNewEmploymentType] = useState<EmploymentType>('full_time');
  const [newStartDate, setNewStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [newStatus, setNewStatus] = useState<'active' | 'departed'>('active');
  const [newEndDate, setNewEndDate] = useState('');
  const [newRole, setNewRole] = useState<'employee' | 'admin'>('employee');
  const [newAfm, setNewAfm] = useState('');
  const [newAmka, setNewAmka] = useState('');
  const [newIban, setNewIban] = useState('');
  const [newBankName, setNewBankName] = useState('');
  const [newBankSwift, setNewBankSwift] = useState('');
  const [newAddress, setNewAddress] = useState('');

  const activeContract = employeeContracts.find(c => c.profile_id === selectedProfile?.id) || null;

  // Admin toggle: is this employee required to connect Slack?
  const [savingSlackRequired, setSavingSlackRequired] = useState(false);
  const [slackRequiredOverrides, setSlackRequiredOverrides] = useState<Record<string, boolean>>({});
  const isSlackRequired = (p: Profile) => slackRequiredOverrides[p.id] ?? !!p.slack_required;
  const toggleSlackRequired = async (profileId: string, required: boolean) => {
    setSavingSlackRequired(true);
    try {
      const res = await fetch('/api/integrations/slack-required', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, required }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setSelectedProfile(prev => prev && prev.id === profileId ? { ...prev, slack_required: required } : prev);
      // Remember it locally too: auth-context's `profiles` still holds the old flag, so
      // without this, reopening the dossier would show the stale value.
      setSlackRequiredOverrides(prev => ({ ...prev, [profileId]: required }));
    } catch (e) {
      console.error('toggleSlackRequired error:', e);
      alert(`Failed to update the Slack requirement: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingSlackRequired(false);
    }
  };

  const openContractEditor = () => {
    if (activeContract) {
      setContractForm({
        contract_type: activeContract.contract_type,
        title: activeContract.title || '',
        start_date: activeContract.start_date,
        end_date: activeContract.end_date || null,
        auto_renew: activeContract.auto_renew,
        notice_days: activeContract.notice_days,
        status: activeContract.status,
        notes: activeContract.notes || '',
      });
    }
    setEditingContract(true);
  };

  const handleCreatePerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingPerson) return; // guard a second submit / double Enter while the insert is in flight
    if (newStatus === 'departed' && newEndDate && newEndDate < newStartDate) {
      alert('End date cannot be before start date.');
      return;
    }
    const newProf: Profile = {
      id: '', // Will generate UUID in auth-context
      first_name: newFirstName,
      last_name: newLastName,
      name_el: newGreekName || `${newFirstName} ${newLastName}`,
      work_email: newEmail,
      phone: newPhone.trim() || undefined,
      team_id: newTeamId,
      employment_type: newEmploymentType,
      start_date: newStartDate,
      status: newStatus,
      end_date: newStatus === 'departed' ? (newEndDate || undefined) : undefined,
      work_schedule: newEmploymentType === 'part_time' ? ['Mon', 'Wed', 'Fri'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      role: newRole,
      sensitive: {
        profile_id: '',
        afm: newAfm || 'Not specified',
        amka: newAmka || 'Not specified',
        ama_efka: 'Not specified',
        iban: newIban.trim(),
        bank_name: newBankName.trim() || null,
        bank_swift: newBankSwift.trim().toUpperCase() || null,
        address: newAddress || 'Athens, Greece',
        birth_date: '1990-01-01'
      },
      team: teams.find(t => t.id === newTeamId)
    };

    setIsCreatingPerson(true);
    const created = await addProfile(newProf);
    setIsCreatingPerson(false);
    if (!created) return; // keep the dialog (and everything typed) so it can be retried
    setIsAddOpen(false);
    // Reset fields
    setNewFirstName(''); setNewLastName(''); setNewGreekName(''); setNewEmail(''); setNewPhone('');
setNewAfm(''); setNewAmka(''); setNewIban(''); setNewAddress(''); setNewBankName(''); setNewBankSwift('');
    setNewStartDate(new Date().toISOString().split('T')[0]); setNewStatus('active'); setNewEndDate('');
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editData) return;
    // slack_required is owned by the Slack toggle (and its audited endpoint), not this
    // form — editData may hold a stale copy that would silently revert the admin's change.
    const { slack_required, ...editable } = editData as Profile;
    if (editable.status === 'departed' && editable.end_date && editable.start_date && editable.end_date < editable.start_date) {
      alert('End date cannot be before start date.');
      return;
    }
    const merged = { ...editable, slack_required: isSlackRequired(editData as Profile) } as Profile;
    updateProfile(editable as Profile);
    setSelectedProfile(merged);
    setActiveTab('overview');
  };

  const handleDeleteProfile = async (target: Profile) => {
    if (target.id === currentUser.id) {
      alert('You cannot delete your own profile.');
      return;
    }
    if (target.role === 'admin' && profiles.filter(p => p.role === 'admin').length <= 1) {
      alert('Refusing to delete the last admin of the organization. Promote another user to admin first.');
      return;
    }
    if (!confirm(`PERMANENTLY DELETE "${target.first_name} ${target.last_name}" from Orbit?\n\nThis will erase their profile, leave requests, salary history, payments, remote days, entitlements and all linked records. This action CANNOT be undone.`)) return;
    const ok = await deleteProfile(target.id);
    if (ok) {
      setSelectedProfile(null);
      setActiveTab('overview');
      setEditData(null);
    }
  };

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [employmentFilter, setEmploymentFilter] = useState<string>('all');

  const isAdmin = currentUser.role === 'admin';

  const filteredProfiles = profiles.filter(p => {
    // Phone is admin-only PII, so it is not even a search key for a non-admin session.
    const haystack = [p.first_name, p.last_name, p.name_el, p.work_email, ...(isAdmin ? [p.phone || ''] : [])].join(' ');
    const matchesSearch = haystack.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTeam = teamFilter === 'all' || p.team_id === teamFilter;
    const matchesEmployment = employmentFilter === 'all' || p.employment_type === employmentFilter;
    return matchesSearch && matchesTeam && matchesEmployment;
  });

  const getTeamName = (teamId: string) => teams.find(t => t.id === teamId)?.name || 'General';

  // Export handling: GUARANTEE explicit exclusion of profile_sensitive data!
  // Phone is admin-only, so it only appears in an admin's export.
  const exportToXlsx = () => {
    const cleanData = filteredProfiles.map(p => ({
      ID: p.id,
      FirstName: p.first_name,
      LastName: p.last_name,
      GreekName: p.name_el,
      Email: p.work_email,
      ...(isAdmin ? { Phone: p.phone || '' } : {}),
      Team: getTeamName(p.team_id),
      EmploymentType: p.employment_type.toUpperCase(),
      StartDate: p.start_date,
      EndDate: p.end_date || '',
      Status: p.status.toUpperCase()
    }));
    const worksheet = XLSX.utils.json_to_sheet(cleanData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "StellarBlue Directory");
    XLSX.writeFile(workbook, `StellarBlue_People_Directory_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportToCsv = () => {
    const cleanData = filteredProfiles.map(p => ({
      FirstName: p.first_name,
      LastName: p.last_name,
      GreekName: p.name_el,
      Email: p.work_email,
      ...(isAdmin ? { Phone: p.phone || '' } : {}),
      Team: getTeamName(p.team_id),
      EmploymentType: p.employment_type.toUpperCase(),
      StartDate: p.start_date,
      EndDate: p.end_date || '',
      Status: p.status.toUpperCase()
    }));
    const csv = Papa.unparse(cleanData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `StellarBlue_Directory_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
            <Users className="w-6 h-6 mr-3 text-[#3D87D3]" /> StellarBlue Team Directory
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Core people database. All downstream modules join to this registry. Total: <strong className="text-slate-700">{filteredProfiles.length} active members</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 border border-slate-200 p-0.5">
            <button 
              onClick={() => setViewMode('table')} 
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'table' ? 'bg-[#3D87D3] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Dense Table
            </button>
            <button 
              onClick={() => setViewMode('grid')} 
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'grid' ? 'bg-[#3D87D3] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Grid
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={exportToXlsx} title="Export Directory to Excel (Excludes PII)">
            <Download className="w-3.5 h-3.5 mr-1.5 text-emerald-600" /> Export XLSX
          </Button>
          <Button variant="outline" size="sm" onClick={exportToCsv} title="Export to CSV">
            CSV
          </Button>
          {isAdmin && (
            <Button variant="primary" size="sm" onClick={() => setIsAddOpen(true)} className="ml-2">
              <Plus className="w-4 h-4 mr-1.5" /> Add Person
            </Button>
          )}
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder={isAdmin ? 'Search by name (Greek/English), email or phone...' : 'Search by name (Greek/English) or email...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#3D87D3] placeholder:text-slate-400"
          />
        </div>
        <div>
          <select
            value={teamFilter}
            onChange={e => setTeamFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3D87D3]"
          >
            <option value="all">All Teams</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <select
            value={employmentFilter}
            onChange={e => setEmploymentFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3D87D3]"
          >
            <option value="all">All Employment Types</option>
            <option value="full_time">Full-Time (μισθωτός / ΙΚΑ)</option>
            <option value="part_time">Part-Time</option>
            <option value="contractor">Contractor (μπλοκάκι)</option>
            <option value="intern">Intern / Affiliate</option>
          </select>
        </div>
      </div>

      {/* VIEWING AREA */}
      {viewMode === 'table' ? (
        <PeopleGrid
          profiles={filteredProfiles}
          teams={teams}
          integrations={employeeIntegrations}
          profileRoleHistory={profileRoleHistory}
          jobRoles={jobRoles}
          seniorityLevels={seniorityLevels}
          isAdmin={isAdmin}
          onSelect={(p) => { setSelectedProfile(p); setActiveTab('overview'); }}
        />
      ) : (
        /* Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredProfiles.map(p => (
            <div 
              key={p.id}
              onClick={() => { setSelectedProfile(p); setActiveTab('overview'); }}
              className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <Badge variant="neutral" className="text-[10px]">{getTeamName(p.team_id)}</Badge>
                  <Badge variant={p.employment_type === 'contractor' ? 'warning' : 'success'} className="text-[10px]">
                    {p.employment_type.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center space-x-3.5">
                  <div className="w-12 h-12 rounded-full bg-slate-800 text-white font-extrabold text-base flex items-center justify-center shadow-xs">
                    {p.first_name[0]}{p.last_name[0]}
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-slate-800 group-hover:text-[#3D87D3] transition-colors">{p.first_name} {p.last_name}</h3>
                    <p className="text-xs text-slate-500">{p.name_el}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {(() => {
                    const cur = resolveCurrentRole(profileRoleHistory, p.id, jobRoles, seniorityLevels);
                    return cur ? <>{cur.role} · <span className="text-slate-400">{cur.seniority}</span></> : <span className="text-slate-400 italic">No role/seniority assigned</span>;
                  })()}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Start: {formatDate(p.start_date)}</span>
                <span className="text-[#3D87D3] font-medium group-hover:underline">View details &rarr;</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PROFILE DETAIL & ADMIN EDIT MODAL */}
      <Modal 
        isOpen={!!selectedProfile} 
        onClose={() => setSelectedProfile(null)} 
        title={selectedProfile ? `${selectedProfile.first_name} ${selectedProfile.last_name} — Profile Dossier` : 'Profile'}
      >
        {selectedProfile && (
          <div className="space-y-6">
            {/* Modal Tabs */}
            <div className="flex border-b border-slate-200 -mx-6 px-6 space-x-6 text-sm">
              <button 
                onClick={() => setActiveTab('overview')} 
                className={`pb-3 font-semibold transition-colors cursor-pointer ${activeTab === 'overview' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Directory Info
              </button>
              <button 
                onClick={() => setActiveTab('schedule')} 
                className={`pb-3 font-semibold transition-colors cursor-pointer ${activeTab === 'schedule' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Work Schedule
              </button>
              {isAdmin && (
                <button 
                  onClick={() => {
                    setActiveTab('edit');
                    setEditData(JSON.parse(JSON.stringify(selectedProfile)));
                  }} 
                  className={`pb-3 font-semibold flex items-center transition-colors cursor-pointer ${activeTab === 'edit' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  <Edit2 className="w-3.5 h-3.5 mr-1 text-[#3D87D3]" /> Edit Profile
                </button>
              )}
            </div>

            {/* TAB 1: OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Full Name (EN)</span>
                      <span className="text-slate-800 font-medium text-sm">{selectedProfile.first_name} {selectedProfile.last_name}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Full Name (EL)</span>
                      <span className="text-slate-800 font-medium text-sm">{selectedProfile.name_el}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Work Email</span>
                      <span className="text-[#3D87D3] font-mono">{selectedProfile.work_email}</span>
                    </div>
                    {/* Phone is admin-only PII in the directory. */}
                    {isAdmin && (
                      <div>
                        <span className="text-slate-500 uppercase font-semibold block">Phone</span>
                        <span className="text-slate-700 font-mono">{selectedProfile.phone || '—'}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Employment Type</span>
                      <Badge variant="info" className="mt-0.5">{selectedProfile.employment_type.toUpperCase()}</Badge>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Role &amp; Seniority</span>
                      {(() => {
                        const cur = resolveCurrentRole(profileRoleHistory, selectedProfile.id, jobRoles, seniorityLevels);
                        return cur
                          ? <Badge variant="info" className="mt-0.5">{cur.role} · {cur.seniority}</Badge>
                          : <Badge variant="neutral" className="mt-0.5">Unassigned</Badge>;
                      })()}
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Assigned Team</span>
                      <span className="text-slate-700 font-medium">{getTeamName(selectedProfile.team_id)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Start Date</span>
                      <span className="text-slate-700 font-medium">{formatDate(selectedProfile.start_date)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Employment Status</span>
                      <Badge variant={selectedProfile.status === 'active' ? 'success' : selectedProfile.status === 'on_leave' ? 'warning' : 'error'} className="mt-0.5">
                        {selectedProfile.status === 'on_leave' ? 'ON LEAVE' : selectedProfile.status.toUpperCase()}
                      </Badge>
                    </div>
                    {selectedProfile.end_date && (
                      <div>
                        <span className="text-slate-500 uppercase font-semibold block">End Date</span>
                        <span className="text-slate-700 font-medium">{formatDate(selectedProfile.end_date)}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Role Permission</span>
                      <Badge variant={selectedProfile.role === 'admin' ? 'warning' : 'neutral'} className="mt-0.5">
                        {selectedProfile.role === 'admin' ? 'ADMIN' : 'EMPLOYEE'}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Slack requirement — admin controls whether this employee must connect */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#3D87D3]/10 border border-[#3D87D3]/20 flex items-center justify-center shrink-0">
                      <MessageSquare className="w-4.5 h-4.5 text-[#3D87D3]" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-800">Slack Connection Requirement</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {(() => {
                          const integ = employeeIntegrations.find(i => i.profile_id === selectedProfile.id && i.provider === 'slack');
                          const connStatus = !integ ? 'not connected' : integ.status === 'revoked' ? 'revoked' : integ.status === 'connected' ? 'connected' : integ.status;
                          return isSlackRequired(selectedProfile)
                            ? `Required — currently ${connStatus}.`
                            : `Optional — not required to connect. Slack is currently ${connStatus}.`;
                        })()}
                      </div>
                    </div>
                  </div>
                  {isAdmin ? (
                    <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={isSlackRequired(selectedProfile)}
                        disabled={savingSlackRequired}
                        onChange={e => toggleSlackRequired(selectedProfile.id, e.target.checked)}
                        className="w-4 h-4 text-[#3D87D3] rounded cursor-pointer"
                      />
                      {isSlackRequired(selectedProfile) ? 'Required' : 'Optional'}
                    </label>
                  ) : (
                    <Badge variant={isSlackRequired(selectedProfile) ? 'warning' : 'neutral'} className="shrink-0">
                      {isSlackRequired(selectedProfile) ? 'REQUIRED' : 'OPTIONAL'}
                    </Badge>
                  )}
                </div>

                {/* Employment contract — terms of engagement only. Salary, extras and bonuses are
                    managed in the Effective-Dated Salary Ledger on Compensation & Payroll. */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <h4 className="font-extrabold text-slate-900 text-sm">Employment Contract</h4>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => editingContract ? setEditingContract(false) : openContractEditor()}
                        className="text-[11px] font-bold text-[#3D87D3] hover:underline cursor-pointer"
                      >
                        {editingContract ? 'Cancel' : activeContract ? 'Edit Contract' : '+ Define Contract'}
                      </button>
                    )}
                  </div>

                  {editingContract ? (
                    <div className="grid grid-cols-2 gap-3 p-3 bg-white border border-slate-200 rounded-lg">
                      <div>
                        <label className="text-slate-500 font-semibold block mb-1">Contract Type</label>
                        <select
                          value={contractForm.contract_type}
                          onChange={e => setContractForm({ ...contractForm, contract_type: e.target.value as any })}
                          className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium"
                        >
                          <option value="indefinite">Indefinite (Permanent)</option>
                          <option value="fixed_term">Fixed Term</option>
                          <option value="contractor">Contractor Agreement</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-slate-500 font-semibold block mb-1">Job Title on Contract</label>
                        <input type="text" value={contractForm.title || ''} onChange={e => setContractForm({ ...contractForm, title: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium" />
                      </div>
                      <div>
                        <label className="text-slate-500 font-semibold block mb-1">Start Date</label>
                        <input type="date" value={contractForm.start_date} onChange={e => setContractForm({ ...contractForm, start_date: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                      </div>
                      <div>
                        <label className="text-slate-500 font-semibold block mb-1">End Date (fixed term)</label>
                        <input type="date" value={contractForm.end_date || ''} onChange={e => setContractForm({ ...contractForm, end_date: e.target.value || null })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={contractForm.auto_renew} onChange={e => setContractForm({ ...contractForm, auto_renew: e.target.checked })} className="w-4 h-4 text-[#3D87D3] rounded cursor-pointer" />
                          <span className="font-semibold text-slate-600">Auto-renew</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={contractForm.status === 'active'} onChange={e => setContractForm({ ...contractForm, status: e.target.checked ? 'active' : 'terminated' })} className="w-4 h-4 text-[#3D87D3] rounded cursor-pointer" />
                          <span className="font-semibold text-slate-600">Active</span>
                        </label>
                      </div>
                      <div>
                        <label className="text-slate-500 font-semibold block mb-1">Notice Period (days)</label>
                        <input type="number" value={contractForm.notice_days} onChange={e => setContractForm({ ...contractForm, notice_days: Number(e.target.value) })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                      </div>
                      <div className="col-span-2">
                        <label className="text-slate-500 font-semibold block mb-1">Notes</label>
                        <input type="text" value={contractForm.notes || ''} onChange={e => setContractForm({ ...contractForm, notes: e.target.value })} placeholder="e.g. Includes non-compete clause" className="w-full p-2 border rounded-md bg-white text-slate-800" />
                      </div>
                      <div className="col-span-2 flex justify-end gap-2 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          className="bg-[#3D87D3] text-white cursor-pointer"
                          onClick={async () => {
                            if (!contractForm.start_date) { alert('Start date is required.'); return; }
                            const ok = activeContract
                              ? await updateEmployeeContract(activeContract.id, contractForm)
                              : await addEmployeeContract({ ...contractForm, profile_id: selectedProfile.id });
                            if (ok) setEditingContract(false);
                          }}
                        >
                          <Check className="w-3.5 h-3.5 mr-1.5" /> {activeContract ? 'Save Contract Changes' : 'Create Contract'}
                        </Button>
                      </div>
                    </div>
                  ) : activeContract ? (
                    <div className="p-3 rounded-lg bg-white border border-slate-200 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-slate-800">
                          {activeContract.contract_type === 'indefinite' ? 'Indefinite' : activeContract.contract_type === 'fixed_term' ? 'Fixed Term' : 'Contractor Agreement'}
                          {activeContract.title ? ` — ${activeContract.title}` : ''}
                        </span>
                        <Badge variant={activeContract.status === 'active' ? 'success' : 'warning'}>{activeContract.status.toUpperCase()}</Badge>
                      </div>
                      <div className="text-slate-600 mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                        <span><strong className="text-slate-800">From:</strong> {formatDate(activeContract.start_date)}</span>
                        <span><strong className="text-slate-800">To:</strong> {activeContract.end_date ? formatDate(activeContract.end_date) : 'Open-ended'}</span>
                        <span><strong className="text-slate-800">Auto-renew:</strong> {activeContract.auto_renew ? 'Yes' : 'No'}</span>
                        <span><strong className="text-slate-800">Notice:</strong> {activeContract.notice_days} days</span>
                      </div>
                      {activeContract.notes && <div className="text-slate-500 mt-1.5 italic">{activeContract.notes}</div>}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg bg-white">
                      No contract defined for this employee yet.{isAdmin ? ' Define one to keep payroll and terms documented.' : ''}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: SCHEDULE */}
            {activeTab === 'schedule' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-3">
                  <p className="font-semibold text-sm text-slate-800">Weekly Working Schedule (Drives all leave deduction & mandatory font-out math)</p>
                  <p className="text-slate-600">Current active working days: <strong className="text-[#3D87D3] font-mono">{selectedProfile.work_schedule.join(', ')}</strong></p>
                  {selectedProfile.employment_type === 'part_time' && (
                    <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                      Part-Time rules enforced: Public holiday deductions and mandatory closures only dock hours on these scheduled days.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 5: EDIT PROFILE (ADMIN ONLY) */}
            {activeTab === 'edit' && isAdmin && editData && (
              <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">First Name (EN)</label>
                    <input type="text" value={editData.first_name || ''} onChange={e => setEditData({...editData, first_name: e.target.value})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium" required />
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">Last Name (EN)</label>
                    <input type="text" value={editData.last_name || ''} onChange={e => setEditData({...editData, last_name: e.target.value})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium" required />
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">Full Name (EL - Greek)</label>
                    <input type="text" value={editData.name_el || ''} onChange={e => setEditData({...editData, name_el: e.target.value})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium" required />
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">Work Email</label>
                    <input type="email" value={editData.work_email || ''} onChange={e => setEditData({...editData, work_email: e.target.value})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium" required />
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">Phone Number</label>
                    <input type="tel" value={editData.phone || ''} onChange={e => setEditData({...editData, phone: e.target.value})} placeholder="+30 ..." className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium" />
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">Assigned Team</label>
                    <select value={editData.team_id || ''} onChange={e => setEditData({...editData, team_id: e.target.value, team: teams.find(t => t.id === e.target.value)})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium">
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">Employment Type</label>
                    <select value={editData.employment_type || 'full_time'} onChange={e => setEditData({...editData, employment_type: e.target.value})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium">
                      <option value="full_time">Full Time</option>
                      <option value="part_time">Part Time</option>
                      <option value="contractor">Contractor</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">Role Permission</label>
                    <select value={editData.role || 'employee'} onChange={e => setEditData({...editData, role: e.target.value})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium">
                      <option value="employee">Employee</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">Start Date</label>
                    <input type="date" value={editData.start_date || ''} onChange={e => setEditData({...editData, start_date: e.target.value})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" required />
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">Employment Status</label>
                    <select value={editData.status || 'active'} onChange={e => { const s = e.target.value as Profile['status']; setEditData({ ...editData, status: s, ...(s !== 'departed' ? { end_date: undefined } : {}) }); }} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium">
                      <option value="active">Active</option>
                      <option value="departed">Departed (former employee)</option>
                    </select>
                  </div>
                  {editData.status === 'departed' && (
                    <div className="col-span-2">
                      <label className="text-slate-600 font-semibold block mb-1">End Date (last working day)</label>
                      <input type="date" value={editData.end_date || ''} onChange={e => setEditData({...editData, end_date: e.target.value || undefined})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                    </div>
                  )}
                  <div className="col-span-2 pt-2 border-t border-slate-200">
                    <span className="text-slate-700 font-bold block mb-2">Sensitive Personal Information (PII)</span>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-slate-500 block mb-1">ΑΦΜ (Tax ID)</label>
                        <input type="text" value={editData.sensitive?.afm || ''} onChange={e => setEditData({...editData, sensitive: {...(editData.sensitive || {}), afm: e.target.value}})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                      </div>
                      <div>
                        <label className="text-slate-500 block mb-1">ΑΜΚΑ (Social Security)</label>
                        <input type="text" value={editData.sensitive?.amka || ''} onChange={e => setEditData({...editData, sensitive: {...(editData.sensitive || {}), amka: e.target.value}})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                      </div>
                      <div className="col-span-2">
                        <label className="text-slate-500 block mb-1">Bank Account IBAN</label>
                        <input type="text" value={editData.sensitive?.iban || ''} onChange={e => setEditData({...editData, sensitive: {...(editData.sensitive || {}), iban: e.target.value}})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                      </div>
                      <div>
                        <label className="text-slate-500 block mb-1">Bank</label>
                        <input type="text" placeholder="e.g. Eurobank Ergasias" value={editData.sensitive?.bank_name || ''} onChange={e => setEditData({...editData, sensitive: {...(editData.sensitive || {}), bank_name: e.target.value}})} className="w-full p-2 border rounded-md bg-white text-slate-800" />
                      </div>
                      <div>
                        <label className="text-slate-500 block mb-1">SWIFT / BIC</label>
                        <input type="text" placeholder="e.g. ERBKGRAA" value={editData.sensitive?.bank_swift || ''} onChange={e => setEditData({...editData, sensitive: {...(editData.sensitive || {}), bank_swift: e.target.value.toUpperCase()}})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                      </div>
                      <div className="col-span-2">
                        <label className="text-slate-500 block mb-1">Residential Address</label>
                        <input type="text" value={editData.sensitive?.address || ''} onChange={e => setEditData({...editData, sensitive: {...(editData.sensitive || {}), address: e.target.value}})} className="w-full p-2 border rounded-md bg-white text-slate-800" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <span className="text-slate-700 font-bold block text-xs">Timesheet Role & Seniority (effective-dated)</span>
                  <p className="text-[10px] text-slate-400 leading-snug">Applied with the Assign button below (effective from the chosen date) — not part of Save Profile Changes.</p>
                  <EmployeeRoleAssigner profileId={selectedProfile.id} />
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <span className="text-slate-700 font-bold block text-xs">Remote Work Quota (per employee — falls back to company default)</span>
                  <EmployeeRemoteQuota profileId={selectedProfile.id} />
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <span className="text-slate-700 font-bold block text-xs">Annual Leave Entitlement (per year)</span>
                  <EmployeeLeaveEntitlement profileId={selectedProfile.id} />
                </div>
                <div className="flex items-center justify-between pt-2">
                  {selectedProfile.id !== currentUser.id ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteProfile(selectedProfile)}
                      className="border-rose-300 text-rose-600 hover:bg-rose-50 hover:border-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4 mr-1.5" /> Delete Person
                    </Button>
                  ) : (
                    <span />
                  )}
                  <div className="flex space-x-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setActiveTab('overview')}>Cancel</Button>
                    <Button type="submit" variant="primary" size="sm"><Check className="w-4 h-4 mr-1.5" /> Save Profile Changes</Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}
      </Modal>

      {/* ADD PERSON MODAL (ADMIN ONLY) */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Onboard New Person (Admin)">
        <form onSubmit={handleCreatePerson} className="space-y-4 text-xs">
          <div className="p-3 bg-[#3D87D3]/10 text-[#3D87D3] rounded-lg font-medium text-sm flex items-center justify-between">
            <span>Creating new directory profile with database sync.</span>
            <Badge variant="info">Admin Priviledge</Badge>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 gap-4">
            <div>
              <label className="text-slate-600 font-semibold block mb-1">First Name (EN) *</label>
              <input type="text" placeholder="e.g. Maria" value={newFirstName} onChange={e => setNewFirstName(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800" required />
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Last Name (EN) *</label>
              <input type="text" placeholder="e.g. Papadopoulou" value={newLastName} onChange={e => setNewLastName(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800" required />
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Full Name (EL - Greek) *</label>
              <input type="text" placeholder="e.g. Μαρία Παπαδοπούλου" value={newGreekName} onChange={e => setNewGreekName(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800" required />
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Work Email *</label>
              {/* autoComplete off: a password manager happily fills the ADMIN's own address here,
                  which then collides with their existing profile and looks like a duplicate bug. */}
              <input type="email" autoComplete="off" placeholder="e.g. mpapadopoulou@stellarblue.eu" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800" required />
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Phone Number</label>
              <input type="tel" placeholder="e.g. +30 2310 ..." value={newPhone} onChange={e => setNewPhone(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800" />
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Assigned Team *</label>
              <select value={newTeamId} onChange={e => setNewTeamId(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800">
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Employment Type *</label>
              <select value={newEmploymentType} onChange={e => setNewEmploymentType(e.target.value as EmploymentType)} className="w-full p-2 border rounded-md bg-white text-slate-800">
                <option value="full_time">Full Time</option>
                <option value="part_time">Part Time</option>
                <option value="contractor">Contractor</option>
              </select>
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Role Permission *</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value as any)} className="w-full p-2 border rounded-md bg-white text-slate-800">
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Start Date *</label>
              <input type="date" value={newStartDate} onChange={e => setNewStartDate(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" required />
              <p className="text-[10px] text-slate-400 mt-1">Backdate to register existing / past employees.</p>
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Employment Status</label>
              <select value={newStatus} onChange={e => { const s = e.target.value as 'active' | 'departed'; setNewStatus(s); if (s !== 'departed') setNewEndDate(''); }} className="w-full p-2 border rounded-md bg-white text-slate-800">
                <option value="active">Active</option>
                <option value="departed">Departed (former employee)</option>
              </select>
            </div>
            {newStatus === 'departed' && (
              <div className="col-span-2">
                <label className="text-slate-600 font-semibold block mb-1">End Date (last working day)</label>
                <input type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
              </div>
            )}
            <div className="col-span-2 pt-2 border-t border-slate-200">
              <span className="text-slate-700 font-bold block mb-2">Sensitive Personal Information (PII)</span>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-500 block mb-1">ΑΦΜ (Tax ID)</label>
                  <input type="text" placeholder="9 digits" value={newAfm} onChange={e => setNewAfm(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                </div>
                <div>
                  <label className="text-slate-500 block mb-1">ΑΜΚΑ (Social Security)</label>
                  <input type="text" placeholder="11 digits" value={newAmka} onChange={e => setNewAmka(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                </div>
                <div className="col-span-2">
                  <label className="text-slate-500 block mb-1">Bank Account IBAN</label>
                  <input type="text" placeholder="GR..." value={newIban} onChange={e => setNewIban(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                </div>
                <div>
                  <label className="text-slate-500 block mb-1">Bank</label>
                  <input type="text" placeholder="e.g. Eurobank Ergasias" value={newBankName} onChange={e => setNewBankName(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800" />
                </div>
                <div>
                  <label className="text-slate-500 block mb-1">SWIFT / BIC</label>
                  <input type="text" placeholder="e.g. ERBKGRAA" value={newBankSwift} onChange={e => setNewBankSwift(e.target.value.toUpperCase())} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                </div>
                <div className="col-span-2">
                  <label className="text-slate-500 block mb-1">Residential Address</label>
                  <input type="text" placeholder="Street, City, Postal Code" value={newAddress} onChange={e => setNewAddress(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={isCreatingPerson}>
              <Plus className="w-4 h-4 mr-1.5" /> {isCreatingPerson ? 'Creating…' : 'Create Person'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
