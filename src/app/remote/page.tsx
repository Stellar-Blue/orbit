"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge, Modal, StatCard } from '@/components/ui/primitives';
import { 
  Globe, MapPin, CheckCircle, AlertTriangle, Calendar, 
  Users, ShieldCheck, Plus, Clock 
} from 'lucide-react';

export default function RemoteWorkLogPage() {
  const { currentUser, profiles, remoteDays, remotePatterns, updateErganiStatus } = useAuth();
  const isAdmin = currentUser.role === 'admin';
  const isContractor = currentUser.employment_type === 'contractor';

  const [tab, setTab] = useState<'my_log' | 'team_view' | 'ergani_gaps'>('my_log');
  const [selectedDay, setSelectedDay] = useState<string>('2026-08-05');
  const [selectedMode, setSelectedMode] = useState<'office' | 'remote_gr' | 'remote_abroad'>('remote_gr');
  const [abroadLocation, setAbroadLocation] = useState('');
  const [note, setNote] = useState('');

  // Weekly pattern states
  const [pattern, setPattern] = useState<{ [key: string]: 'office' | 'remote_gr' | 'remote_abroad' }>({
    Mon: 'office',
    Tue: 'remote_gr',
    Wed: 'office',
    Thu: 'remote_gr',
    Fri: 'office'
  });

  if (isContractor) {
    return (
      <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl max-w-xl mx-auto my-12 space-y-3">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-400" />
        <h2 className="text-xl font-bold text-slate-100">Module Hidden for Contractors</h2>
        <p className="text-xs text-slate-400">
          Contractors manage their own work location and are excluded from internal employee tele-work declarations and ΕΡΓΑΝΗ τηλεργασία logs.
        </p>
      </div>
    );
  }

  const myRemoteDaysCount = 6; // Mock calculation for month against max 8 policy
  const isOverQuota = myRemoteDaysCount > 8;

  const handleLogDay = (e: React.FormEvent) => {
    e.preventDefault();
    // REQUIRED location when remote_abroad (tax/social-security implications per requirements!)
    if (selectedMode === 'remote_abroad' && !abroadLocation.trim()) {
      alert('VALIDATION ERROR: Location is mandatory when working remotely from abroad due to real tax and social-security implications!');
      return;
    }
    alert(`Logged ${selectedMode.toUpperCase()} for ${selectedDay}. Marked pending for ΕΡΓΑΝΗ τηλεργασία filing.`);
  };

  const unsubmittedRemote = remoteDays.filter(r => r.mode !== 'office' && r.ergani_status !== 'submitted');

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="border-b border-slate-800/80 pb-5">
        <h1 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
          <Globe className="w-6 h-6 mr-3 text-cyan-400" /> Remote Work Log & Telework Policy
        </h1>
        <p className="text-slate-400 text-xs mt-1">
          Lightweight attendance tracking, recurring weekly default patterns, and mandatory location capture for abroad work.
        </p>
      </div>

      {/* Quota KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card className="bg-gradient-to-tr from-cyan-950/40 via-slate-950 to-slate-950 border-cyan-900/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-slate-400">Monthly Quota Status</span>
            <Badge variant={isOverQuota ? 'warning' : 'success'}>Max 8 Days / Month</Badge>
          </div>
          <h4 className="text-3xl font-extrabold text-cyan-400 mt-2">{myRemoteDaysCount} <span className="text-sm font-normal text-slate-400">remote days logged</span></h4>
          <p className="text-[11px] text-slate-400 mt-1">
            {isOverQuota ? "Soft warning: Quota exceeded by team policy." : "Within company threshold for this month."}
          </p>
        </Card>
        
        <Card>
          <span className="text-xs font-bold uppercase text-slate-400">Active Weekly Pattern</span>
          <h4 className="text-lg font-bold text-slate-100 mt-2">Tue & Thu Remote (GR)</h4>
          <p className="text-[11px] text-slate-500 mt-1">Auto-applied unless daily override is entered.</p>
        </Card>

        <Card>
          <span className="text-xs font-bold uppercase text-slate-400">ΕΡΓΑΝΗ Тηλεργασία Status</span>
          <h4 className="text-lg font-bold text-emerald-400 mt-2 flex items-center">
            <CheckCircle className="w-5 h-5 mr-1.5" /> Reconciled
          </h4>
          <p className="text-[11px] text-slate-400 mt-1">All remote declarations submitted by accountant.</p>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 space-x-6 text-sm">
        <button 
          onClick={() => setTab('my_log')}
          className={`pb-3 font-semibold transition-all cursor-pointer ${tab === 'my_log' ? 'border-b-2 border-cyan-400 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          My Weekly Pattern & Daily Log
        </button>
        <button 
          onClick={() => setTab('team_view')}
          className={`pb-3 font-semibold transition-all cursor-pointer ${tab === 'team_view' ? 'border-b-2 border-cyan-400 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Team In-Office Status Today
        </button>
        {isAdmin && (
          <button 
            onClick={() => setTab('ergani_gaps')}
            className={`pb-3 font-semibold transition-all flex items-center cursor-pointer ${tab === 'ergani_gaps' ? 'border-b-2 border-rose-500 text-rose-400 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <ShieldCheck className="w-4 h-4 mr-1.5 text-rose-400" /> Тηλεργασία Filing Gaps ({unsubmittedRemote.length})
          </button>
        )}
      </div>

      {/* TAB 1: MY LOG */}
      {tab === 'my_log' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Weekly recurring pattern setting */}
          <Card title="Recurring Weekly Default Pattern" subtitle="Set your general working mode per weekday">
            <div className="space-y-3 mt-3">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => (
                <div key={day} className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                  <span className="font-bold w-16 text-slate-300">{day}</span>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setPattern({ ...pattern, [day]: 'office' })}
                      className={`px-3 py-1.5 rounded-md font-medium transition-all ${pattern[day] === 'office' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:bg-slate-900'}`}
                    >
                      Office
                    </button>
                    <button 
                      onClick={() => setPattern({ ...pattern, [day]: 'remote_gr' })}
                      className={`px-3 py-1.5 rounded-md font-medium transition-all ${pattern[day] === 'remote_gr' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold' : 'text-slate-400 hover:bg-slate-900'}`}
                    >
                      Remote (Greece)
                    </button>
                  </div>
                </div>
              ))}
              <Button variant="secondary" className="w-full mt-2 text-xs" onClick={() => alert('Recurring pattern saved!')}>
                Update Recurring Pattern &rarr;
              </Button>
            </div>
          </Card>

          {/* Daily override logger */}
          <Card title="Log Specific Day / Override" subtitle="Record daily exceptions or remote work from abroad">
            <form onSubmit={handleLogDay} className="space-y-4 text-xs mt-3">
              <div>
                <label className="block font-semibold uppercase text-slate-400 mb-1">Target Date</label>
                <input type="date" value={selectedDay} onChange={e => setSelectedDay(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200" />
              </div>

              <div>
                <label className="block font-semibold uppercase text-slate-400 mb-1">Work Mode</label>
                <select 
                  value={selectedMode} 
                  onChange={e => setSelectedMode(e.target.value as 'office' | 'remote_gr' | 'remote_abroad')}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-200 text-sm"
                >
                  <option value="office">In Office (Thessaloniki HQ)</option>
                  <option value="remote_gr">Remote Work (Within Greece)</option>
                  <option value="remote_abroad">Remote Work (Abroad / Outside Greece)</option>
                </select>
              </div>

              {selectedMode === 'remote_abroad' && (
                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-700 space-y-2">
                  <span className="font-bold text-amber-400 flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-1.5 text-amber-400 animate-pulse" /> MANDATORY LOCATION FIELD
                  </span>
                  <p className="text-[11px] text-slate-300">
                    Working remotely from outside Greece carries potential tax and social-security implications under EU and local labor compliance. Please provide city and country:
                  </p>
                  <input 
                    type="text" 
                    placeholder="e.g. Berlin, Germany or London, UK"
                    value={abroadLocation}
                    onChange={e => setAbroadLocation(e.target.value)}
                    required
                    className="w-full bg-slate-900 border border-amber-600 rounded p-2 text-slate-100 placeholder:text-slate-500 font-medium text-sm"
                  />
                </div>
              )}

              <div>
                <label className="block font-semibold uppercase text-slate-400 mb-1">Notes (Optional)</label>
                <input type="text" placeholder="e.g. Attending workshop or family visits..." value={note} onChange={e => setNote(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200" />
              </div>

              <Button variant="primary" type="submit" className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2.5">
                Save Attendance Override &rarr;
              </Button>
            </form>
          </Card>
        </div>
      )}

      {/* TAB 2: TEAM VIEW TODAY */}
      {tab === 'team_view' && (
        <Card title="Who's In The Office Today (Thursday, July 30, 2026)" subtitle="Real-time attendance view across StellarBlue teams">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-3">
            {profiles.filter(p => p.status === 'active' && p.employment_type !== 'contractor').map((p, idx) => {
              const isOffice = idx % 2 === 0;
              return (
                <div key={p.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-200 text-sm">{p.first_name} {p.last_name}</p>
                    <p className="text-xs text-slate-400">{p.title}</p>
                  </div>
                  <Badge variant={isOffice ? 'neutral' : 'info'} className={isOffice ? 'bg-slate-900 text-slate-300' : 'bg-cyan-950 text-cyan-300 border-cyan-800'}>
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
        <Card title="ΕΡΓΑΝΗ Τηλεργασία Declaration Gap Widget" subtitle="Remote work records awaiting declaration export matching">
          <div className="space-y-3 mt-2">
            {unsubmittedRemote.length === 0 ? (
              <div className="p-6 text-center text-emerald-400 bg-emerald-950/20 border border-emerald-800/40 rounded-xl font-medium text-xs">
                <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                All remote work days are fully filed in ΕΡΓΑΝΗ II!
              </div>
            ) : (
              unsubmittedRemote.map(rem => {
                const prof = profiles.find(p => p.id === rem.profile_id);
                return (
                  <div key={rem.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-slate-200">{prof?.first_name} {prof?.last_name}</span> &bull; Date: <strong className="text-cyan-400 font-mono">{rem.date}</strong> ({rem.mode})
                    </div>
                    <Button size="sm" variant="outline" onClick={() => updateErganiStatus(rem.id, 'remote', 'submitted')} className="border-emerald-700 text-emerald-400 hover:bg-emerald-950">
                      <CheckCircle className="w-3.5 h-3.5 mr-1" /> Mark Submitted
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
