"use client";

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Profile, EmploymentType } from '@/lib/types';
import { Card, Button, Badge, Modal } from '@/components/ui/primitives';
import { EmployeeRoleAssigner } from '@/components/people/employee-role-assigner';
import { EmployeeRemoteQuota } from '@/components/people/employee-remote-quota';
import { 
  Users, Search, Filter, Download, Lock, ShieldAlert, 
  Mail, Calendar, Briefcase, Plus, Edit2, Check, Trash2 
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

const PeopleGrid = dynamic(() => import('@/components/people/people-grid').then(m => m.PeopleGrid), { ssr: false });

export default function PeopleDirectoryPage() {
  const { currentUser, profiles, teams, salaries, entitlements, addProfile, updateProfile, deleteProfile, employeeIntegrations,
    employeeContracts, addEmployeeContract, updateEmployeeContract, salaryBonuses, addSalaryBonus, updateSalaryBonus, deleteSalaryBonus,
    jobRoles, seniorityLevels, profileRoleHistory } = useAuth();
  const params = useParams();
  const urlId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'schedule' | 'sensitive' | 'compensation' | 'edit'>('overview');
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
  const [editData, setEditData] = useState<any>(null);

  // Contract & bonus editor state
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
  const [bonusForm, setBonusForm] = useState({
    name: '', amount: 0, kind: 'recurring' as 'recurring' | 'one_time',
    frequency: 'monthly' as 'monthly' | 'quarterly' | 'annual',
    start_period: '', end_period: '', period: '',
  });

  // New Person Form Fields
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newGreekName, setNewGreekName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newTitle, setNewTitle] = useState('Team Member');
  const [newTeamId, setNewTeamId] = useState(teams[0]?.id || 'tm-ops');
  const [newEmploymentType, setNewEmploymentType] = useState<EmploymentType>('full_time');
  const [newSeniorityLevel, setNewSeniorityLevel] = useState<'junior' | 'mid' | 'senior'>('mid');
  const [newStartDate, setNewStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [newRole, setNewRole] = useState<'employee' | 'admin'>('employee');
  const [newAfm, setNewAfm] = useState('');
  const [newAmka, setNewAmka] = useState('');
  const [newIban, setNewIban] = useState('');
  const [newAddress, setNewAddress] = useState('');

  const activeContract = employeeContracts.find(c => c.profile_id === selectedProfile?.id) || null;

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

  const handleCreatePerson = (e: React.FormEvent) => {
    e.preventDefault();
    const newProf: Profile = {
      id: '', // Will generate UUID in auth-context
      first_name: newFirstName,
      last_name: newLastName,
      name_el: newGreekName || `${newFirstName} ${newLastName}`,
      work_email: newEmail,
      title: newTitle,
      team_id: newTeamId,
      employment_type: newEmploymentType,
      seniority_level: newSeniorityLevel,
      start_date: newStartDate,
      status: 'active',
      work_schedule: newEmploymentType === 'part_time' ? ['Mon', 'Wed', 'Fri'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      role: newRole,
      sensitive: {
        profile_id: '',
        afm: newAfm || 'Not specified',
        amka: newAmka || 'Not specified',
        ama_efka: 'Not specified',
        iban: newIban || 'GR0000000000000000000000000',
        address: newAddress || 'Athens, Greece',
        birth_date: '1990-01-01'
      },
      team: teams.find(t => t.id === newTeamId)
    };

    addProfile(newProf);
    setIsAddOpen(false);
    // Reset fields
    setNewFirstName(''); setNewLastName(''); setNewGreekName(''); setNewEmail('');
    setNewTitle('Team Member'); setNewAfm(''); setNewAmka(''); setNewIban(''); setNewAddress('');
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editData) return;
    updateProfile(editData);
    setSelectedProfile(editData);
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
    const matchesSearch = `${p.first_name} ${p.last_name} ${p.name_el} ${p.work_email} ${p.title}`.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTeam = teamFilter === 'all' || p.team_id === teamFilter;
    const matchesEmployment = employmentFilter === 'all' || p.employment_type === employmentFilter;
    return matchesSearch && matchesTeam && matchesEmployment;
  });

  const getTeamName = (teamId: string) => teams.find(t => t.id === teamId)?.name || 'General';

  // Export handling: GUARANTEE explicit exclusion of profile_sensitive data!
  const exportToXlsx = () => {
    const cleanData = filteredProfiles.map(p => ({
      ID: p.id,
      FirstName: p.first_name,
      LastName: p.last_name,
      GreekName: p.name_el,
      Email: p.work_email,
      Title: p.title,
      Team: getTeamName(p.team_id),
      EmploymentType: p.employment_type.toUpperCase(),
      StartDate: p.start_date,
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
      Title: p.title,
      Team: getTeamName(p.team_id),
      EmploymentType: p.employment_type.toUpperCase(),
      StartDate: p.start_date,
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
            placeholder="Search by name (Greek/English), title, or email..."
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
                <p className="text-sm font-medium text-slate-600 mt-4">{p.title}</p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Start: {p.start_date}</span>
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
              <button 
                onClick={() => setActiveTab('sensitive')} 
                className={`pb-3 font-semibold flex items-center transition-colors cursor-pointer ${activeTab === 'sensitive' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <Lock className="w-3.5 h-3.5 mr-1 text-amber-600" /> Sensitive PII (Admin)
              </button>
              <button 
                onClick={() => setActiveTab('compensation')} 
                className={`pb-3 font-semibold flex items-center transition-colors cursor-pointer ${activeTab === 'compensation' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3]' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <Lock className="w-3.5 h-3.5 mr-1 text-purple-600" /> Compensation (Admin)
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
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Employment Type</span>
                      <Badge variant="info" className="mt-0.5">{selectedProfile.employment_type.toUpperCase()}</Badge>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Seniority Level</span>
                      <Badge variant="neutral" className="mt-0.5 uppercase">{(selectedProfile.seniority_level || 'mid')}</Badge>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Role / Seniority</span>
                      {(() => {
                        const today = new Date().toISOString().slice(0, 10);
                        const row = profileRoleHistory.filter(h => h.profile_id === selectedProfile.id && h.valid_from <= today && (!h.valid_to || h.valid_to >= today)).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
                        if (!row) return <Badge variant="neutral" className="mt-0.5">Unassigned</Badge>;
                        const rn = jobRoles.find(r => r.id === row.job_role_id)?.name;
                        const sn = seniorityLevels.find(s => s.id === row.seniority_id)?.name;
                        return <Badge variant="info" className="mt-0.5">{rn || 'Role'} · {sn || 'Seniority'}</Badge>;
                      })()}
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Assigned Team</span>
                      <span className="text-slate-700 font-medium">{getTeamName(selectedProfile.team_id)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Start Date</span>
                      <span className="text-slate-700 font-medium">{selectedProfile.start_date}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Role Permission</span>
                      <Badge variant={selectedProfile.role === 'admin' ? 'warning' : 'neutral'} className="mt-0.5">
                        {selectedProfile.role === 'admin' ? 'ADMIN' : 'EMPLOYEE'}
                      </Badge>
                    </div>
                  </div>
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

            {/* TAB 3: SENSITIVE DATA (ADMIN RLS GUARDED) */}
            {activeTab === 'sensitive' && (
              isAdmin ? (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between font-medium">
                    <span>Admin authorization confirmed via RLS check.</span>
                    <Badge variant="success">Admin Access Granted</Badge>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">ΑΦΜ (Tax ID)</span>
                      <span className="text-slate-800 font-mono font-bold text-sm">{selectedProfile.sensitive?.afm || 'Not configured'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">ΑΜΚΑ (Social Security ID)</span>
                      <span className="text-slate-800 font-mono font-bold text-sm">{selectedProfile.sensitive?.amka || 'Not configured'}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-500 uppercase font-semibold block">Bank Account IBAN</span>
                      <span className="text-[#3D87D3] font-mono font-bold text-sm tracking-wider">{selectedProfile.sensitive?.iban || 'GR0000000000000000000000000 (Unset)'}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-500 uppercase font-semibold block">Registered Residential Address</span>
                      <span className="text-slate-700 text-sm">{selectedProfile.sensitive?.address || 'No address on file'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-rose-50 border border-rose-200 rounded-xl text-rose-800 space-y-2">
                  <ShieldAlert className="w-10 h-10 mx-auto text-rose-600" />
                  <p className="font-bold text-base">403 Forbidden &mdash; Access Denied</p>
                  <p className="text-xs text-slate-600">
                    Sensitive personal identifiable information (ΑΦΜ, ΑΜΚΑ, IBAN) is strictly protected by Supabase Row-Level Security and is restricted exclusively to Founders with the <code className="text-rose-700 font-bold">admin</code> role.
                  </p>
                </div>
              )
            )}

            {/* TAB 4: COMPENSATION (ADMIN RLS GUARDED) */}
            {activeTab === 'compensation' && (
              isAdmin ? (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-lg bg-purple-50 border border-purple-200 text-purple-800 text-xs flex items-center justify-between font-medium">
                    <span>Confidential employment contract, salary history and bonus ledger view.</span>
                    <Badge variant="info">Strict Founder RLS</Badge>
                  </div>

                  {/* Employment contract */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <h4 className="font-extrabold text-slate-900 text-sm">Employment Contract</h4>
                      <button
                        type="button"
                        onClick={() => editingContract ? setEditingContract(false) : openContractEditor()}
                        className="text-[11px] font-bold text-[#3D87D3] hover:underline cursor-pointer"
                      >
                        {editingContract ? 'Cancel' : activeContract ? 'Edit Contract' : '+ Define Contract'}
                      </button>
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
                          <span><strong className="text-slate-800">From:</strong> {activeContract.start_date}</span>
                          <span><strong className="text-slate-800">To:</strong> {activeContract.end_date || 'Open-ended'}</span>
                          <span><strong className="text-slate-800">Auto-renew:</strong> {activeContract.auto_renew ? 'Yes' : 'No'}</span>
                          <span><strong className="text-slate-800">Notice:</strong> {activeContract.notice_days} days</span>
                        </div>
                        {activeContract.notes && <div className="text-slate-500 mt-1.5 italic">{activeContract.notes}</div>}
                      </div>
                    ) : (
                      <div className="p-4 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg bg-white">
                        No contract defined for this employee yet. Define one to keep payroll and terms documented.
                      </div>
                    )}
                  </div>

                  {/* Salary history */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <h4 className="font-extrabold text-slate-900 text-sm">Salary History</h4>
                      <span className="text-[10px] text-slate-400 font-mono">Changes are closed-ended — a raise ends the previous record</span>
                    </div>
                    {salaries.filter(s => s.profile_id === selectedProfile.id).map(sal => (
                      <div key={sal.id} className="p-3 rounded-lg bg-white border border-slate-200 flex items-center justify-between shadow-2xs">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Effective {sal.valid_from} &mdash; {sal.valid_to || 'Present (Active)'}</span>
                          <span className="text-lg font-bold text-slate-800">€{sal.gross_amount.toLocaleString()} <span className="text-xs font-normal text-slate-500">/ {sal.basis === 'monthly_gross' ? 'month gross' : 'monthly retainer fee'}</span></span>
                        </div>
                        <Badge variant="neutral">{sal.basis.toUpperCase()}</Badge>
                      </div>
                    ))}
                    {salaries.filter(s => s.profile_id === selectedProfile.id).length === 0 && (
                      <div className="p-4 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg bg-white">
                        No salary record yet — define one in Payroll to enable draft generation.
                      </div>
                    )}
                  </div>

                  {/* Bonuses */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <h4 className="font-extrabold text-slate-900 text-sm">Salary Bonuses</h4>
                      <span className="text-[10px] text-slate-400 font-mono">Recurring bonuses are auto-generated in payroll each period; one-time bonuses are entered manually with proof documents</span>
                    </div>

                    {/* Add bonus form */}
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 p-3 bg-white border border-slate-200 rounded-lg">
                      <div className="col-span-2">
                        <label className="text-slate-500 font-semibold block mb-1">Bonus Name</label>
                        <input type="text" placeholder="e.g. Performance Bonus" value={bonusForm.name} onChange={e => setBonusForm({ ...bonusForm, name: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800" />
                      </div>
                      <div>
                        <label className="text-slate-500 font-semibold block mb-1">Amount (€)</label>
                        <input type="number" step="0.01" placeholder="500" value={bonusForm.amount || ''} onChange={e => setBonusForm({ ...bonusForm, amount: Number(e.target.value) })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                      </div>
                      <div>
                        <label className="text-slate-500 font-semibold block mb-1">Kind</label>
                        <select value={bonusForm.kind} onChange={e => setBonusForm({ ...bonusForm, kind: e.target.value as 'recurring' | 'one_time' })} className="w-full p-2 border rounded-md bg-white text-slate-800">
                          <option value="recurring">Recurring</option>
                          <option value="one_time">One-time</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-slate-500 font-semibold block mb-1">Frequency / Period</label>
                        {bonusForm.kind === 'recurring' ? (
                          <select value={bonusForm.frequency || 'monthly'} onChange={e => setBonusForm({ ...bonusForm, frequency: e.target.value as any })} className="w-full p-2 border rounded-md bg-white text-slate-800">
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="annual">Annual</option>
                          </select>
                        ) : (
                          <input type="month" value={bonusForm.period || ''} onChange={e => setBonusForm({ ...bonusForm, period: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                        )}
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          className="bg-[#3D87D3] text-white cursor-pointer w-full"
                          onClick={async () => {
                            if (!bonusForm.name.trim() || !bonusForm.amount) { alert('Name and amount are required.'); return; }
                            const ok = await addSalaryBonus({
                              profile_id: selectedProfile.id,
                              name: bonusForm.name.trim(),
                              amount: bonusForm.amount,
                              kind: bonusForm.kind,
                              frequency: bonusForm.kind === 'recurring' ? bonusForm.frequency : (null as any),
                              start_period: bonusForm.kind === 'recurring' ? (bonusForm.start_period || null) : null,
                              end_period: bonusForm.kind === 'recurring' ? (bonusForm.end_period || null) : null,
                              period: bonusForm.kind === 'one_time' ? (bonusForm.period || null) : null,
                              status: 'active',
                            });
                            if (ok) setBonusForm({ name: '', amount: 0, kind: 'recurring', frequency: 'monthly', start_period: '', end_period: '', period: '' });
                          }}
                        >
                          <Plus className="w-3.5 h-3.5 mr-1" /> Add Bonus
                        </Button>
                      </div>
                      {bonusForm.kind === 'recurring' && (
                        <div className="col-span-3">
                          <label className="text-slate-500 font-semibold block mb-1">Valid from / to period (YYYY-MM, empty = open)</label>
                          <div className="flex gap-2">
                            <input type="month" value={bonusForm.start_period || ''} onChange={e => setBonusForm({ ...bonusForm, start_period: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                            <input type="month" value={bonusForm.end_period || ''} onChange={e => setBonusForm({ ...bonusForm, end_period: e.target.value })} className="w-full p-2 border rounded-md bg-white text-slate-800 font-mono" />
                          </div>
                        </div>
                      )}
                    </div>

                    {salaryBonuses.filter(b => b.profile_id === selectedProfile.id).map(b => (
                      <div key={b.id} className="p-3 rounded-lg bg-white border border-slate-200 flex items-center justify-between shadow-2xs">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800">{b.name}</span>
                            <Badge variant={b.kind === 'recurring' ? 'info' : 'warning'} className="text-[9px] px-1.5 py-0">{b.kind === 'recurring' ? `${(b.frequency || 'monthly').toUpperCase()} RECURRING` : 'ONE-TIME'}</Badge>
                            <Badge variant={b.status === 'active' ? 'success' : 'neutral'} className="text-[9px] px-1.5 py-0">{b.status.toUpperCase()}</Badge>
                          </div>
                          <div className="text-slate-500 mt-0.5">
                            €{Number(b.amount).toLocaleString()}
                            {b.kind === 'recurring'
                              ? <> · {b.start_period || 'any'} → {b.end_period || 'open-ended'}</>
                              : b.period ? <> · paid in {b.period}</> : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="cursor-pointer"
                            onClick={() => updateSalaryBonus(b.id, { status: b.status === 'active' ? 'inactive' : 'active' })}
                          >
                            {b.status === 'active' ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => { if (confirm(`Delete bonus "${b.name}"?`)) deleteSalaryBonus(b.id); }} className="cursor-pointer">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {salaryBonuses.filter(b => b.profile_id === selectedProfile.id).length === 0 && (
                      <div className="p-4 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg bg-white">
                        No bonuses defined. Add a recurring bonus to auto-generate it in every payroll run.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-rose-50 border border-rose-200 rounded-xl text-rose-800 space-y-2">
                  <ShieldAlert className="w-10 h-10 mx-auto text-rose-600" />
                  <p className="font-bold text-base">403 Forbidden &mdash; Access Denied</p>
                  <p className="text-xs text-slate-600">
                    Salary and payment ledgers are completely inaccessible to employee credentials.
                  </p>
                </div>
              )
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
                    <label className="text-slate-600 font-semibold block mb-1">Job Title</label>
                    <input type="text" value={editData.title || ''} onChange={e => setEditData({...editData, title: e.target.value})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium" required />
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
                    <label className="text-slate-600 font-semibold block mb-1">Seniority Level (for man-hours billing)</label>
                    <select value={editData.seniority_level || 'mid'} onChange={e => setEditData({...editData, seniority_level: e.target.value})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium">
                      <option value="junior">Junior</option>
                      <option value="mid">Mid</option>
                      <option value="senior">Senior</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-1">Role Permission</label>
                    <select value={editData.role || 'employee'} onChange={e => setEditData({...editData, role: e.target.value})} className="w-full p-2 border rounded-md bg-white text-slate-800 font-medium">
                      <option value="employee">Employee</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
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
                      <div className="col-span-2">
                        <label className="text-slate-500 block mb-1">Residential Address</label>
                        <input type="text" value={editData.sensitive?.address || ''} onChange={e => setEditData({...editData, sensitive: {...(editData.sensitive || {}), address: e.target.value}})} className="w-full p-2 border rounded-md bg-white text-slate-800" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <span className="text-slate-700 font-bold block text-xs">Timesheet Role & Seniority (effective-dated)</span>
                  <EmployeeRoleAssigner profileId={selectedProfile.id} />
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <span className="text-slate-700 font-bold block text-xs">Remote Work Quota (per employee — falls back to company default)</span>
                  <EmployeeRemoteQuota profileId={selectedProfile.id} />
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
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Onboard New Team Member (Admin)">
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
              <input type="email" placeholder="e.g. mpapadopoulou@stellarblue.eu" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800" required />
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Job Title *</label>
              <input type="text" placeholder="e.g. Senior Software Engineer" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800" required />
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
              <label className="text-slate-600 font-semibold block mb-1">Seniority Level (for man-hours billing)</label>
              <select value={newSeniorityLevel} onChange={e => setNewSeniorityLevel(e.target.value as any)} className="w-full p-2 border rounded-md bg-white text-slate-800">
                <option value="junior">Junior</option>
                <option value="mid">Mid</option>
                <option value="senior">Senior</option>
              </select>
            </div>
            <div>
              <label className="text-slate-600 font-semibold block mb-1">Role Permission *</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value as any)} className="w-full p-2 border rounded-md bg-white text-slate-800">
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </div>
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
                <div className="col-span-2">
                  <label className="text-slate-500 block mb-1">Residential Address</label>
                  <input type="text" placeholder="Street, City, Postal Code" value={newAddress} onChange={e => setNewAddress(e.target.value)} className="w-full p-2 border rounded-md bg-white text-slate-800" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm"><Plus className="w-4 h-4 mr-1.5" /> Create Person</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
