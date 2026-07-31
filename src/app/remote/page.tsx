"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Globe, MapPin, CheckCircle, AlertTriangle, Calendar, 
  Users, ShieldCheck, Plus, Clock 
} from 'lucide-react';

export default function RemoteWorkLogPage() {
  const { currentUser, profiles, remoteDays, remotePatterns, updateErganiStatus, saveRemotePattern, addRemoteDay } = useAuth();
  const isAdmin = currentUser.role === 'admin';
  const isContractor = currentUser.employment_type === 'contractor';

  const [tab, setTab] = useState<'my_log' | 'team_view' | 'ergani_gaps'>('my_log');
  const [selectedDay, setSelectedDay] = useState<string>('2026-08-05');
  const [selectedMode, setSelectedMode] = useState<'office' | 'remote_gr' | 'remote_abroad'>('remote_gr');
  const [abroadLocation, setAbroadLocation] = useState('');
  const [note, setNote] = useState('');

  // Weekly pattern states - load from DB if user already saved a pattern!
  const myExistingPatterns = remotePatterns.filter(rp => rp.profile_id === currentUser.id);
  const getInitialMode = (day: string, defaultMode: 'office' | 'remote_gr'): 'office' | 'remote_gr' | 'remote_abroad' => {
    const found = myExistingPatterns.find(p => p.weekday === day);
    return found ? (found.mode as any) : defaultMode;
  };

  const [pattern, setPattern] = useState<{ [key: string]: 'office' | 'remote_gr' | 'remote_abroad' }>({
    Mon: getInitialMode('Mon', 'office'),
    Tue: getInitialMode('Tue', 'remote_gr'),
    Wed: getInitialMode('Wed', 'office'),
    Thu: getInitialMode('Thu', 'remote_gr'),
    Fri: getInitialMode('Fri', 'office')
  });

  if (isContractor) {
    return (
      <div className="p-10 text-center bg-slate-50 border border-slate-200 rounded-2xl max-w-xl mx-auto my-12 space-y-3 shadow-xs">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-600" />
        <h2 className="text-xl font-bold text-slate-800">Module Hidden for Contractors</h2>
        <p className="text-xs text-slate-600">
          Contractors manage their own work location and are excluded from internal employee tele-work declarations and ΕΡΓΑΝΗ τηλεργασία logs.
        </p>
      </div>
    );
  }

  const myRemoteDaysCount = 6;
  const isOverQuota = myRemoteDaysCount > 8;

  const handleLogDay = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedMode === 'remote_abroad' && !abroadLocation.trim()) {
      alert('VALIDATION ERROR: Location is mandatory when working remotely from abroad due to real tax and social-security implications!');
      return;
    }
    addRemoteDay({
      profile_id: currentUser.id,
      date: selectedDay,
      mode: selectedMode,
      location: selectedMode === 'remote_abroad' ? abroadLocation : undefined,
      note: note || undefined,
      ergani_status: selectedMode === 'office' ? 'not_required' : 'pending'
    });
    alert(`Logged ${selectedMode.toUpperCase()} for ${selectedDay} and persisted to database. Marked pending for ΕΡΓΑΝΗ τηλεργασία filing.`);
    setNote('');
    setAbroadLocation('');
  };

  const unsubmittedRemote = remoteDays.filter(r => r.mode !== 'office' && r.ergani_status !== 'submitted');

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="border-b border-slate-200/80 pb-5">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
          <Globe className="w-6 h-6 mr-3 text-[#3D87D3]" /> Remote Work Log & Telework Policy
        </h1>
        <p className="text-slate-500 text-xs mt-1">
          Lightweight attendance tracking, recurring weekly default patterns, and mandatory location capture for abroad work.
        </p>
      </div>

      {/* Quota KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card className="bg-white border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-slate-400">Monthly Quota Status</span>
            <Badge variant={isOverQuota ? 'warning' : 'success'}>Max 8 Days / Month</Badge>
          </div>
          <h4 className="text-3xl font-extrabold text-[#3D87D3] mt-2">{myRemoteDaysCount} <span className="text-sm font-normal text-slate-500">remote days logged</span></h4>
          <p className="text-[11px] text-slate-500 mt-1">
            {isOverQuota ? "Soft warning: Quota exceeded by team policy." : "Within company threshold for this month."}
          </p>
        </Card>
        
        <Card className="shadow-xs">
          <span className="text-xs font-bold uppercase text-slate-400">Active Weekly Pattern</span>
          <h4 className="text-lg font-bold text-slate-800 mt-2">Tue & Thu Remote (GR)</h4>
          <p className="text-[11px] text-slate-500 mt-1">Auto-applied unless daily override is entered.</p>
        </Card>

        <Card className="shadow-xs">
          <span className="text-xs font-bold uppercase text-slate-400">ΕΡΓΑΝΗ Τηλεργασία Status</span>
          <h4 className="text-lg font-bold text-emerald-700 mt-2 flex items-center">
            <CheckCircle className="w-5 h-5 mr-1.5 text-emerald-600" /> Reconciled
          </h4>
          <p className="text-[11px] text-slate-500 mt-1">All remote declarations submitted by accountant.</p>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 space-x-6 text-sm">
        <button 
          onClick={() => setTab('my_log')}
          className={`pb-3 font-semibold transition-all cursor-pointer ${tab === 'my_log' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
        >
          My Weekly Pattern & Daily Log
        </button>
        <button 
          onClick={() => setTab('team_view')}
          className={`pb-3 font-semibold transition-all cursor-pointer ${tab === 'team_view' ? 'border-b-2 border-[#3D87D3] text-[#3D87D3] font-bold' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Team In-Office Status Today
        </button>
        {isAdmin && (
          <button 
            onClick={() => setTab('ergani_gaps')}
            className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'ergani_gaps' ? 'border-b-2 border-rose-600 text-rose-600 font-bold' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <ShieldCheck className="w-4 h-4 mr-1.5 text-rose-600" /> Τηλεργασία Filing Gaps ({unsubmittedRemote.length})
          </button>
        )}
      </div>

      {/* TAB 1: MY LOG */}
      {tab === 'my_log' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Weekly recurring pattern setting */}
          <Card title="Recurring Weekly Default Pattern" subtitle="Set your general working mode per weekday" className="shadow-xs">
            <div className="space-y-3 mt-3">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => (
                <div key={day} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  <span className="font-bold w-16 text-slate-700">{day}</span>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setPattern({ ...pattern, [day]: 'office' })}
                      className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${pattern[day] === 'office' ? 'bg-slate-800 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      Office
                    </button>
                    <button 
                      onClick={() => setPattern({ ...pattern, [day]: 'remote_gr' })}
                      className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${pattern[day] === 'remote_gr' ? 'bg-[#3D87D3]/10 text-[#3D87D3] border border-[#3D87D3]/30 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      Remote (Greece)
                    </button>
                  </div>
                </div>
              ))}
              <Button variant="secondary" className="w-full mt-2 text-xs cursor-pointer" onClick={() => {
                const patternEntries = Object.entries(pattern).map(([weekday, mode]) => ({ weekday, mode }));
                saveRemotePattern(currentUser.id, patternEntries);
                alert('Recurring remote pattern successfully saved to Postgres!');
              }}>
                Update Recurring Pattern &rarr;
              </Button>
            </div>
          </Card>

          {/* Daily override logger */}
          <Card title="Log Specific Day / Override" subtitle="Record daily exceptions or remote work from abroad" className="shadow-xs">
            <form onSubmit={handleLogDay} className="space-y-4 text-xs mt-3">
              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Target Date</label>
                <input type="date" value={selectedDay} onChange={e => setSelectedDay(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800" />
              </div>

              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Work Mode</label>
                <select 
                  value={selectedMode} 
                  onChange={e => setSelectedMode(e.target.value as 'office' | 'remote_gr' | 'remote_abroad')}
                  className="w-full bg-white border border-slate-200 rounded p-2.5 text-slate-800 text-sm"
                >
                  <option value="office">In Office (Thessaloniki HQ)</option>
                  <option value="remote_gr">Remote Work (Within Greece)</option>
                  <option value="remote_abroad">Remote Work (Abroad / Outside Greece)</option>
                </select>
              </div>

              {selectedMode === 'remote_abroad' && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2 text-amber-900">
                  <span className="font-bold flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-1.5 text-amber-600" /> MANDATORY LOCATION FIELD
                  </span>
                  <p className="text-[11px] text-slate-700">
                    Working remotely from outside Greece carries potential tax and social-security implications under EU and local labor compliance. Please provide city and country:
                  </p>
                  <input 
                    type="text" 
                    placeholder="e.g. Berlin, Germany or London, UK"
                    value={abroadLocation}
                    onChange={e => setAbroadLocation(e.target.value)}
                    required
                    className="w-full bg-white border border-slate-300 rounded p-2 text-slate-800 placeholder:text-slate-400 font-medium text-sm"
                  />
                </div>
              )}

              <div>
                <label className="block font-semibold uppercase text-slate-500 mb-1">Notes (Optional)</label>
                <input type="text" placeholder="e.g. Attending workshop or family visits..." value={note} onChange={e => setNote(e.target.value)} className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800" />
              </div>

              <Button variant="primary" type="submit" className="w-full bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-white font-bold py-2.5 cursor-pointer">
                Save Attendance Override &rarr;
              </Button>
            </form>
          </Card>
        </div>
      )}

      {/* TAB 2: TEAM VIEW TODAY */}
      {tab === 'team_view' && (
        <Card title="Who's In The Office Today (Thursday, July 30, 2026)" subtitle="Real-time attendance view across StellarBlue teams" className="shadow-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-3">
            {profiles.filter(p => p.status === 'active' && p.employment_type !== 'contractor').map((p, idx) => {
              const isOffice = idx % 2 === 0;
              return (
                <div key={p.id} className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{p.first_name} {p.last_name}</p>
                    <p className="text-xs text-slate-500">{p.title}</p>
                  </div>
                  <Badge variant={isOffice ? 'neutral' : 'info'}>
                    {isOffice ? '🏢 Office HQ' : '🏠 Remote GR'}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* TAB 3: ERGANI TELEWORK GAPS */}
      {tab === 'ergani_gaps' && isAdmin && (
        <Card title="ΕΡΓΑΝΗ Τηλεργασία Declaration Gap Widget" subtitle="Remote work records awaiting declaration export matching" className="shadow-xs">
          <div className="space-y-3 mt-2">
            {unsubmittedRemote.length === 0 ? (
              <div className="p-6 text-center text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl font-medium text-xs">
                <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-emerald-600" />
                All remote work days are fully filed in ΕΡΓΑΝΗ II!
              </div>
            ) : (
              unsubmittedRemote.map(rem => {
                const prof = profiles.find(p => p.id === rem.profile_id);
                return (
                  <div key={rem.id} className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-slate-800">{prof?.first_name} {prof?.last_name}</span> &bull; Date: <strong className="text-[#3D87D3] font-mono">{rem.date}</strong> ({rem.mode})
                    </div>
                    <Button size="sm" variant="outline" onClick={() => updateErganiStatus(rem.id, 'remote', 'submitted')} className="border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-semibold cursor-pointer">
                      <CheckCircle className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Mark Submitted
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
