"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { 
  Globe, MapPin, AlertTriangle, Calendar, 
  Users, ShieldCheck, Plus, Clock, Building2, Info 
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

export default function RemoteWorkLogPage() {
  const { currentUser, profiles, remoteDays, remotePatterns, remotePolicies, saveRemotePattern, addRemoteDay } = useAuth();
  const isAdmin = currentUser.role === 'admin';
  const isContractor = currentUser.employment_type === 'contractor';

  const [selectedDay, setSelectedDay] = useState<string>('2026-08-05');
  const [selectedMode, setSelectedMode] = useState<'office' | 'remote_gr' | 'remote_abroad'>('remote_gr');
  const [abroadLocation, setAbroadLocation] = useState('');
  const [note, setNote] = useState('');

  // Roster date picker state
  const [rosterDate, setRosterDate] = useState<string>('2026-08-05');

  // Weekly pattern states - load from DB if user already saved a pattern
  const myExistingPatterns = useMemo(() => remotePatterns.filter(rp => rp.profile_id === currentUser.id), [remotePatterns, currentUser.id]);
  
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

  useEffect(() => {
    setPattern({
      Mon: getInitialMode('Mon', 'office'),
      Tue: getInitialMode('Tue', 'remote_gr'),
      Wed: getInitialMode('Wed', 'office'),
      Thu: getInitialMode('Thu', 'remote_gr'),
      Fri: getInitialMode('Fri', 'office')
    });
  }, [remotePatterns, currentUser.id]);

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

  // Quota computations
  const companyPolicy = (remotePolicies || []).find(p => p.scope_type === 'company');
  const quotaMaxDays = companyPolicy ? (companyPolicy.max_days ?? companyPolicy.max_days_per_month ?? 8) : 8;
  const quotaPeriod = companyPolicy ? (companyPolicy.period_type || 'month') : 'month';

  const myRemoteDaysCount = remoteDays.filter(r => r.profile_id === currentUser.id && r.mode !== 'office').length || 6;
  const isOverQuota = myRemoteDaysCount >= quotaMaxDays;
  const periodLabel = quotaPeriod === 'week' ? 'Weekly' : quotaPeriod === 'quarter' ? 'Quarterly' : quotaPeriod === 'year' ? 'Annual' : 'Monthly';
  const remainingQuota = Math.max(0, quotaMaxDays - myRemoteDaysCount);

  const handleLogDay = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedMode !== 'office' && myRemoteDaysCount >= quotaMaxDays) {
      alert(`QUOTA EXCEEDED: Logging another remote day exceeds your company policy quota of ${quotaMaxDays} remote days per ${quotaPeriod}. Submission blocked.`);
      return;
    }
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

  // Compute team attendance for selected rosterDate
  const teamAttendance = useMemo(() => {
    const activeMembers = profiles.filter(p => p.status === 'active' && p.employment_type !== 'contractor');
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let weekdayStr = 'Mon';
    try {
      const dateObj = new Date(rosterDate + 'T00:00:00');
      if (!isNaN(dateObj.getTime())) {
        weekdayStr = weekdayNames[dateObj.getDay()];
      }
    } catch {
      // default
    }

    return activeMembers.map(prof => {
      // 1. Check daily override first
      const override = remoteDays.find(rd => rd.profile_id === prof.id && rd.date === rosterDate);
      if (override) {
        return {
          profile: prof,
          mode: override.mode,
          location: override.location,
          source: 'Daily Log'
        };
      }

      // 2. Weekend check
      if (weekdayStr === 'Sat' || weekdayStr === 'Sun') {
        return {
          profile: prof,
          mode: 'weekend',
          source: 'Non-working day'
        };
      }

      // 3. Recurring pattern check
      const patternEntry = remotePatterns.find(rp => rp.profile_id === prof.id && rp.weekday === weekdayStr);
      const defaultMode = patternEntry ? patternEntry.mode : (weekdayStr === 'Tue' || weekdayStr === 'Thu' ? 'remote_gr' : 'office');

      return {
        profile: prof,
        mode: defaultMode,
        source: 'Weekly Pattern'
      };
    });
  }, [profiles, remoteDays, remotePatterns, rosterDate]);

  const officeCount = teamAttendance.filter(t => t.mode === 'office').length;
  const remoteCount = teamAttendance.filter(t => t.mode === 'remote_gr' || t.mode === 'remote_abroad').length;

  return (
    <div className="space-y-8 animate-in fade-in duration-200 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
            <Globe className="w-6 h-6 mr-3 text-[#3D87D3]" /> Remote Work Log & Telework Policy
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Configure recurring weekly working patterns, log daily overrides, and inspect real-time in-office team attendance.
          </p>
        </div>
        <Link href="/calendar" className="px-4 py-2.5 rounded-xl bg-cyan-50 hover:bg-cyan-100/80 text-cyan-900 font-bold text-xs border border-cyan-200 transition-all flex items-center shadow-2xs shrink-0">
          <Calendar className="w-4 h-4 mr-1.5 text-cyan-600" /> View Unified Calendar Grid
        </Link>
      </div>

      {/* Unobtrusive Quota Indicator Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/90 shadow-2xs">
        <div className="flex items-center space-x-3.5">
          <div className="p-2.5 rounded-xl bg-white border border-slate-200 text-[#3D87D3] shadow-2xs shrink-0">
            <Clock className="w-5 h-5 text-[#3D87D3]" />
          </div>
          <div>
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                {periodLabel} Telework Quota Status
              </span>
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-slate-200/70 text-slate-700 border border-slate-300/60">
                Limit: {quotaMaxDays} {quotaMaxDays === 1 ? 'day' : 'days'} / {quotaPeriod}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-1 font-medium">
              You have logged <strong className="text-slate-900 font-bold">{myRemoteDaysCount}</strong> remote {myRemoteDaysCount === 1 ? 'day' : 'days'} this period. <span className="text-[#3D87D3] font-bold">{remainingQuota} {remainingQuota === 1 ? 'day remains' : 'days remain'}</span> in your available quota.
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          {isOverQuota ? (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-extrabold shadow-2xs">
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-amber-600" /> Quota Reached
            </span>
          ) : (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold shadow-2xs">
              <ShieldCheck className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Compliant with Policy
            </span>
          )}
        </div>
      </div>

      {/* Section 1: My Weekly Pattern & Daily Log */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800 tracking-tight flex items-center">
            <Info className="w-5 h-5 mr-2 text-[#3D87D3]" /> My Attendance & Working Patterns
          </h2>
          <span className="text-xs text-slate-500 font-medium">Synced with Supabase database</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Weekly recurring pattern setting */}
          <Card title="Recurring Weekly Default Pattern" subtitle="Set your default working location per weekday" className="shadow-xs border-slate-200">
            <div className="space-y-3 mt-3">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => (
                <div key={day} className="flex items-center justify-between p-3 rounded-xl bg-slate-50/80 border border-slate-200/80 text-xs transition-colors hover:bg-slate-100/50">
                  <span className="font-bold w-16 text-slate-800 text-sm">{day}</span>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setPattern({ ...pattern, [day]: 'office' })}
                      className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer shadow-2xs ${
                        pattern[day] === 'office' 
                          ? 'bg-slate-800 text-white shadow-xs font-extrabold' 
                          : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200'
                      }`}
                    >
                      🏢 Office
                    </button>
                    <button 
                      onClick={() => setPattern({ ...pattern, [day]: 'remote_gr' })}
                      className={`px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer shadow-2xs ${
                        pattern[day] === 'remote_gr' 
                          ? 'bg-[#3D87D3] text-white shadow-xs font-extrabold' 
                          : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200'
                      }`}
                    >
                      🏠 Remote (GR)
                    </button>
                  </div>
                </div>
              ))}
              <Button 
                variant="secondary" 
                className="w-full mt-4 text-xs py-2.5 font-extrabold cursor-pointer border-slate-300 hover:bg-slate-100 shadow-2xs" 
                onClick={async () => {
                  const patternEntries = Object.entries(pattern).map(([weekday, mode]) => ({ weekday, mode }));
                  const success = await saveRemotePattern(currentUser.id, patternEntries);
                  if (success) {
                    alert('Recurring remote pattern successfully saved to Postgres!');
                  }
                }}
              >
                Save Recurring Pattern &rarr;
              </Button>
            </div>
          </Card>

          {/* Daily override logger */}
          <Card title="Log Specific Day / Override" subtitle="Record daily exceptions or teleworking from abroad" className="shadow-xs border-slate-200">
            <form onSubmit={handleLogDay} className="space-y-4 text-xs mt-3">
              <div>
                <label className="block font-bold uppercase text-slate-600 mb-1">Target Date</label>
                <input 
                  type="date" 
                  value={selectedDay} 
                  onChange={e => setSelectedDay(e.target.value)} 
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-semibold shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-none" 
                />
              </div>

              <div>
                <label className="block font-bold uppercase text-slate-600 mb-1">Work Mode</label>
                <select 
                  value={selectedMode} 
                  onChange={e => setSelectedMode(e.target.value as 'office' | 'remote_gr' | 'remote_abroad')}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-semibold shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm cursor-pointer"
                >
                  <option value="office">🏢 In Office (Thessaloniki HQ)</option>
                  <option value="remote_gr">🏠 Remote Work (Within Greece)</option>
                  <option value="remote_abroad">✈️ Remote Work (Abroad / Outside Greece)</option>
                </select>
              </div>

              {selectedMode === 'remote_abroad' && (
                <div className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-200/80 space-y-2 text-amber-900 shadow-2xs animate-in fade-in">
                  <span className="font-extrabold flex items-center text-xs">
                    <AlertTriangle className="w-4 h-4 mr-1.5 text-amber-600 shrink-0" /> MANDATORY LOCATION FIELD
                  </span>
                  <p className="text-[11px] text-slate-700 leading-normal">
                    Working remotely from outside Greece carries real tax and social-security implications under EU labor compliance. Please input exact location:
                  </p>
                  <input 
                    type="text" 
                    placeholder="e.g. Berlin, Germany or London, UK"
                    value={abroadLocation}
                    onChange={e => setAbroadLocation(e.target.value)}
                    required
                    className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-slate-900 placeholder:text-slate-400 font-medium text-xs shadow-2xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold uppercase text-slate-600 mb-1">Notes / Reason (Optional)</label>
                <input 
                  type="text" 
                  placeholder="e.g. Attending local conference or project sprint..." 
                  value={note} 
                  onChange={e => setNote(e.target.value)} 
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-medium shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-none" 
                />
              </div>

              <Button variant="primary" type="submit" className="w-full bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-white font-extrabold py-3 shadow-xs cursor-pointer rounded-xl">
                Save Attendance Override &rarr;
              </Button>
            </form>
          </Card>
        </div>
      </div>

      {/* Section 2: Team In-Office Status Today with Date Picker */}
      <div className="space-y-4 pt-4 border-t border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800 tracking-tight flex items-center">
              <Building2 className="w-5 h-5 mr-2 text-emerald-600" /> Team In-Office & Remote Roster
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live schedule inspection across all departments for any given working date.
            </p>
          </div>
          <div className="flex items-center space-x-2 text-xs">
            <Badge variant="neutral">{officeCount} at Office HQ</Badge>
            <Badge variant="info">{remoteCount} working Remotely</Badge>
          </div>
        </div>

        <Card className="shadow-xs border-slate-200/90">
          {/* Date Picker Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80 mb-5">
            <div className="flex items-center space-x-2.5">
              <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
              <label htmlFor="roster-date-picker" className="text-xs font-extrabold uppercase tracking-wider text-slate-700 select-none">
                Inspect Date:
              </label>
              <input
                id="roster-date-picker"
                type="date"
                value={rosterDate}
                onChange={(e) => setRosterDate(e.target.value)}
                className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-900 text-xs font-mono font-bold shadow-2xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              />
            </div>
            <span className="text-xs text-slate-600 font-medium">
              Active schedule roster for <strong className="text-slate-900 font-mono font-bold">{rosterDate}</strong>
            </span>
          </div>

          {/* Employee Roster Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {teamAttendance.map((item) => {
              const { profile, mode, location, source } = item;
              return (
                <div 
                  key={profile.id} 
                  className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-extrabold text-slate-900 text-sm leading-snug">{profile.first_name} {profile.last_name}</p>
                      <p className="text-xs text-slate-500 font-medium">{profile.title || 'Team Member'}</p>
                    </div>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                      {profile.team?.name || 'Staff'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-[11px] text-slate-600 font-medium italic">{source}</span>
                    <div>
                      {mode === 'office' && (
                        <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-800 text-xs font-extrabold border border-slate-200 shadow-2xs flex items-center">
                          🏢 Office HQ
                        </span>
                      )}
                      {mode === 'remote_gr' && (
                        <span className="px-2.5 py-1 rounded-md bg-cyan-50 text-cyan-950 text-xs font-extrabold border border-cyan-200 shadow-2xs flex items-center">
                          🏠 Remote (GR)
                        </span>
                      )}
                      {mode === 'remote_abroad' && (
                        <span 
                          title={`Location: ${location || 'Logged in EU'}`}
                          className="px-2.5 py-1 rounded-md bg-blue-50 text-blue-900 text-xs font-extrabold border border-blue-200 shadow-2xs flex items-center truncate max-w-[140px]"
                        >
                          ✈️ Abroad {location ? `(${location})` : ''}
                        </span>
                      )}
                      {mode === 'weekend' && (
                        <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-500 text-xs font-medium">
                          ☕ Weekend
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
