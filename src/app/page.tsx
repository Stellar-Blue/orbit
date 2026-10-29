"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { roleLabel } from '@/lib/profile-role';
import { 
  format, startOfWeek, endOfWeek, addMonths, subMonths, 
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
import { Profile, LeaveRequest, PublicHoliday, MandatoryLeave, LeaveType } from '@/lib/types';
import { getContractNoticeStatus, NOTICE_ALERT_WINDOW_DAYS } from '@/lib/pricing-engine';
import { loadedMonthlyCost, isBaseSalary, loadedExtraCost } from '@/lib/compensation';
import { formatDate, formatDateTime } from '@/lib/date';


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
  birthdays: Profile[];
}

export default function DashboardPage() {
  const { 
    currentUser, profiles, teams, contracts, leaveRequests, leaveTypes, 
    entitlements, salaries, remoteDays,
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
  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date()); // opens on the current month
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | 'remote' | 'leave' | 'holiday'>('all');
  const [selectedDay, setSelectedDay] = useState<DaySchedule | null>(null);
  const [calendarViewMode, setCalendarViewMode] = useState<'calendar' | 'team'>('calendar');

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

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    const dates = eachDayOfInterval({ start, end });
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

        if (isContract || weekdayStr === 'Sat' || weekdayStr === 'Sun') return;

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
        inOffice,
        birthdays
      } as DaySchedule;
    });
  }, [currentMonth, activeProfiles, publicHolidays, mandatoryLeaves, leaveRequests, leaveTypes, remoteDays, isAdmin, currentUser.id]);

  const currentMonthDays = useMemo(() => {
    return calendarDays.filter(d => d.isCurrentMonth);
  }, [calendarDays]);

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const handleToday = () => setCurrentMonth(new Date());

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
                <h2 className="text-xl font-extrabold text-white tracking-tight">
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

          {/* View Switcher Tabs (Calendar vs Team View) */}
          <div className="flex items-center space-x-1 border-b border-slate-200 pb-2">
            <button
              onClick={() => setCalendarViewMode('calendar')}
              className={`px-3.5 py-1.5 rounded-lg font-extrabold text-xs transition-all cursor-pointer ${
                calendarViewMode === 'calendar'
                  ? 'bg-slate-200/80 text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
              }`}
            >
              Calendar
            </button>
            <button
              onClick={() => setCalendarViewMode('team')}
              className={`px-3.5 py-1.5 rounded-lg font-extrabold text-xs transition-all cursor-pointer ${
                calendarViewMode === 'team'
                  ? 'bg-slate-200/80 text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
              }`}
            >
              Team view
            </button>
          </div>
        </div>

        {/* Sleek & Compact Calendar Toolbar */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Left: Month Controls */}
            <div className="flex items-center space-x-2">
              <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50/80 p-0.5 shadow-2xs">
                <button
                  onClick={handlePrevMonth}
                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-white rounded-md transition-all cursor-pointer"
                  title="Previous Month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 text-xs font-bold text-slate-800 font-mono select-none min-w-[120px] text-center">
                  {format(currentMonth, 'MMMM yyyy')}
                </span>
                <button
                  onClick={handleNextMonth}
                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-white rounded-md transition-all cursor-pointer"
                  title="Next Month"
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
                  className="h-8 pl-3 pr-7 py-0 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-white text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#2f6fa3] cursor-pointer shadow-2xs transition-all"
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
                  className="w-full h-8 pl-7 pr-7 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-white placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#2f6fa3] shadow-2xs transition-all"
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
                        ? 'bg-white text-[#2f6fa3] shadow-2xs font-extrabold'
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

        {/* Calendar / Team Matrix Views */}
        {calendarViewMode === 'calendar' ? (
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
                  const weekLeaveRequests = showLeaves ? leaveRequests.filter(r => 
                    r.origin !== 'mandatory' &&
                    (r.status === 'approved' || r.status === 'in_progress' || r.status === 'taken') &&
                    !(r.end_date < weekStartStr || r.start_date > weekEndStr) &&
                    activeProfiles.some(p => p.id === r.profile_id && p.employment_type !== 'contractor')
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
                                  ? 'bg-blue-50/30 ring-2 ring-inset ring-[#2f6fa3]'
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
                                    ? 'bg-[#2f6fa3] text-white font-extrabold shadow-sm'
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
                                  title={`${prof.first_name} ${prof.last_name} — ${displayType} (${formatDate(req.start_date)} to ${formatDate(req.end_date)})`}
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
                                className={`h-6 bg-[#2f6fa3] text-white flex items-center justify-center text-[9px] font-bold shadow-2xs ${
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
            <div className="p-6 bg-gradient-to-r from-slate-900 to-[#1E3A5F] text-white flex items-center justify-between">
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
              {/* Birthdays on this day */}
              {selectedDay.birthdays.length > 0 && (
                <div className="p-4 rounded-xl bg-gradient-to-r from-amber-50 to-rose-50 border border-amber-200/80 space-y-2">
                  <h4 className="font-extrabold text-amber-950 flex items-center text-sm">
                    <span className="mr-1.5 text-base">🎂</span> Birthday Celebrations for This Date
                  </h4>
                  <ul className="space-y-1 text-amber-900 font-bold">
                    {selectedDay.birthdays.map(b => (
                      <li key={b.id}>&bull; Happy Birthday to {b.first_name} {b.last_name}! 🎉</li>
                    ))}
                  </ul>
                </div>
              )}

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
                  <Badge variant={selectedDay.leaves.length > 0 ? 'warning' : 'neutral'} className="font-extrabold">
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
                  <Badge variant={selectedDay.remotes.length > 0 ? 'info' : 'neutral'} className="font-extrabold">
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

              {/* In Office HQ Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h4 className="font-bold text-slate-800 text-sm flex items-center">
                    <span className="mr-2 text-base">🏢</span> On-Site at Office HQ ({selectedDay.inOffice.length})
                  </h4>
                  <Badge variant="neutral" className="font-extrabold">
                    {selectedDay.inOffice.length} present at HQ
                  </Badge>
                </div>
                {selectedDay.inOffice.length === 0 ? (
                  <p className="text-slate-400 italic py-1">No regular on-site staff scheduled for this date (e.g. weekend or full remote day).</p>
                ) : (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedDay.inOffice.map((o, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 py-0.5 pl-0.5 pr-3 text-slate-700 text-xs font-bold">
                        <ProfileAvatar photoUrl={o.profile.photo_url} firstName={o.profile.first_name} lastName={o.profile.last_name} size="xs" />
                        <span>{o.profile.first_name} {o.profile.last_name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 font-semibold">
                Showing attendance &amp; schedule records synced live from PostgreSQL.
              </span>
              <div className="flex items-center space-x-2">
                <Link
                  href="/remote"
                  onClick={() => setSelectedDay(null)}
                  className="px-4 py-2 rounded-xl bg-[#2f6fa3] hover:bg-blue-600 text-white font-black text-xs transition-all flex items-center shadow-xs"
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
