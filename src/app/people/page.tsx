"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Profile, EmploymentType } from '@/lib/types';
import { Card, Button, Badge, Modal } from '@/components/ui/primitives';
import { 
  Users, Search, Filter, Download, Lock, ShieldAlert, 
  Mail, Calendar, Briefcase, Plus, Edit2, Check 
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

export default function PeopleDirectoryPage() {
  const { currentUser, profiles, teams, salaries, entitlements, updateProfile } = useAuth();
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'schedule' | 'sensitive' | 'compensation'>('overview');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500 tracking-wider">
                <th className="p-3.5 pl-5">Employee Name & Greek Spelling</th>
                <th className="p-3.5">Role / Title</th>
                <th className="p-3.5">Team</th>
                <th className="p-3.5">Employment Type</th>
                <th className="p-3.5">Work Schedule</th>
                <th className="p-3.5 text-right pr-5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredProfiles.map(p => {
                const isContractor = p.employment_type === 'contractor';
                const isPartTime = p.employment_type === 'part_time';
                return (
                  <tr 
                    key={p.id} 
                    onClick={() => { setSelectedProfile(p); setActiveTab('overview'); }}
                    className="hover:bg-slate-50 transition-colors cursor-pointer group"
                  >
                    <td className="p-3.5 pl-5">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                          {p.first_name[0]}{p.last_name[0]}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800 group-hover:text-[#3D87D3] transition-colors">{p.first_name} {p.last_name}</p>
                          <p className="text-xs text-slate-500">{p.name_el} &bull; <span className="text-slate-500 font-mono">{p.work_email}</span></p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5 font-medium text-slate-700">{p.title}</td>
                    <td className="p-3.5">
                      <Badge variant="neutral">{getTeamName(p.team_id)}</Badge>
                    </td>
                    <td className="p-3.5">
                      <Badge variant={isContractor ? 'warning' : isPartTime ? 'info' : 'success'}>
                        {p.employment_type.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </td>
                    <td className="p-3.5 text-xs text-slate-500 font-mono">
                      {p.work_schedule.join(', ')} {isPartTime && <span className="text-amber-700 font-semibold">(Part-time)</span>}
                    </td>
                    <td className="p-3.5 text-right pr-5">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedProfile(p); setActiveTab('overview'); }}>
                        View Profile &rarr;
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
                      <span className="text-slate-500 uppercase font-semibold block">Assigned Team</span>
                      <span className="text-slate-700 font-medium">{getTeamName(selectedProfile.team_id)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase font-semibold block">Start Date</span>
                      <span className="text-slate-700 font-medium">{selectedProfile.start_date}</span>
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
                    <span>Confidential salary history ledger view.</span>
                    <Badge variant="info">Strict Founder RLS</Badge>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                    {salaries.filter(s => s.profile_id === selectedProfile.id).map(sal => (
                      <div key={sal.id} className="p-3 rounded-lg bg-white border border-slate-200 flex items-center justify-between shadow-2xs">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Effective {sal.valid_from} &mdash; {sal.valid_to || 'Present (Active)'}</span>
                          <span className="text-lg font-bold text-slate-800">€{sal.gross_amount.toLocaleString()} <span className="text-xs font-normal text-slate-500">/ {sal.basis === 'monthly_gross' ? 'month gross' : 'monthly retainer fee'}</span></span>
                        </div>
                        <Badge variant="neutral">{sal.basis.toUpperCase()}</Badge>
                      </div>
                    ))}
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
          </div>
        )}
      </Modal>
    </div>
  );
}
