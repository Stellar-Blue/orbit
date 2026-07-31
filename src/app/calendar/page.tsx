"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { 
  CalendarDays, ChevronLeft, ChevronRight, Filter, Search, 
  Users, Globe, MapPin, Sparkles, AlertTriangle, ShieldCheck, 
  Building2, Clock, CheckCircle2, Info, X, FileText, Calendar 
} from 'lucide-react';
import { 
  format, addMonths, subMonths, startOfMonth, endOfMonth, 
  startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, 
  isSameDay, isToday, parseISO, isWithinInterval 
} from 'date-fns';
import { Profile, LeaveRequest, RemoteDay, RemotePattern, PublicHoliday, MandatoryLeave, LeaveType } from '@/lib/types';

interface DaySchedule {
  dateStr: string;
  dateObj: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  holidays: PublicHoliday[];
  mandatoryLeaves: MandatoryLeave[];
  leaves: {
    profile: Profile;
    request: LeaveRequest;
    displayType: string;
    showDetails: boolean;
    leaveType?: LeaveType;
  }[];
  remotes: {
    profile: Profile;
    mode: 'remote_gr' | 'remote_abroad';
    location?: string;
    isOverride: boolean;
  }[];
  inOffice: {
    profile: Profile;
  }[];
}

export default function CompanyCalendarPage() {
  const { 
    currentUser, profiles, teams, leaveRequests, leaveTypes, 
    mandatoryLeaves, publicHolidays, remoteDays, remotePatterns 
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';

  // Initialize with August 2026 as default demo focus month, or current date if outside
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date(2026, 7, 1));
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | 'remote' | 'leave' | 'holiday'>('all');
  const [selectedDay, setSelectedDay] = useState<DaySchedule | null>(null);

  const activeProfiles = useMemo(() => {
    return profiles.filter(p => {
      if (p.status !== 'active') return false;
      if (selectedTeamId !== 'all' && p.team_id !== selectedTeamId && p.team?.id !== selectedTeamId) return false;
      if (searchQuery.trim() !== '') {
        const full = `${p.first_name} ${p.last_name} ${p.title || ''}`.toLowerCase();
        if (!full.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    });
  }, [profiles, selectedTeamId, searchQuery]);

  // Compute all calendar grid dates starting on Monday
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    const dates = eachDayOfInterval({ start, end });

    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return dates.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const weekdayStr = weekdayNames[date.getDay()];

      // 1. Holidays
      const hol = publicHolidays.filter(h => h.date === dateStr);

      // 2. Mandatory Leaves (Closures)
      const mandatory = mandatoryLeaves.filter(m => {
        try {
          return isWithinInterval(date, { start: parseISO(m.start_date), end: parseISO(m.end_date) });
        } catch {
          return false;
        }
      });

      const leaves: DaySchedule['leaves'] = [];
      const remotes: DaySchedule['remotes'] = [];
      const inOffice: DaySchedule['inOffice'] = [];

      // Evaluate schedule for each matched employee
      activeProfiles.forEach(prof => {
        // Exclude contractors from leave/office tele-work calculations unless explicitly found
        const isContractor = prof.employment_type === 'contractor';

        // Check if on approved/taken leave
        const activeLeave = leaveRequests.find(r => {
          if (r.profile_id !== prof.id) return false;
          if (r.status !== 'approved' && r.status !== 'in_progress' && r.status !== 'taken') return false;
          try {
            return isWithinInterval(date, { start: parseISO(r.start_date), end: parseISO(r.end_date) });
          } catch {
            return false;
          }
        });

        if (activeLeave) {
          const lType = leaveTypes.find(lt => lt.id === activeLeave.leave_type_id || lt.code === activeLeave.leave_type?.code);
          const showDetails = isAdmin || prof.id === currentUser.id;
          leaves.push({
            profile: prof,
            request: activeLeave,
            displayType: showDetails ? (lType?.name_en || 'Approved Leave') : 'Out-of-Office (OOO)',
            showDetails,
            leaveType: lType
          });
          return;
        }

        if (isContractor) return;

        // Skip non-working days (weekends) for office / remote calculations if no override
        if (weekdayStr === 'Sat' || weekdayStr === 'Sun') {
          return;
        }

        // Check daily remote override
        const override = remoteDays.find(rd => rd.profile_id === prof.id && rd.date === dateStr);
        if (override) {
          if (override.mode === 'remote_gr' || override.mode === 'remote_abroad') {
            remotes.push({
              profile: prof,
              mode: override.mode as any,
              location: override.location,
              isOverride: true
            });
            return;
          } else {
            inOffice.push({ profile: prof });
            return;
          }
        }

        // Check recurring pattern
        const pattern = remotePatterns.find(rp => rp.profile_id === prof.id && rp.weekday === weekdayStr);
        const mode = pattern ? pattern.mode : (weekdayStr === 'Tue' || weekdayStr === 'Thu' ? 'remote_gr' : 'office');
        
        if (mode === 'remote_gr' || mode === 'remote_abroad') {
          remotes.push({
            profile: prof,
            mode: mode as any,
            isOverride: false
          });
        } else {
          inOffice.push({ profile: prof });
        }
      });

      return {
        dateStr,
        dateObj: date,
        isCurrentMonth: isSameMonth(date, currentMonth),
        isToday: isSameDay(date, new Date()) || dateStr === '2026-08-05', // default demo today pointer
        holidays: hol,
        mandatoryLeaves: mandatory,
        leaves,
        remotes,
        inOffice
      } as DaySchedule;
    });
  }, [currentMonth, activeProfiles, publicHolidays, mandatoryLeaves, leaveRequests, leaveTypes, remoteDays, remotePatterns, isAdmin, currentUser.id]);

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const handleToday = () => setCurrentMonth(new Date(2026, 7, 1));

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">
      {/* Hero Header with Dynamic Background */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-[#1E3A5F] to-[#2563EB] p-8 text-white shadow-md">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-bold tracking-wider uppercase text-cyan-300">
              <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-300 animate-pulse" />
              <span>Unified Organizational Schedule</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center">
              <CalendarDays className="w-8 h-8 mr-3.5 text-cyan-400" /> Company & Team Calendar
            </h1>
            <p className="text-sm text-slate-200 max-w-2xl leading-relaxed">
              Real-time schedule synthesis integrating teleworking daily overrides, recurring weekly remote patterns, and approved leave absences with built-in §4 Privacy Lens protections.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center shrink-0">
            <Link href="/remote" className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-all flex items-center space-x-2 border border-white/20 shadow-xs">
              <Globe className="w-4 h-4 mr-1 text-cyan-300" />
              <span>Log Remote Work</span>
            </Link>
            <Link href="/leave" className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs transition-all flex items-center space-x-2 shadow-sm">
              <Calendar className="w-4 h-4 mr-1" />
              <span>Request Leave</span>
            </Link>
          </div>
        </div>
        <div className="absolute -right-10 -bottom-10 w-72 h-72 rounded-full bg-cyan-400/15 blur-3xl pointer-events-none" />
        <div className="absolute top-0 right-1/4 w-48 h-48 rounded-full bg-indigo-500/20 blur-2xl pointer-events-none" />
      </div>

      {/* Toolbar & Filter Console */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        {/* Month Navigation Controls */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center rounded-xl border border-slate-300 overflow-hidden shadow-2xs bg-slate-50/50">
            <button
              onClick={handlePrevMonth}
              className="p-2.5 text-slate-600 hover:bg-slate-200/60 hover:text-slate-950 transition-all cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-5 py-1 text-base font-extrabold text-slate-800 font-mono tracking-tight select-none">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-2.5 text-slate-600 hover:bg-slate-200/60 hover:text-slate-950 transition-all cursor-pointer"
              title="Next Month"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={handleToday}
            className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
          >
            Today (Aug &apos;26)
          </button>
        </div>

        {/* Multi-Dimensional Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Team Selector */}
          <div className="relative flex items-center">
            <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="pl-8 pr-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs"
            >
              <option value="all">All Teams & Departments</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Employee Search Input */}
          <div className="relative w-44 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter by colleague..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs font-medium rounded-xl border border-slate-300 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Event Type Toggles */}
          <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs font-semibold">
            {(['all', 'remote', 'leave', 'holiday'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setEventTypeFilter(type)}
                className={`px-3 py-1.5 rounded-lg transition-all capitalize cursor-pointer ${
                  eventTypeFilter === type
                    ? 'bg-white text-[#3D87D3] shadow-xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {type === 'all' && 'All Activity'}
                {type === 'remote' && '🏠 Telework'}
                {type === 'leave' && '🏖️ Leaves'}
                {type === 'holiday' && '🎉 Holidays'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar Grid View */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md overflow-hidden">
        {/* Weekday Column Headers */}
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80 text-center text-xs font-extrabold text-slate-600 uppercase tracking-wider py-3.5">
          <div>Monday</div>
          <div>Tuesday</div>
          <div>Wednesday</div>
          <div>Thursday</div>
          <div>Friday</div>
          <div className="text-slate-400">Saturday</div>
          <div className="text-slate-400">Sunday</div>
        </div>

        {/* Day Cells Grid */}
        <div className="grid grid-cols-7 auto-rows-[minmax(145px,_auto)] divide-x divide-y divide-slate-200/80 bg-slate-200/20">
          {calendarDays.map((day, idx) => {
            const hasHolidays = day.holidays.length > 0 || day.mandatoryLeaves.length > 0;
            const hasLeaves = day.leaves.length > 0;
            const hasRemotes = day.remotes.length > 0;

            const showHolidays = eventTypeFilter === 'all' || eventTypeFilter === 'holiday';
            const showLeaves = eventTypeFilter === 'all' || eventTypeFilter === 'leave';
            const showRemotes = eventTypeFilter === 'all' || eventTypeFilter === 'remote';

            // Collect items to display in cell
            const cellItems: React.ReactNode[] = [];

            if (showHolidays) {
              day.holidays.forEach(h => {
                cellItems.push(
                  <div key={`hol-${h.id}`} className="px-2 py-1 rounded-md bg-indigo-600 text-white text-[10px] font-extrabold truncate flex items-center shadow-2xs">
                    🎉 {h.name_en || h.name_el}
                  </div>
                );
              });
              day.mandatoryLeaves.forEach(ml => {
                cellItems.push(
                  <div key={`ml-${ml.id}`} className="px-2 py-1 rounded-md bg-purple-700 text-white text-[10px] font-extrabold truncate flex items-center shadow-2xs">
                    🔒 {ml.name}
                  </div>
                );
              });
            }

            if (showLeaves) {
              day.leaves.forEach((l, lIdx) => {
                cellItems.push(
                  <div 
                    key={`l-${l.request.id}-${lIdx}`} 
                    title={`${l.profile.first_name} ${l.profile.last_name} - ${l.displayType}`}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold truncate flex items-center border ${
                      l.showDetails 
                        ? 'bg-rose-50 text-rose-800 border-rose-200/80' 
                        : 'bg-amber-50/90 text-amber-900 border-amber-200/80'
                    }`}
                  >
                    <span className="mr-1">🏖️</span> 
                    <span className="font-extrabold mr-1">{l.profile.first_name}</span> 
                    <span className="opacity-80 font-normal">({l.displayType})</span>
                  </div>
                );
              });
            }

            if (showRemotes) {
              day.remotes.forEach((r, rIdx) => {
                cellItems.push(
                  <div 
                    key={`r-${r.profile.id}-${rIdx}`} 
                    title={`${r.profile.first_name} ${r.profile.last_name}: ${r.mode.replace('_', ' ').toUpperCase()}`}
                    className="px-2 py-0.5 rounded-md bg-cyan-50/80 text-cyan-950 border border-cyan-200/80 text-[10px] font-semibold truncate flex items-center"
                  >
                    <span className="mr-1">{r.mode === 'remote_abroad' ? '✈️' : '🏠'}</span>
                    <span className="font-bold mr-1">{r.profile.first_name}</span>
                    <span className="text-slate-500 font-normal">{r.mode === 'remote_abroad' ? `(Abroad: ${r.location || 'Logged'})` : '(Remote GR)'}</span>
                  </div>
                );
              });
            }

            const visibleItems = cellItems.slice(0, 4);
            const overflowCount = cellItems.length - visibleItems.length;

            return (
              <div
                key={day.dateStr}
                onClick={() => setSelectedDay(day)}
                className={`p-2.5 transition-colors cursor-pointer flex flex-col justify-between group ${
                  !day.isCurrentMonth
                    ? 'bg-slate-50/70 text-slate-400'
                    : day.isToday
                      ? 'bg-blue-50/30 ring-2 ring-inset ring-[#3D87D3]'
                      : 'bg-white hover:bg-slate-50/90'
                }`}
              >
                {/* Date number Top Header */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                    <Info className="w-3 h-3 mr-0.5" /> Detail
                  </span>
                  <span
                    className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                      day.isToday
                        ? 'bg-[#3D87D3] text-white font-extrabold shadow-sm'
                        : day.isCurrentMonth
                          ? 'text-slate-800 group-hover:bg-slate-200/70'
                          : 'text-slate-400'
                    }`}
                  >
                    {format(day.dateObj, 'd')}
                  </span>
                </div>

                {/* Event Chips Stack */}
                <div className="space-y-1 overflow-hidden flex-1">
                  {visibleItems}
                  {overflowCount > 0 && (
                    <div className="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 text-center transition-colors border border-slate-200">
                      +{overflowCount} more event{overflowCount > 1 ? 's' : ''}...
                    </div>
                  )}
                  {cellItems.length === 0 && day.isCurrentMonth && (
                    <div className="h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] text-slate-300 italic">Office routine</span>
                    </div>
                  )}
                </div>

                {/* Footer tally badge for Office Headcount */}
                {day.isCurrentMonth && (day.inOffice.length > 0) && (
                  <div className="mt-2 pt-1 border-t border-slate-100 text-[9px] font-medium text-slate-400 flex items-center justify-between">
                    <span>🏢 Office HQ</span>
                    <span className="font-bold text-slate-600">{day.inOffice.length} on-site</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend & Privacy Lens Disclaimer Footer */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-xs text-xs text-slate-600">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-cyan-500 shrink-0" />
          <div>
            <span className="font-bold text-slate-800 block">🏠 Remote Telework</span>
            <span className="text-[11px] text-slate-500">Includes daily overrides & weekly patterns</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-rose-500 shrink-0" />
          <div>
            <span className="font-bold text-slate-800 block">🏖️ Approved Leave</span>
            <span className="text-[11px] text-slate-500">Vacation, personal, or sick absence</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-indigo-600 shrink-0" />
          <div>
            <span className="font-bold text-slate-800 block">🎉 Holidays & Closures</span>
            <span className="text-[11px] text-slate-500">Public civic dates & mandatory leave</span>
          </div>
        </div>
        <div className="flex items-start space-x-2 border-l border-slate-200 pl-4">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-[11px] text-slate-500 leading-tight">
            <span className="font-bold text-slate-700 block">§4 Operational Privacy Lens Active</span>
            Peers see &quot;Out-of-Office&quot; for medical/personal absences. Full details visible exclusively to Admins and self.
          </div>
        </div>
      </div>

      {/* Interactive Day Details Modal / Slide-Over */}
      {selectedDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-r from-slate-900 to-[#1E3A5F] text-white flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase text-cyan-300 tracking-wider flex items-center mb-1">
                  <Clock className="w-3.5 h-3.5 mr-1" /> Daily Roster Breakdown
                </span>
                <h3 className="text-xl font-bold font-mono">
                  {format(selectedDay.dateObj, 'EEEE, MMMM d, yyyy')}
                </h3>
              </div>
              <button
                onClick={() => setSelectedDay(null)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content - Scrollable */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {/* Holidays or Mandatory Closures */}
              {(selectedDay.holidays.length > 0 || selectedDay.mandatoryLeaves.length > 0) && (
                <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200/80 space-y-2">
                  <h4 className="font-bold text-indigo-950 flex items-center text-sm">
                    <Sparkles className="w-4 h-4 mr-1.5 text-indigo-600" /> Active Holiday or Mandatory Closure
                  </h4>
                  <ul className="space-y-1 text-indigo-900">
                    {selectedDay.holidays.map(h => (
                      <li key={h.id} className="font-semibold">&bull; Public Holiday: {h.name_en || h.name_el}</li>
                    ))}
                    {selectedDay.mandatoryLeaves.map(m => (
                      <li key={m.id} className="font-semibold">&bull; Company Mandatory Break: {m.name} ({m.note})</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Away on Leave Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h4 className="font-bold text-slate-800 text-sm flex items-center">
                    <span className="mr-2 text-base">🏖️</span> Away on Leave / OOO ({selectedDay.leaves.length})
                  </h4>
                  <Badge variant={selectedDay.leaves.length > 0 ? 'warning' : 'neutral'}>
                    {selectedDay.leaves.length} staff away
                  </Badge>
                </div>
                {selectedDay.leaves.length === 0 ? (
                  <p className="text-slate-400 italic py-1">No staff members are on approved leave for this date.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedDay.leaves.map((l, idx) => (
                      <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800">{l.profile.first_name} {l.profile.last_name}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{l.profile.team?.name || 'Staff'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                            {l.displayType}
                          </span>
                          {l.showDetails && l.request.note && (
                            <span className="text-[10px] text-slate-500 italic truncate max-w-[120px]" title={l.request.note}>
                              &ldquo;{l.request.note}&rdquo;
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Working Remotely Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h4 className="font-bold text-slate-800 text-sm flex items-center">
                    <span className="mr-2 text-base">🏠</span> Working Remotely ({selectedDay.remotes.length})
                  </h4>
                  <Badge variant={selectedDay.remotes.length > 0 ? 'info' : 'neutral'}>
                    {selectedDay.remotes.length} teleworking
                  </Badge>
                </div>
                {selectedDay.remotes.length === 0 ? (
                  <p className="text-slate-400 italic py-1">No remote workers recorded for this date.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedDay.remotes.map((r, idx) => (
                      <div key={idx} className="p-3 rounded-xl bg-cyan-50/50 border border-cyan-200/60 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800 flex items-center">
                            {r.mode === 'remote_abroad' ? <Globe className="w-3.5 h-3.5 mr-1 text-blue-600" /> : <MapPin className="w-3.5 h-3.5 mr-1 text-cyan-600" />}
                            {r.profile.first_name} {r.profile.last_name}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">{r.profile.team?.name || 'Staff'}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-cyan-800 capitalize">
                            {r.mode === 'remote_abroad' ? `Abroad: ${r.location || 'International'}` : 'Remote (Greece)'}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-white rounded border border-slate-200 text-slate-600">
                            {r.isOverride ? 'Daily Log' : 'Weekly Pattern'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* In Office HQ Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h4 className="font-bold text-slate-800 text-sm flex items-center">
                    <span className="mr-2 text-base">🏢</span> On-Site at Office HQ ({selectedDay.inOffice.length})
                  </h4>
                  <Badge variant="neutral">
                    {selectedDay.inOffice.length} present at HQ
                  </Badge>
                </div>
                {selectedDay.inOffice.length === 0 ? (
                  <p className="text-slate-400 italic py-1">No regular on-site staff scheduled for this date (e.g. weekend or full remote day).</p>
                ) : (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedDay.inOffice.map((o, idx) => (
                      <div key={idx} className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold flex items-center">
                        <Building2 className="w-3 h-3 mr-1 text-slate-500" />
                        <span>{o.profile.first_name} {o.profile.last_name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 font-medium">
                Showing schedules synced live from PostgreSQL.
              </span>
              <div className="flex items-center space-x-2">
                <Link
                  href="/remote"
                  onClick={() => setSelectedDay(null)}
                  className="px-4 py-2 rounded-xl bg-[#3D87D3] hover:bg-blue-600 text-white font-bold text-xs transition-all flex items-center shadow-xs"
                >
                  <Globe className="w-3.5 h-3.5 mr-1.5" />
                  <span>Log Override for Date</span>
                </Link>
                <button
                  onClick={() => setSelectedDay(null)}
                  className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs transition-all cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
