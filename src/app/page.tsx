"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { roleLabel } from '@/lib/profile-role';
import { 
  format, startOfWeek, endOfWeek, addMonths, subMonths, addDays, subDays, addWeeks, subWeeks,
  startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, 
  isSameDay, parseISO, isWithinInterval 
} from 'date-fns';
import { Card, StatCard, Badge, Button } from '@/components/ui/primitives';
import { CarryoverWarning } from '@/components/leave/carryover-warning';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import {
  Users, Calendar as CalendarIcon, DollarSign, AlertTriangle,
  Clock, MapPin, Sparkles, Plus,
  CalendarDays, ChevronLeft, ChevronRight, Search, Globe,
  ShieldCheck, Info, X, RefreshCw
} from 'lucide-react';
import { Profile, PublicHoliday, MandatoryLeave, CompanyCalendarSpan } from '@/lib/types';
import { getContractNoticeStatus, NOTICE_ALERT_WINDOW_DAYS } from '@/lib/pricing-engine';
import { loadedMonthlyCost, isBaseSalary, loadedExtraCost } from '@/lib/compensation';
import { formatDate, formatDateTime } from '@/lib/date';


const CALENDAR_VIEWS = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'team', label: 'Team' },
] as const;

type CalendarViewKey = (typeof CALENDAR_VIEWS)[number]['key'];

interface DaySchedule {
  dateStr: string;
  dateObj: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  holidays: PublicHoliday[];
  mandatoryLeaves: MandatoryLeave[];
  leaves: {
    profile: Profile;
    leave_request_id: string | null;
    start_date: string;
    end_date: string;
    displayType: string;
    /** True only when the viewer may read the request row, i.e. an admin or the owner. */
    showDetails: boolean;
    note?: string;
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
  birthdays: Profile[];
}

/** One day's roster, shared by the Day view and the click-through modal. */
function DayAgenda({ day }: { day: DaySchedule }) {
  return (
    <>
      {day.birthdays.length > 0 && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-amber-50 to-rose-50 border border-amber-200/80 space-y-2">
          <h4 className="font-extrabold text-amber-950 flex items-center text-sm">
            <span className="mr-1.5 text-base">🎂</span> Birthday Celebrations for This Date
          </h4>
          <ul className="space-y-1 text-amber-900 font-bold">
            {day.birthdays.map(b => (
              <li key={b.id}>&bull; Happy Birthday to {b.first_name} {b.last_name}! 🎉</li>
            ))}
          </ul>
        </div>
      )}

      {(day.holidays.length > 0 || day.mandatoryLeaves.length > 0) && (
        <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200/80 space-y-2">
          <h4 className="font-bold text-indigo-950 flex items-center text-sm">
            <Sparkles className="w-4 h-4 mr-1.5 text-indigo-600" /> Active Holiday or Mandatory Closure
          </h4>
          <ul className="space-y-1 text-indigo-900">
            {day.holidays.map(h => (
              <li key={h.id} className="font-semibold">&bull; Public Holiday: {h.name_en || h.name_el}</li>
            ))}
            {day.mandatoryLeaves.map(m => (
              <li key={m.id} className="font-semibold">&bull; Company Mandatory Break: {m.name} ({m.note})</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <h4 className="font-bold text-slate-800 text-sm flex items-center">
            <span className="mr-2 text-base">🏖️</span> Away on Leave / OOO ({day.leaves.length})
          </h4>
          <Badge variant={day.leaves.length > 0 ? 'warning' : 'neutral'} className="font-extrabold">
            {day.leaves.length} staff away
          </Badge>
        </div>
        {day.leaves.length === 0 ? (
          <p className="text-slate-400 italic py-1">No staff members are on approved leave for this date.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {day.leaves.map((l, idx) => (
              <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-2 font-extrabold text-slate-800">
                    <ProfileAvatar photoUrl={l.profile.photo_url} firstName={l.profile.first_name} lastName={l.profile.last_name} size="sm" />
                    <span className="truncate">{l.profile.first_name} {l.profile.last_name}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono font-bold">{l.profile.team?.name || 'Staff'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                    {l.displayType}
                  </span>
                  {l.showDetails && l.note && (
                    <span className="text-[10px] text-slate-500 italic truncate max-w-[120px]" title={l.note}>
                      &ldquo;{l.note}&rdquo;
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <h4 className="font-bold text-slate-800 text-sm flex items-center">
            <span className="mr-2 text-base">🏠</span> Working Remotely ({day.remotes.length})
          </h4>
          <Badge variant={day.remotes.length > 0 ? 'info' : 'neutral'} className="font-extrabold">
            {day.remotes.length} remote
          </Badge>
        </div>
        {day.remotes.length === 0 ? (
          <p className="text-slate-400 italic py-1">No remote workers recorded for this date.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {day.remotes.map((r, idx) => (
              <div key={idx} className="p-3 rounded-xl bg-cyan-50/50 border border-cyan-200/60 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-2 font-extrabold text-slate-800">
                    <ProfileAvatar photoUrl={r.profile.photo_url} firstName={r.profile.first_name} lastName={r.profile.last_name} size="sm" />
                    <span className="flex min-w-0 items-center truncate">
                      {r.mode === 'remote_abroad' ? <Globe className="w-3.5 h-3.5 mr-1 shrink-0 text-blue-600" /> : <MapPin className="w-3.5 h-3.5 mr-1 shrink-0 text-cyan-600" />}
                      <span className="truncate">{r.profile.first_name} {r.profile.last_name}</span>
                    </span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono font-bold">{r.profile.team?.name || 'Staff'}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-cyan-800 capitalize">
                    {r.mode === 'remote_abroad' ? `Other City: ${r.location || 'Not declared'}` : 'Remote (Greece)'}
                  </span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-white rounded border border-slate-200 text-slate-600">
                    {r.isOverride ? 'Daily Log' : 'Weekly Pattern'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <h4 className="font-bold text-slate-800 text-sm flex items-center">
            <span className="mr-2 text-base">🏢</span> On-Site at Office HQ ({day.inOffice.length})
          </h4>
          <Badge variant="neutral" className="font-extrabold">
            {day.inOffice.length} present at HQ
          </Badge>
        </div>
        {day.inOffice.length === 0 ? (
          <p className="text-slate-400 italic py-1">No regular on-site staff scheduled for this date (e.g. weekend or full remote day).</p>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {day.inOffice.map((o, idx) => (
              <div key={idx} className="flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 py-0.5 pl-0.5 pr-3 text-slate-700 text-xs font-bold">
                <ProfileAvatar photoUrl={o.profile.photo_url} firstName={o.profile.first_name} lastName={o.profile.last_name} size="xs" />
                <span>{o.profile.first_name} {o.profile.last_name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { 
    currentUser, profiles, teams, contracts, leaveRequests, leaveTypes, 
    entitlements, salaries, companyCalendar, ensureCompanyCalendar,
    mandatoryLeaves, publicHolidays, getEmployeeLeaveBalance, integrationExceptions, integrationLastReconciledAt,
    profileRoleHistory, jobRoles, seniorityLevels
  } = useAuth();
  
  const isAdmin = currentUser.role === 'admin';
  const isContractor = currentUser.employment_type === 'contractor';

  // --- 1. BIRTHDAY CELEBRATION ENGINE ---
  const todayMonthDay = useMemo(() => format(new Date(), 'MM-dd'), []);
  const todayBirthdays = useMemo(() => {
    return profiles.filter(p => {
      if (p.status !== 'active') return false;
      const bDate = p.sensitive?.birth_date || (p as any).birth_date;
      if (!bDate) return false;
      return bDate.endsWith(todayMonthDay) || bDate.slice(5) === todayMonthDay;
    });
  }, [profiles, todayMonthDay]);

  // --- 2. ADMIN EXECUTIVE METRICS ---
  const totalHeadcount = profiles.filter(p => p.status === 'active').length;
  const fullTimeCount = profiles.filter(p => p.status === 'active' && p.employment_type === 'full_time').length;
  const contractorCount = profiles.filter(p => p.status === 'active' && p.employment_type === 'contractor').length;
  
  const monthlyCost = salaries.reduce((acc, sal) => {
    if (sal.valid_to) return acc;
    // Base rates carry their own employer cost; contractual extras inherit the employee's base ratio.
    return acc + (isBaseSalary(sal)
      ? loadedMonthlyCost(sal)
      : loadedExtraCost(salaries, sal.profile_id, Number(sal.gross_amount) || 0));
  }, 0);

  const urgentContracts = contracts.filter(c => getContractNoticeStatus(c).isUrgent).slice(0, 5);
  const pendingLeaves = leaveRequests.filter(r => r.status === 'pending');

  // --- 3. EMPLOYEE LEAVE HELPER ---
  // One source of truth with Leave Management: entitlement + carry-over minus taken, pending and
  // mandatory-closure days. Never recompute the total here — the two screens used to disagree.
  const leaveYear = new Date().getFullYear();
  const myBalance = useMemo(
    () => getEmployeeLeaveBalance(currentUser.id, leaveYear),
    [currentUser.id, leaveYear, getEmployeeLeaveBalance, leaveRequests, entitlements]
  );
  /** True when the year is still running on the company default (no per-employee row configured). */
  const usesDefaultEntitlement = !entitlements.some(e => e.profile_id === currentUser.id && e.year === leaveYear);

  // --- 4. UNIFIED CALENDAR GRID STATE & ENGINE ---
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date()); // opens on today, i.e. this week
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | 'remote' | 'leave' | 'holiday'>('all');
  const [selectedDay, setSelectedDay] = useState<DaySchedule | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarViewKey>('week');

  const activeProfiles = useMemo(() => {
    return profiles.filter(p => {
      if (p.status !== 'active') return false;
      if (selectedTeamId !== 'all' && p.team_id !== selectedTeamId && p.team?.id !== selectedTeamId) return false;
      if (searchQuery.trim() !== '') {
        const full = `${p.first_name} ${p.last_name}`.toLowerCase();
        if (!full.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    });
  }, [profiles, selectedTeamId, searchQuery]);

  // The days each view draws, and the window the calendar data is fetched for.
  const viewWindow = useMemo(() => {
    if (calendarView === 'day') {
      return { start: anchorDate, end: anchorDate };
    }
    if (calendarView === 'week') {
      return {
        start: startOfWeek(anchorDate, { weekStartsOn: 1 }),
        end: endOfWeek(anchorDate, { weekStartsOn: 1 }),
      };
    }
    return {
      start: startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 1 }),
    };
  }, [calendarView, anchorDate]);
  const gridFrom = format(viewWindow.start, 'yyyy-MM-dd');
  const gridTo = format(viewWindow.end, 'yyyy-MM-dd');
  useEffect(() => {
    void ensureCompanyCalendar(gridFrom, gridTo);
  }, [gridFrom, gridTo, ensureCompanyCalendar]);

  const companyLeaves = useMemo(
    () => companyCalendar.filter(span => span.kind === 'leave'),
    [companyCalendar]
  );
  const companyLeavesByProfile = useMemo(() => {
    const byProfile = new Map<string, CompanyCalendarSpan[]>();
    companyLeaves.forEach(span => {
      const spans = byProfile.get(span.profile_id);
      if (spans) {
        spans.push(span);
      } else {
        byProfile.set(span.profile_id, [span]);
      }
    });
    return byProfile;
  }, [companyLeaves]);
  const companyRemoteDayByProfile = useMemo(() => {
    const byProfileDay = new Map<string, CompanyCalendarSpan>();
    companyCalendar.forEach(span => {
      if (span.kind !== 'remote') return;
      byProfileDay.set(`${span.profile_id}|${span.start_date}`, span);
    });
    return byProfileDay;
  }, [companyCalendar]);
  const leaveRequestById = useMemo(
    () => new Map(leaveRequests.map(request => [request.id, request])),
    [leaveRequests]
  );
  // The request row (and with it the leave type and note) is only returned for admins and the
  // owner; everyone else sees the span as plain "Out-of-Office".
  const leaveDisplayById = useMemo(() => {
    const byRequest = new Map<string, { displayType: string; note?: string }>();
    companyLeaves.forEach(span => {
      if (!span.leave_request_id) return;
      const request = leaveRequestById.get(span.leave_request_id);
      if (!request) return;
      const type = leaveTypes.find(lt => lt.id === request.leave_type_id);
      byRequest.set(span.leave_request_id, {
        displayType: type?.name_en || 'Approved Leave',
        note: request.note,
      });
    });
    return byRequest;
  }, [companyLeaves, leaveRequestById, leaveTypes]);

  const calendarDays = useMemo(() => {
    // Only the month grid greys the spill-over days of the neighbouring months; a day or week
    // view shows every day it draws as current.
    const monthGrid = calendarView === 'month' || calendarView === 'team';
    const dates = eachDayOfInterval(viewWindow);
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return dates.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const weekdayStr = weekdayNames[date.getDay()];
      const mDayStr = dateStr.slice(5);

      const birthdays = activeProfiles.filter(p => {
        const bDate = p.sensitive?.birth_date || (p as any).birth_date;
        return bDate && (bDate.endsWith(mDayStr) || bDate.slice(5) === mDayStr);
      });

      const hol = publicHolidays.filter(h => h.date === dateStr);
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

      activeProfiles.forEach(prof => {
        const isContract = prof.employment_type === 'contractor';
        const activeLeave = companyLeavesByProfile.get(prof.id)?.find(span => {
          try {
            return isWithinInterval(date, { start: parseISO(span.start_date), end: parseISO(span.end_date) });
          } catch {
            return false;
          }
        });

        if (activeLeave) {
          const known = activeLeave.leave_request_id
            ? leaveDisplayById.get(activeLeave.leave_request_id)
            : undefined;
          leaves.push({
            profile: prof,
            leave_request_id: activeLeave.leave_request_id,
            start_date: activeLeave.start_date,
            end_date: activeLeave.end_date,
            displayType: known ? known.displayType : 'Out-of-Office (OOO)',
            showDetails: !!known,
            note: known?.note,
          });
          return;
        }

        if (isContract || weekdayStr === 'Sat' || weekdayStr === 'Sun') return;

        const remoteSpan = companyRemoteDayByProfile.get(`${prof.id}|${dateStr}`);
        if (remoteSpan) {
          remotes.push({
            profile: prof,
            mode: remoteSpan.mode as 'remote_gr' | 'remote_abroad',
            location: remoteSpan.location ?? undefined,
            isOverride: true
          });
        } else {
          inOffice.push({ profile: prof });
        }
      });

      return {
        dateStr,
        dateObj: date,
        isCurrentMonth: monthGrid ? isSameMonth(date, anchorDate) : true,
        isToday: isSameDay(date, new Date()),
        holidays: hol,
        mandatoryLeaves: mandatory,
        leaves,
        remotes,
        inOffice,
        birthdays
      } as DaySchedule;
    });
  }, [viewWindow, calendarView, anchorDate, activeProfiles, publicHolidays, mandatoryLeaves, companyLeavesByProfile, leaveDisplayById, companyRemoteDayByProfile]);

  const currentMonthDays = useMemo(() => {
    return calendarDays.filter(d => d.isCurrentMonth);
  }, [calendarDays]);
  const dayEntry = calendarDays[0];

  const periodLabel = calendarView === 'day'
    ? format(anchorDate, 'EEEE, d MMM yyyy')
    : calendarView === 'week'
      ? `${format(viewWindow.start, 'd MMM')} – ${format(viewWindow.end, 'd MMM yyyy')}`
      : format(anchorDate, 'MMMM yyyy');

  const shiftPeriod = (direction: 1 | -1) => {
    setAnchorDate(prev => {
      if (calendarView === 'day') {
        return direction === 1 ? addDays(prev, 1) : subDays(prev, 1);
      }
      if (calendarView === 'week') {
        return direction === 1 ? addWeeks(prev, 1) : subWeeks(prev, 1);
      }
      // Step from the 1st, so a month hop cannot drift the day of month (Jan 31 → Feb 28 → Mar 28).
      const monthStart = startOfMonth(prev);
      return direction === 1 ? addMonths(monthStart, 1) : subMonths(monthStart, 1);
    });
  };
  const handlePrevPeriod = () => shiftPeriod(-1);
  const handleNextPeriod = () => shiftPeriod(1);
  const handleToday = () => setAnchorDate(new Date());
  // Each view opens on its own default period rather than inheriting the previous view's date.
  const selectView = (view: CalendarViewKey) => {
    setCalendarView(view);
    setAnchorDate(new Date());
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-200 pb-24">
      {/* 1. Today's Birthday Celebration Banner (If Any) */}
      {todayBirthdays.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 via-rose-500 to-purple-600 p-6 text-white shadow-lg animate-in fade-in duration-300">
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-4">
              <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-3xl shadow-sm shrink-0">
                🎂
              </div>
              <div>
                <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-md border border-white/25 text-[11px] font-black uppercase tracking-wider text-white mb-1">
                  <Sparkles className="w-3 h-3 text-amber-200 animate-pulse" />
                  <span>StellarBlue Celebration Today</span>
                </div>
                <h2 className="text-xl font-semibold text-white tracking-tight">
                  Happy Birthday, {todayBirthdays.map(p => `${p.first_name} ${p.last_name}`).join(" & ")}! 🎉
                </h2>
                <p className="text-xs text-white/90 font-medium mt-0.5">
                  Wishing our incredible teammate{todayBirthdays.length > 1 ? 's' : ''} a fantastic year ahead! Be sure to send your best wishes in Slack!
                </p>
              </div>
            </div>
            <Link href="/people" className="px-4 py-2.5 rounded-xl bg-white text-slate-900 font-black text-xs hover:bg-slate-100 transition-all shadow-sm shrink-0 self-start sm:self-center">
              Send Wishes &rarr;
            </Link>
          </div>
          <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/15 blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-48 h-48 rounded-full bg-amber-300/20 blur-2xl pointer-events-none" />
        </div>
      )}

      {/* 2. Welcome & Context Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white px-5 py-4 rounded-[var(--radius-card)] border border-[var(--line)]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="ui-title">{currentUser.first_name ? `Welcome back, ${currentUser.first_name}` : 'Welcome back'}</h1>
            <Badge variant="neutral">{roleLabel(currentUser, profileRoleHistory, jobRoles, seniorityLevels)}</Badge>
          </div>
          <p className="text-[13px] text-[var(--ink-3)] mt-1">
            {isAdmin
              ? 'Attendance, rosters, leave and contract operations at a glance.'
              : 'Your schedules, attendance and time off in one place.'}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          {!isContractor && (
            <>
              <Link href="/remote">
                <Button variant="secondary" className="cursor-pointer">
                  <Globe className="w-3.5 h-3.5 mr-1.5" /> Log remote work
                </Button>
              </Link>
              <Link href="/leave?request=leave">
                <Button variant="primary" className="cursor-pointer">
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Request leave
                </Button>
              </Link>
            </>
          )}
          <Link href="/people">
            <Button variant="secondary" className="cursor-pointer">
              <Users className="w-3.5 h-3.5 mr-1.5" /> Team directory
            </Button>
          </Link>
        </div>
      </div>

      {/* 3. ADMIN SECTION: EXECUTIVE METRICS & ALERTS */}
      {isAdmin && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <StatCard 
              title="Fully loaded monthly burn"
              value={`€${Math.round(monthlyCost).toLocaleString()}`}
              subtitle="Employer EFKA and retainer fees"
              icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
              trend="4.2%" trendUp={true}
            />
            <StatCard 
              title="Active headcount"
              value={totalHeadcount}
              subtitle={`${fullTimeCount} full-time, ${contractorCount} contractors`}
              icon={<Users className="w-5 h-5 text-blue-600" />}
            />
            <StatCard 
              title="Pending approvals"
              value={pendingLeaves.length}
              subtitle={pendingLeaves.length > 0 ? 'Waiting on a founder' : 'Nothing waiting'}
              icon={<CalendarIcon className="w-5 h-5 text-amber-500" />}
            />
            <StatCard 
              title="Contract notice alerts"
              value={urgentContracts.length}
              subtitle={urgentContracts.length > 0
                ? `Deadline within ${NOTICE_ALERT_WINDOW_DAYS} days or already missed`
                : 'No renewal needs attention'}
              icon={<AlertTriangle className={`w-5 h-5 ${urgentContracts.length > 0 ? 'text-rose-500' : 'text-slate-400'}`} />}
            />
          </div>

          {/* Integrations health widget */}
          {(() => {
            const totalExceptions = integrationExceptions.exceptions.length + integrationExceptions.revoked.length;
            const healthy = totalExceptions === 0;
            return (
              <Link href="/settings" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-2.5 rounded-[var(--radius-card)] border border-[var(--line)] bg-white hover:border-[var(--line-strong)] transition-colors no-underline group">
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="w-4 h-4 text-[var(--ink-4)]" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--ink)]">Integrations</span>
                    {healthy
                      ? <Badge variant="success">All mirrors healthy</Badge>
                      : <Badge variant="warning">{totalExceptions} exceptions</Badge>}
                    <span className="ui-meta">
                      Reconciled {integrationLastReconciledAt ? formatDateTime(integrationLastReconciledAt) : 'never'}, {integrationExceptions.notConnectedCount} not connected to Slack
                    </span>
                  </div>
                </div>
                <span className="text-[12px] font-medium text-[var(--accent-ink)] group-hover:underline shrink-0">
                  Manage
                </span>
              </Link>
            );
          })()}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Contract notice windows" subtitle="Renewal deadlines that need a decision" action={<Link href="/contracts/notices" className="text-[12px] font-medium text-[var(--accent-ink)] hover:underline">Open report</Link>}>
              {urgentContracts.length === 0 ? (
                <div className="orbit-empty">
                  <p className="font-medium text-[var(--ink-2)]">No notice deadlines in the next {NOTICE_ALERT_WINDOW_DAYS} days</p>
                  <p>Every renewal is still inside its window.</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--line)] -mx-1">
                  {urgentContracts.map(c => {
                    const isSupplier = c.direction === 'cost';
                    const { noticeDeadlineStr, daysUntilNotice } = getContractNoticeStatus(c);
                    return (
                      <Link key={c.id} href={`/contracts/${c.id}`} className="px-1 py-2.5 flex items-center justify-between gap-3 group">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[13px] text-[var(--ink)] group-hover:text-[var(--accent-ink)] transition-colors truncate">{c.counterparty?.legal_name}</span>
                            <Badge variant={isSupplier ? 'warning' : 'success'}>{isSupplier ? 'Cost' : 'Revenue'}</Badge>
                          </div>
                          <p className="ui-meta mt-0.5 truncate">
                            {c.product || c.type} · <span className="ui-num">{c.reference}</span>
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="ui-num text-[12px] text-[var(--ink-2)] flex items-center justify-end gap-1">
                            <Clock className="w-3 h-3 text-[var(--ink-4)]" />
                            {noticeDeadlineStr}
                          </div>
                          <p className={`text-[11px] mt-0.5 ${daysUntilNotice <= 0 ? 'text-rose-600 font-medium' : 'text-[var(--ink-3)]'}`}>
                            {daysUntilNotice <= 0 ? 'Deadline passed' : `In ${daysUntilNotice} days, ${c.notice_period_days}-day window`}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="Leave approvals" subtitle="Requests waiting on a founder" action={<Link href="/company-leave" className="text-[12px] font-medium text-[var(--accent-ink)] hover:underline">Manage queue</Link>}>
              {pendingLeaves.length === 0 ? (
                <div className="orbit-empty">
                  <p className="font-medium text-[var(--ink-2)]">No leave requests waiting</p>
                  <p>Everything routed here has been decided.</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--line)] -mx-1">
                  {pendingLeaves.map(req => {
                    const requester = profiles.find(p => p.id === req.profile_id);
                    return (
                      <div key={req.id} className="px-1 py-2.5 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-[13px] text-[var(--ink)]">{requester?.first_name} {requester?.last_name}</p>
                          <p className="ui-meta mt-0.5">{req.working_days} working days, {formatDate(req.start_date)} to {formatDate(req.end_date)}</p>
                        </div>
                        <Link href="/company-leave">
                          <Button size="sm" variant="secondary">Review</Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Carried-over days with a use-by date (renders nothing when there is no deadline) */}
      <CarryoverWarning />

      {/* 4. EMPLOYEE PERSONAL SUMMARY (LEAVE QUOTA) */}
      {!isContractor ? (
        <Card title={`Annual leave, ${leaveYear}`} subtitle="Your balance for this leave year">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-5">
              <div className="flex items-center gap-5">
                <div className="shrink-0">
                  <span className="ui-num text-[34px] font-semibold text-[var(--accent-ink)] leading-none block">
                    {myBalance.available}
                  </span>
                  <span className="ui-label mt-1 block">Days left</span>
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-[var(--ink)]">Available time off</h3>
                  <p className="ui-meta max-w-sm mt-0.5">
                    Plan time away and request it from the leave workspace.
                  </p>
                  {usesDefaultEntitlement && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      On the company default of {myBalance.entitlement} days; no personal quota set for {leaveYear}.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-5 rounded-[var(--radius-control)] border border-[var(--line)] px-4 py-2.5 shrink-0">
                <div>
                  <span className="ui-label block">Entitlement</span>
                  <span className="ui-num text-[13px] font-medium text-[var(--ink)]">{myBalance.entitlement} d</span>
                </div>
                <div>
                  <span className="ui-label block">Carried over</span>
                  <span className="ui-num text-[13px] font-medium text-emerald-700">{myBalance.carryOver > 0 ? '+' : ''}{myBalance.carryOver} d</span>
                </div>
                <div>
                  <span className="ui-label block">Taken</span>
                  <span className="ui-num text-[13px] font-medium text-[var(--ink-2)]">-{myBalance.taken} d</span>
                </div>
                {myBalance.reserved > 0 && (
                  <div>
                    <span className="ui-label block">Pending</span>
                    <span className="ui-num text-[13px] font-medium text-[var(--ink-2)]">-{myBalance.reserved} d</span>
                  </div>
                )}
                {myBalance.mandatory > 0 && (
                  <div>
                    <span className="ui-label block">Mandatory</span>
                    <span className="ui-num text-[13px] font-medium text-[var(--ink-2)]">-{myBalance.mandatory} d</span>
                  </div>
                )}
              </div>
          </div>
        </Card>
      ) : (
        <Card title="Retainer summary" subtitle="Your contractor agreement">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-[var(--ink)]">Active contractor agreement</p>
              <p className="ui-meta mt-0.5">Invoiced as a monthly retainer or day-rate block.</p>
            </div>
            <Badge variant="neutral">External partner</Badge>
          </div>
        </Card>
      )}

      {/* 5. UNIFIED COMPANY & TEAM CALENDAR */}
      <div className="space-y-4 pt-6 border-t border-[var(--line)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="ui-title flex items-center gap-2">
                <CalendarDays className="w-4.5 h-4.5 text-[var(--ink-3)]" /> Company calendar
              </h2>
              <p className="text-[13px] text-[var(--ink-3)] mt-0.5">
                Remote logs, approved leave and company dates in one view.
              </p>
            </div>
          </div>

          {/* View Switcher Tabs */}
          <div className="flex items-center space-x-1 border-b border-slate-200 pb-2">
            {CALENDAR_VIEWS.map(view => (
              <button
                key={view.key}
                onClick={() => selectView(view.key)}
                className={`px-3.5 py-1.5 rounded-lg font-extrabold text-xs transition-all cursor-pointer ${
                  calendarView === view.key
                    ? 'bg-slate-200/80 text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                }`}
              >
                {view.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sleek & Compact Calendar Toolbar */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Left: Period Controls */}
            <div className="flex items-center space-x-2">
              <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50/80 p-0.5 shadow-2xs">
                <button
                  onClick={handlePrevPeriod}
                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-white rounded-md transition-all cursor-pointer"
                  title="Previous"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 text-xs font-bold text-slate-800 font-mono select-none min-w-[150px] text-center whitespace-nowrap">
                  {periodLabel}
                </span>
                <button
                  onClick={handleNextPeriod}
                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-white rounded-md transition-all cursor-pointer"
                  title="Next"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={handleToday}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all cursor-pointer shadow-2xs"
              >
                Today
              </button>
            </div>

            {/* Right: Filters (Team, Search, Types) */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Team Selector */}
              <div className="relative">
                <select
                  value={selectedTeamId}
                  onChange={(e) => setSelectedTeamId(e.target.value)}
                  className="h-8 pl-3 pr-7 py-0 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-white text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer shadow-2xs transition-all"
                >
                  <option value="all">All Teams</option>
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {/* Employee Search Input */}
              <div className="relative w-40 sm:w-48">
                <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Find colleague..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-8 pl-7 pr-7 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-white placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--accent)] shadow-2xs transition-all"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Event Type Toggle Pills */}
              <div className="inline-flex rounded-lg bg-slate-100/80 p-0.5 border border-slate-200/80 text-[11px] font-bold">
                {(['all', 'remote', 'leave', 'holiday'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setEventTypeFilter(type)}
                    className={`px-2.5 py-1 rounded-md transition-all capitalize cursor-pointer ${
                      eventTypeFilter === type
                        ? 'bg-white text-[var(--accent)] shadow-2xs font-extrabold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {type === 'all' && 'All'}
                    {type === 'remote' && 'Remote'}
                    {type === 'leave' && 'Leaves'}
                    {type === 'holiday' && 'Holidays'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Day agenda / Calendar grid / Team matrix */}
        {calendarView === 'day' ? (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md p-5 sm:p-6">
            {dayEntry && (
              <>
                <div className="border-b border-slate-200 pb-4 mb-5">
                  <span className="ui-label">Daily roster</span>
                  <h3 className="ui-title mt-0.5">{format(dayEntry.dateObj, 'EEEE, d MMMM yyyy')}</h3>
                  <p className="ui-meta mt-0.5">
                    {dayEntry.leaves.length} away · {dayEntry.remotes.length} remote · {dayEntry.inOffice.length} on-site
                  </p>
                </div>
                <div className="space-y-6 text-xs">
                  <DayAgenda day={dayEntry} />
                </div>
              </>
            )}
          </div>
        ) : calendarView === 'week' || calendarView === 'month' ? (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md overflow-x-auto">
            <div className="min-w-[850px] w-full">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80 text-center text-xs font-black text-slate-600 uppercase tracking-wider py-3.5">
              <div>Monday</div>
              <div>Tuesday</div>
              <div>Wednesday</div>
              <div>Thursday</div>
              <div>Friday</div>
              <div className="text-slate-400">Saturday</div>
              <div className="text-slate-400">Sunday</div>
            </div>

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

                  const weekHolidays = showHolidays ? publicHolidays.filter(h => h.date >= weekStartStr && h.date <= weekEndStr) : [];
                  const weekMandatory = showHolidays ? mandatoryLeaves.filter(m => !(m.end_date < weekStartStr || m.start_date > weekEndStr)) : [];
                  const weekLeaveSpans = showLeaves ? companyLeaves.filter(span =>
                    !(span.end_date < weekStartStr || span.start_date > weekEndStr) &&
                    activeProfiles.some(p => p.id === span.profile_id && p.employment_type !== 'contractor')
                  ) : [];

                  return (
                    <div key={wIdx} className="relative min-h-[160px] border-b border-slate-200/80 last:border-b-0 flex flex-col">
                      <div className="absolute inset-0 grid grid-cols-7 divide-x divide-slate-200/80 pointer-events-auto">
                        {weekDays.map(day => (
                          <div
                            key={day.dateStr}
                            onClick={() => setSelectedDay(day)}
                            className={`h-full transition-colors cursor-pointer group ${
                              !day.isCurrentMonth
                                ? 'bg-slate-50/70 text-slate-400'
                                : day.isToday
                                  ? 'bg-blue-50/30 ring-2 ring-inset ring-[var(--accent)]'
                                  : 'bg-white hover:bg-slate-50/90'
                            }`}
                          />
                        ))}
                      </div>

                      <div className="relative z-10 pointer-events-none pb-2 flex flex-col justify-start flex-1">
                        <div className="grid grid-cols-7 pt-2 px-2 mb-1">
                          {weekDays.map(day => (
                            <div key={day.dateStr} className="flex items-center justify-between h-6 pointer-events-auto" onClick={() => setSelectedDay(day)}>
                              <span className="text-[10px] text-slate-400 font-bold opacity-0 hover:opacity-100 transition-opacity flex items-center cursor-pointer">
                                <Info className="w-3 h-3 mr-0.5" /> Detail
                              </span>
                              <span
                                className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                                  day.isToday
                                    ? 'bg-[var(--accent)] text-white font-extrabold shadow-sm'
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

                        <div className="space-y-1 mb-1.5 flex flex-col">
                          {weekHolidays.map(h => {
                            const idx = weekDays.findIndex(d => d.dateStr === h.date);
                            if (idx === -1) return null;
                            const startCol = idx + 1;
                            return (
                              <div key={`hol-${h.date}`} className="grid grid-cols-7 px-1 pointer-events-auto">
                                <div
                                  style={{ gridColumn: `${startCol} / span 1` }}
                                  className="py-1 px-2 rounded-md bg-indigo-600 text-white text-[11px] font-black truncate flex items-center shadow-2xs"
                                  title={h.name_en || h.name_el}
                                >
                                  <span className="mr-1.5">🎉</span>
                                  <span className="truncate">{h.name_en || h.name_el}</span>
                                </div>
                              </div>
                            );
                          })}

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
                                  className={`py-1.5 px-2.5 rounded-md bg-purple-700 text-white text-[11px] font-black truncate flex items-center shadow-xs ${
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

                          {weekLeaveSpans.map(leaveSpan => {
                            const prof = activeProfiles.find(p => p.id === leaveSpan.profile_id);
                            if (!prof) return null;
                            const known = leaveSpan.leave_request_id
                              ? leaveDisplayById.get(leaveSpan.leave_request_id)
                              : undefined;
                            const showDetails = !!known;
                            const displayType = known ? known.displayType : 'Out-of-Office (OOO)';

                            let startCol = 1;
                            let endCol = 7;
                            let isActualStart = false;
                            let isActualEnd = false;

                            if (leaveSpan.start_date >= weekStartStr) {
                              const idx = weekDays.findIndex(d => d.dateStr >= leaveSpan.start_date);
                              if (idx !== -1) { startCol = idx + 1; isActualStart = true; }
                            }
                            if (leaveSpan.end_date <= weekEndStr) {
                              const idx = weekDays.findIndex(d => d.dateStr >= leaveSpan.end_date);
                              if (idx !== -1) { endCol = idx + 1; isActualEnd = true; }
                              else { endCol = weekDays.findIndex(d => d.dateStr <= leaveSpan.end_date) + 1; isActualEnd = true; }
                            }
                            const barDays = Math.max(1, endCol - startCol + 1);

                            return (
                              <div key={`lr-${leaveSpan.leave_request_id ?? `${leaveSpan.profile_id}-${leaveSpan.start_date}`}`} className="grid grid-cols-7 px-1 pointer-events-auto">
                                <div
                                  style={{ gridColumn: `${startCol} / span ${barDays}` }}
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
                                  title={`${prof.first_name} ${prof.last_name} — ${displayType} (${formatDate(leaveSpan.start_date)} to ${formatDate(leaveSpan.end_date)})`}
                                >
                                  <div className="flex items-center truncate">
                                    <span className="mr-1.5">🏖️</span>
                                    <ProfileAvatar photoUrl={prof.photo_url} firstName={prof.first_name} lastName={prof.last_name} size="xs" className="mr-1.5" />
                                    <span className="font-extrabold mr-1.5">{prof.first_name} {prof.last_name}</span>
                                    <span className="opacity-80 font-medium">({displayType})</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="grid grid-cols-7 px-1 flex-1 gap-x-1">
                          {weekDays.map(day => {
                            const cellItems: React.ReactNode[] = [];

                            if (showHolidays) {
                              day.birthdays.forEach((b, bIdx) => {
                                cellItems.push(
                                  <div
                                    key={`b-${b.id}-${bIdx}`}
                                    title={`Birthday Celebration: ${b.first_name} ${b.last_name}`}
                                    className="px-2 py-0.5 my-0.5 rounded-md bg-gradient-to-r from-amber-100 to-rose-100 text-amber-950 border border-amber-300/80 text-[10px] font-black truncate flex items-center shadow-2xs pointer-events-auto"
                                  >
                                    <span className="mr-1">🎂</span>
                                    <span className="truncate">{b.first_name}&apos;s B-day!</span>
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
                                    className="px-2 py-0.5 my-0.5 rounded-md bg-cyan-50/90 text-cyan-950 border border-cyan-200/80 text-[10px] font-semibold truncate flex items-center shadow-2xs pointer-events-auto"
                                  >
                                    <span className="mr-1">{r.mode === 'remote_abroad' ? '✈️' : '🏠'}</span>
                                    <ProfileAvatar photoUrl={r.profile.photo_url} firstName={r.profile.first_name} lastName={r.profile.last_name} size="xs" className="mr-1" />
                                    <span className="font-bold mr-1">{r.profile.first_name}</span>
                                    <span className="text-slate-500 font-normal">{r.mode === 'remote_abroad' ? `(Other City)` : '(Remote GR)'}</span>
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
        ) : (
          /* Team View Matrix Timeline */
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md overflow-x-auto max-h-[650px] relative">
            <table className="min-w-[1100px] w-full border-collapse select-none text-xs">
              <thead>
                <tr className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-xs shadow-xs border-b border-slate-200">
                  <th className="min-w-[200px] w-[220px] sticky left-0 z-30 bg-slate-50/95 backdrop-blur-xs border-b border-r border-slate-200/80 p-3 text-left font-extrabold text-slate-700 uppercase tracking-wider text-[11px]">
                    Teammate
                  </th>
                  {currentMonthDays.map(day => {
                    const isWeekend = day.dateObj.getDay() === 0 || day.dateObj.getDay() === 6;
                    return (
                      <th
                        key={day.dateStr}
                        onClick={() => setSelectedDay(day)}
                        className={`w-9 min-w-[34px] max-w-[38px] p-2 text-center border-b border-r border-slate-200/60 font-mono transition-colors cursor-pointer ${
                          day.isToday
                            ? 'bg-cyan-50/80 text-cyan-950 font-black'
                            : isWeekend
                            ? 'bg-slate-100/70 text-slate-400 font-medium'
                            : 'bg-slate-50/90 text-slate-700 font-bold hover:bg-slate-100'
                        }`}
                      >
                        {day.isToday ? (
                          <div className="w-6 h-6 rounded-full bg-cyan-600 text-white font-black flex items-center justify-center mx-auto text-xs shadow-xs" title="Today">
                            {format(day.dateObj, 'd')}
                          </div>
                        ) : (
                          <span>{format(day.dateObj, 'd')}</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60">
                {activeProfiles.length === 0 ? (
                  <tr>
                    <td colSpan={currentMonthDays.length + 1} className="p-8 text-center text-slate-400 font-medium text-sm">
                      No team members match the selected filters.
                    </td>
                  </tr>
                ) : (
                  activeProfiles.map(p => (
                    <tr key={p.id} className="group hover:bg-slate-50/50 transition-colors">
                      <td className="min-w-[200px] w-[220px] sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-b border-r border-slate-200/80 p-2.5 transition-colors text-left font-sans shadow-2xs">
                        <div className="flex items-center space-x-2.5">
                          <ProfileAvatar
                            photoUrl={p.photo_url}
                            firstName={p.first_name}
                            lastName={p.last_name}
                            size="sm"
                            className="border border-slate-200"
                          />
                          <div className="truncate">
                            <span className="text-xs font-bold text-slate-800 tracking-tight block truncate">
                              {p.first_name} {p.last_name}
                            </span>
                            <span className="text-[10px] text-slate-400 block truncate font-medium">
                              {roleLabel(p, profileRoleHistory, jobRoles, seniorityLevels)}
                            </span>
                          </div>
                        </div>
                      </td>
                      {currentMonthDays.map((day, dIdx) => {
                        const isWeekend = day.dateObj.getDay() === 0 || day.dateObj.getDay() === 6;
                        const prevDay = dIdx > 0 ? currentMonthDays[dIdx - 1] : null;
                        const nextDay = dIdx < currentMonthDays.length - 1 ? currentMonthDays[dIdx + 1] : null;

                        // Check events
                        const isOnLeave = (eventTypeFilter === 'all' || eventTypeFilter === 'leave') && day.leaves.some(l => l.profile.id === p.id);
                        const prevOnLeave = prevDay && (eventTypeFilter === 'all' || eventTypeFilter === 'leave') && prevDay.leaves.some(l => l.profile.id === p.id);
                        const nextOnLeave = nextDay && (eventTypeFilter === 'all' || eventTypeFilter === 'leave') && nextDay.leaves.some(l => l.profile.id === p.id);

                        const remoteInfo = (eventTypeFilter === 'all' || eventTypeFilter === 'remote') ? day.remotes.find(r => r.profile.id === p.id) : undefined;
                        const prevRemote = prevDay && (eventTypeFilter === 'all' || eventTypeFilter === 'remote') ? prevDay.remotes.find(r => r.profile.id === p.id) : undefined;
                        const nextRemote = nextDay && (eventTypeFilter === 'all' || eventTypeFilter === 'remote') ? nextDay.remotes.find(r => r.profile.id === p.id) : undefined;

                        const isBirthday = (eventTypeFilter === 'all' || eventTypeFilter === 'holiday') && day.birthdays.some(b => b.id === p.id);
                        const isHoliday = (eventTypeFilter === 'all' || eventTypeFilter === 'holiday') && day.holidays.length > 0;

                        return (
                          <td
                            key={day.dateStr}
                            onClick={() => setSelectedDay(day)}
                            className={`p-0 h-11 border-b border-r border-slate-200/50 text-center relative cursor-pointer transition-colors ${
                              day.isToday
                                ? 'bg-cyan-50/40 hover:bg-cyan-50/70'
                                : isWeekend
                                ? 'bg-slate-100/60 hover:bg-slate-100'
                                : 'bg-white hover:bg-slate-50'
                            }`}
                          >
                            {isOnLeave && (
                              <div
                                title={`${p.first_name} ${p.last_name}: On Leave`}
                                className={`h-6 bg-[var(--accent)] text-white flex items-center justify-center text-[9px] font-bold shadow-2xs ${
                                  prevOnLeave ? 'rounded-l-none ml-0' : 'rounded-l-md ml-0.5'
                                } ${
                                  nextOnLeave ? 'rounded-r-none mr-0' : 'rounded-r-md mr-0.5'
                                }`}
                              />
                            )}
                            {!isOnLeave && remoteInfo && (
                              <div
                                title={`${p.first_name} ${p.last_name}: Working Remotely (${remoteInfo.mode === 'remote_abroad' ? 'Other City' : 'GR'})`}
                                className={`h-6 ${remoteInfo.mode === 'remote_abroad' ? 'bg-indigo-500' : 'bg-cyan-500'} text-white flex items-center justify-center text-[9px] font-bold shadow-2xs ${
                                  prevRemote ? 'rounded-l-none ml-0' : 'rounded-l-md ml-0.5'
                                } ${
                                  nextRemote ? 'rounded-r-none mr-0' : 'rounded-r-md mr-0.5'
                                }`}
                              />
                            )}
                            {!isOnLeave && !remoteInfo && isBirthday && (
                              <div title="Birthday Today!" className="h-6 mx-0.5 rounded-md bg-amber-500 text-white font-black text-[10px] flex items-center justify-center shadow-2xs">
                                🎂
                              </div>
                            )}
                            {!isOnLeave && !remoteInfo && !isBirthday && isHoliday && (
                              <div title={day.holidays[0]?.name_en || day.holidays[0]?.name_el || 'Public Holiday'} className="h-6 mx-0.5 rounded-md bg-purple-100/80 text-purple-700 font-bold text-[10px] flex items-center justify-center">
                                🏖️
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Calendar Legend & Privacy Lens Footer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-xs text-xs text-slate-600">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-cyan-500 shrink-0" />
            <div>
              <span className="font-bold text-slate-800 block">🏠 Remote Work</span>
              <span className="text-[11px] text-slate-500">Daily logs &amp; routines</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-rose-500 shrink-0" />
            <div>
              <span className="font-bold text-slate-800 block">🏖️ Approved Leave</span>
              <span className="text-[11px] text-slate-500">Vacation or sick leave</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-indigo-600 shrink-0" />
            <div>
              <span className="font-bold text-slate-800 block">🎉 Holidays &amp; Closures</span>
              <span className="text-[11px] text-slate-500">Public civic dates &amp; breaks</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-amber-500 shrink-0" />
            <div>
              <span className="font-bold text-slate-800 block">🎂 Birthdays</span>
              <span className="text-[11px] text-slate-500">Teammate celebrations</span>
            </div>
          </div>
          <div className="flex items-start space-x-2 md:border-l md:border-slate-200 md:pl-4">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-[11px] text-slate-500 leading-tight">
              <span className="font-bold text-slate-700 block">§4 Privacy Lens Active</span>
              Peers view &quot;Out-of-Office&quot; for absences. Details restricted to Admins and self.
            </div>
          </div>
        </div>
      </div>

      {/* 6. INTERACTIVE DAY DETAILS MODAL / SLIDE-OVER */}
      {selectedDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="p-6 bg-gradient-to-r from-slate-900 to-[var(--steel-line)] text-white flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase text-cyan-300 tracking-wider flex items-center mb-1">
                  <Clock className="w-3.5 h-3.5 mr-1" /> Daily Roster &amp; Schedule Breakdown
                </span>
                <h3 className="text-xl font-extrabold font-mono">
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

            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              <DayAgenda day={selectedDay} />
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 font-semibold">
                Showing attendance &amp; schedule records synced live from PostgreSQL.
              </span>
              <div className="flex items-center space-x-2">
                <Link
                  href="/remote"
                  onClick={() => setSelectedDay(null)}
                  className="px-4 py-2 rounded-xl bg-[var(--accent)] hover:bg-blue-600 text-white font-black text-xs transition-all flex items-center shadow-xs"
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
