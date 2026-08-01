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
        // Exclude contractors from leave/office remote work calculations unless explicitly found
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

        // Check declared remote work in remoteDays (patterns are now only an auto-fill helper)
        const override = remoteDays.find(rd => rd.profile_id === prof.id && rd.date === dateStr);
        if (override && (override.mode === 'remote_gr' || override.mode === 'remote_abroad')) {
          remotes.push({
            profile: prof,
            mode: override.mode as any,
            location: override.location,
            isOverride: true
          });
        } else {
          inOffice.push({ profile: prof });
        }
      });

      return {
        dateStr,
        dateObj: date,
        isCurrentMonth: isSameMonth(date, currentMonth),
        isToday: isSameDay(date, new Date()),
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
  const handleToday = () => setCurrentMonth(new Date());

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
              Real-time schedule synthesis integrating remote working daily overrides, recurring weekly remote patterns, and approved leave absences with built-in §4 Privacy Lens protections.
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
            Today ({format(new Date(), "MMM &apos;yy")})
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
                {type === 'remote' && '🏠 Remote'}
                {type === 'leave' && '🏖️ Leaves'}
                {type === 'holiday' && '🎉 Holidays'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar Grid View with Mobile Swipe Overflow */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md overflow-x-auto">
        <div className="min-w-[850px] w-full">
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

        {/* Day Cells Grid - Solid Spanning Week-Row Architecture */}
        <div className="flex flex-col bg-slate-200/20 divide-y divide-slate-200/80 border-b border-slate-200/80">
          {(() => {
            const weeks: typeof calendarDays[] = [];
            for (let i = 0; i < calendarDays.length; i += 7) {
              weeks.push(calendarDays.slice(i, i + 7));
            }

            return weeks.map((weekDays, wIdx) => {
              const weekStartStr = weekDays[0]?.dateStr || '';
              const weekEndStr = weekDays[weekDays.length - 1]?.dateStr || '';

              const showHolidays = eventTypeFilter === 'all' || eventTypeFilter === 'holiday';
              const showLeaves = eventTypeFilter === 'all' || eventTypeFilter === 'leave';
              const showRemotes = eventTypeFilter === 'all' || eventTypeFilter === 'remote';

              // Collect unique spanning holidays in this week
              const weekHolidays = showHolidays ? publicHolidays.filter(h => h.date >= weekStartStr && h.date <= weekEndStr) : [];
              // Collect unique mandatory leaves in this week
              const weekMandatory = showHolidays ? mandatoryLeaves.filter(m => !(m.end_date < weekStartStr || m.start_date > weekEndStr)) : [];
              
              // Collect unique approved employee leave requests that overlap this week
              const weekLeaveRequests = showLeaves ? leaveRequests.filter(r => 
                r.origin !== 'mandatory' &&
                (r.status === 'approved' || r.status === 'in_progress' || r.status === 'taken') &&
                !(r.end_date < weekStartStr || r.start_date > weekEndStr) &&
                activeProfiles.some(p => p.id === r.profile_id && p.employment_type !== 'contractor')
              ) : [];

              return (
                <div key={wIdx} className="relative min-h-[155px] border-b border-slate-200/80 last:border-b-0 flex flex-col">
                  {/* Layer 1: Background Interactive Day Grid */}
                  <div className="absolute inset-0 grid grid-cols-7 divide-x divide-slate-200/80 pointer-events-auto">
                    {weekDays.map(day => (
                      <div
                        key={day.dateStr}
                        onClick={() => setSelectedDay(day)}
                        className={`h-full transition-colors cursor-pointer group ${
                          !day.isCurrentMonth
                            ? 'bg-slate-50/70 text-slate-400'
                            : day.isToday
                              ? 'bg-blue-50/30 ring-2 ring-inset ring-[#3D87D3]'
                              : 'bg-white hover:bg-slate-50/90'
                        }`}
                      />
                    ))}
                  </div>

                  {/* Layer 2: Foreground Content */}
                  <div className="relative z-10 pointer-events-none pb-2 flex flex-col justify-start flex-1">
                    {/* Date Numeral Header */}
                    <div className="grid grid-cols-7 pt-2 px-2 mb-1">
                      {weekDays.map(day => (
                        <div key={day.dateStr} className="flex items-center justify-between h-6 pointer-events-auto" onClick={() => setSelectedDay(day)}>
                          <span className="text-[10px] text-slate-400 font-medium opacity-0 hover:opacity-100 transition-opacity flex items-center cursor-pointer">
                            <Info className="w-3 h-3 mr-0.5" /> Detail
                          </span>
                          <span
                            className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                              day.isToday
                                ? 'bg-[#3D87D3] text-white font-extrabold shadow-sm'
                                : day.isCurrentMonth
                                  ? 'text-slate-800'
                                  : 'text-slate-400'
                            }`}
                          >
                            {format(day.dateObj, 'd')}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Spanning Event Tracks (Holidays, Closures, Multi-day Leaves) */}
                    <div className="space-y-1 mb-1.5 flex flex-col">
                      {/* Public Holidays */}
                      {weekHolidays.map(h => {
                        const idx = weekDays.findIndex(d => d.dateStr === h.date);
                        if (idx === -1) return null;
                        const startCol = idx + 1;
                        return (
                          <div key={`hol-${h.date}`} className="grid grid-cols-7 px-1 pointer-events-auto">
                            <div
                              style={{ gridColumn: `${startCol} / span 1` }}
                              className="py-1 px-2 rounded-md bg-indigo-600 text-white text-[11px] font-extrabold truncate flex items-center shadow-2xs"
                              title={h.name_en || h.name_el}
                            >
                              <span className="mr-1.5">🎉</span>
                              <span className="truncate">{h.name_en || h.name_el}</span>
                            </div>
                          </div>
                        );
                      })}

                      {/* Mandatory Closures */}
                      {weekMandatory.map((m, mIdx) => {
                        let startCol = 1;
                        let endCol = 7;
                        let isActualStart = false;
                        let isActualEnd = false;

                        if (m.start_date >= weekStartStr) {
                          const idx = weekDays.findIndex(d => d.dateStr >= m.start_date);
                          if (idx !== -1) { startCol = idx + 1; isActualStart = true; }
                        }
                        if (m.end_date <= weekEndStr) {
                          const idx = weekDays.findIndex(d => d.dateStr >= m.end_date);
                          if (idx !== -1) { endCol = idx + 1; isActualEnd = true; }
                          else { endCol = weekDays.findIndex(d => d.dateStr <= m.end_date) + 1; isActualEnd = true; }
                        }
                        const span = Math.max(1, endCol - startCol + 1);

                        return (
                          <div key={`ml-${m.id || mIdx}`} className="grid grid-cols-7 px-1 pointer-events-auto">
                            <div
                              style={{ gridColumn: `${startCol} / span ${span}` }}
                              className={`py-1.5 px-2.5 rounded-md bg-purple-700 text-white text-[11px] font-extrabold truncate flex items-center shadow-xs ${
                                isActualStart && isActualEnd ? 'rounded-lg' :
                                isActualStart ? 'rounded-l-lg rounded-r-none pr-1' :
                                isActualEnd ? 'rounded-r-lg rounded-l-none pl-1' :
                                'rounded-none px-1'
                              }`}
                              title={`Company Closure: ${m.name}`}
                            >
                              <span className="mr-1.5">🔒</span>
                              <span className="truncate">{m.name}</span>
                            </div>
                          </div>
                        );
                      })}

                      {/* Employee Leaves Spanning Ribbons */}
                      {weekLeaveRequests.map(req => {
                        const prof = activeProfiles.find(p => p.id === req.profile_id);
                        if (!prof) return null;
                        const lType = leaveTypes.find(lt => lt.id === req.leave_type_id || lt.code === req.leave_type?.code);
                        const showDetails = isAdmin || prof.id === currentUser.id;
                        const displayType = showDetails ? (lType?.name_en || 'Approved Leave') : 'Out-of-Office (OOO)';

                        let startCol = 1;
                        let endCol = 7;
                        let isActualStart = false;
                        let isActualEnd = false;

                        if (req.start_date >= weekStartStr) {
                          const idx = weekDays.findIndex(d => d.dateStr >= req.start_date);
                          if (idx !== -1) { startCol = idx + 1; isActualStart = true; }
                        }
                        if (req.end_date <= weekEndStr) {
                          const idx = weekDays.findIndex(d => d.dateStr >= req.end_date);
                          if (idx !== -1) { endCol = idx + 1; isActualEnd = true; }
                          else { endCol = weekDays.findIndex(d => d.dateStr <= req.end_date) + 1; isActualEnd = true; }
                        }
                        const span = Math.max(1, endCol - startCol + 1);

                        return (
                          <div key={`lr-${req.id}`} className="grid grid-cols-7 px-1 pointer-events-auto">
                            <div
                              style={{ gridColumn: `${startCol} / span ${span}` }}
                              className={`py-1 px-2 text-[11px] font-bold truncate flex items-center justify-between border shadow-2xs transition-transform hover:scale-[1.01] ${
                                showDetails 
                                  ? 'bg-rose-50 text-rose-950 border-rose-300/80 font-extrabold' 
                                  : 'bg-amber-50/95 text-amber-950 border-amber-300/80 font-bold'
                              } ${
                                isActualStart && isActualEnd ? 'rounded-md' :
                                isActualStart ? 'rounded-l-md rounded-r-none pr-1 border-r border-dashed border-rose-300' :
                                isActualEnd ? 'rounded-r-md rounded-l-none pl-1 border-l border-dashed border-rose-300' :
                                'rounded-none px-1 border-l border-r border-dashed border-rose-300'
                              }`}
                              title={`${prof.first_name} ${prof.last_name} — ${displayType} (${req.start_date} to ${req.end_date})`}
                            >
                              <div className="flex items-center truncate">
                                <span className="mr-1.5">🏖️</span>
                                <span className="font-extrabold mr-1.5">{prof.first_name} {prof.last_name}</span>
                                <span className="opacity-80 font-medium">({displayType})</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Daily Specific Cell Content (Remotes & In-Office Tallies) */}
                    <div className="grid grid-cols-7 px-1 flex-1 gap-x-1">
                      {weekDays.map(day => {
                        const cellItems: React.ReactNode[] = [];
                        if (showRemotes) {
                          day.remotes.forEach((r, rIdx) => {
                            cellItems.push(
                              <div
                                key={`r-${r.profile.id}-${rIdx}`}
                                title={`${r.profile.first_name} ${r.profile.last_name}: ${r.mode.replace('_', ' ').toUpperCase()}`}
                                className="px-2 py-0.5 my-0.5 rounded-md bg-cyan-50/90 text-cyan-950 border border-cyan-200/80 text-[10px] font-semibold truncate flex items-center shadow-2xs pointer-events-auto"
                              >
                                <span className="mr-1">{r.mode === 'remote_abroad' ? '✈️' : '🏠'}</span>
                                <span className="font-bold mr-1">{r.profile.first_name}</span>
                                <span className="text-slate-500 font-normal">{r.mode === 'remote_abroad' ? `(Abroad)` : '(Remote GR)'}</span>
                              </div>
                            );
                          });
                        }

                        const visibleItems = cellItems.slice(0, 3);
                        const overflowCount = cellItems.length - visibleItems.length;

                        return (
                          <div key={`daily-${day.dateStr}`} className="flex flex-col justify-between overflow-hidden">
                            <div className="space-y-0.5">
                              {visibleItems}
                              {overflowCount > 0 && (
                                <div className="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 text-center transition-colors border border-slate-200 pointer-events-auto cursor-pointer" onClick={() => setSelectedDay(day)}>
                                  +{overflowCount} more...
                                </div>
                              )}
                            </div>
                            {day.isCurrentMonth && day.inOffice.length > 0 && (
                              <div className="mt-2 pt-1 border-t border-slate-200/80 text-[9px] font-medium text-slate-400 flex items-center justify-between px-1 pointer-events-auto">
                                <span>🏢 Office HQ</span>
                                <span className="font-extrabold text-slate-700">{day.inOffice.length} on-site</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
        </div>
      </div>

      {/* Legend & Privacy Lens Disclaimer Footer */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-xs text-xs text-slate-600">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-cyan-500 shrink-0" />
          <div>
            <span className="font-bold text-slate-800 block">🏠 Remote Work</span>
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
                    {selectedDay.remotes.length} remote
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
