"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { 
  Globe, MapPin, AlertTriangle, Calendar as CalendarIcon, 
  Users, ShieldCheck, Clock, Building2, Info, XCircle, 
  ChevronLeft, ChevronRight, Zap, Lock, RefreshCw, FileText 
} from 'lucide-react';
import { 
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, 
  startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths, addDays 
} from 'date-fns';
import { notifySuccess, notifyValidation } from '@/lib/validation-modal';

export default function RemoteWorkLogPage() {
  const { 
    currentUser, profiles, remoteDays, remotePatterns, remotePolicies, 
    remoteAmendmentRequests, saveRemotePattern, addRemoteDay, bulkAddRemoteDays, 
    requestRemoteAmendment, decideRemoteAmendment, publicHolidays, mandatoryLeaves, leaveRequests,
    employeeIntegrations 
  } = useAuth();
  
  const m365Integration = employeeIntegrations.find(i => i.provider === 'm365') || null;
  const outlookConnected = m365Integration?.status === 'connected';
  
  const isAdmin = currentUser.role === 'admin';
  const isContractor = currentUser.employment_type === 'contractor';

  // Dynamic Today Reference
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayObj = parseISO(todayStr);

  // Calendar & Declaration state
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date(2026, 7, 1)); // August 2026
  const [selectedDateForAction, setSelectedDateForAction] = useState<string | null>(null);
  const [actionModalMode, setActionModalMode] = useState<'declare' | 'amend' | null>(null);

  // Form states for declare / amend modal
  const [targetMode, setTargetMode] = useState<'office' | 'remote_gr' | 'remote_abroad'>('remote_gr');
  const [abroadLocation, setAbroadLocation] = useState('');
  const [noteOrReason, setNoteOrReason] = useState('');

  // Weekly pattern states (used strictly as an Auto-Fill helper template)
  const myExistingPatterns = useMemo(() => (remotePatterns || []).filter(rp => rp.profile_id === currentUser.id), [remotePatterns, currentUser.id]);
  
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
          Contractors manage their own work location and are excluded from internal employee remote work declarations and ΕΡΓΑΝΗ remote logs.
        </p>
      </div>
    );
  }

  // Quota computations based on admin-configured policy (employee-specific overrides company)
  const employeePolicy = (remotePolicies || []).find(p => p.scope_type === 'employee' && p.scope_id === currentUser.id);
  const companyPolicy = (remotePolicies || []).find(p => p.scope_type === 'company');
  const effectivePolicy = employeePolicy || companyPolicy;
  const quotaMaxDays = effectivePolicy ? (effectivePolicy.max_days ?? effectivePolicy.max_days_per_month ?? 8) : 8;
  const quotaPeriod = effectivePolicy ? (effectivePolicy.period_type || 'month') : 'month';
  const periodLabel = quotaPeriod === 'week' ? 'Weekly' : quotaPeriod === 'quarter' ? 'Quarterly' : quotaPeriod === 'year' ? 'Annual' : 'Monthly';
  const countsLeave = effectivePolicy?.counts_leave ?? false;

  const getPolicyPeriodKey = (dateStr: string, period: string) => {
    try {
      const dObj = parseISO(dateStr);
      if (period === 'week') {
        return format(startOfWeek(dObj, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      } else if (period === 'quarter') {
        const q = Math.floor(dObj.getMonth() / 3) + 1;
        return `${dObj.getFullYear()}-Q${q}`;
      } else if (period === 'year') {
        return `${dObj.getFullYear()}`;
      }
      return format(dObj, 'yyyy-MM');
    } catch {
      return dateStr;
    }
  };

  const getRemoteCountForDatePeriod = (targetDateStr: string, period: string) => {
    try {
      const dObj = parseISO(targetDateStr);
      return (remoteDays || []).filter(r => {
        if (r.profile_id !== currentUser.id || r.mode === 'office') return false;
        if (period === 'week') {
          const wStart = startOfWeek(dObj, { weekStartsOn: 1 });
          const wEnd = endOfWeek(dObj, { weekStartsOn: 1 });
          return r.date >= format(wStart, 'yyyy-MM-dd') && r.date <= format(wEnd, 'yyyy-MM-dd');
        } else if (period === 'quarter') {
          const m = dObj.getMonth();
          const qStartMonth = Math.floor(m / 3) * 3;
          const qStart = format(new Date(dObj.getFullYear(), qStartMonth, 1), 'yyyy-MM-dd');
          const qEnd = format(new Date(dObj.getFullYear(), qStartMonth + 3, 0), 'yyyy-MM-dd');
          return r.date >= qStart && r.date <= qEnd;
        } else if (period === 'year') {
          return r.date.startsWith(format(dObj, 'yyyy'));
        } else {
          return r.date.startsWith(format(dObj, 'yyyy-MM'));
        }
      }).length;
    } catch {
      return 0;
    }
  };

  // Approved leave days overlapping the quota period (used when counts_leave is on)
  const countLeaveDaysInPeriod = (targetDateStr: string, period: string) => {
    try {
      const dObj = parseISO(targetDateStr);
      let pStart = '', pEnd = '';
      if (period === 'week') {
        pStart = format(startOfWeek(dObj, { weekStartsOn: 1 }), 'yyyy-MM-dd');
        pEnd = format(endOfWeek(dObj, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      } else if (period === 'quarter') {
        const q = Math.floor(dObj.getMonth() / 3) * 3;
        pStart = format(new Date(dObj.getFullYear(), q, 1), 'yyyy-MM-dd');
        pEnd = format(new Date(dObj.getFullYear(), q + 3, 0), 'yyyy-MM-dd');
      } else if (period === 'year') {
        pStart = format(dObj, 'yyyy-01-01');
        pEnd = format(dObj, 'yyyy-12-31');
      } else {
        pStart = format(dObj, 'yyyy-MM-01');
        pEnd = format(new Date(dObj.getFullYear(), dObj.getMonth() + 1, 0), 'yyyy-MM-dd');
      }
      let count = 0;
      (leaveRequests || []).forEach(lr => {
        if (lr.profile_id !== currentUser.id || lr.status !== 'approved') return;
        const s = lr.start_date < pStart ? pStart : lr.start_date;
        const e = lr.end_date > pEnd ? pEnd : lr.end_date;
        if (s <= e) {
          count += Math.round((parseISO(e).getTime() - parseISO(s).getTime()) / 86400000) + 1;
        }
      });
      return count;
    } catch {
      return 0;
    }
  };

  const activeMonthStr = format(currentMonth, 'yyyy-MM');
  const referenceDateStr = isSameMonth(currentMonth, parseISO(todayStr)) ? todayStr : format(currentMonth, 'yyyy-MM-01');
  const myRemoteDaysCount = useMemo(() => {
    return getRemoteCountForDatePeriod(referenceDateStr, quotaPeriod) + (countsLeave ? countLeaveDaysInPeriod(referenceDateStr, quotaPeriod) : 0);
  }, [remoteDays, leaveRequests, currentUser.id, referenceDateStr, quotaPeriod, countsLeave]);

  const remainingQuota = Math.max(0, quotaMaxDays - myRemoteDaysCount);
  const periodText = quotaPeriod === 'week' 
    ? `in week ${format(startOfWeek(parseISO(referenceDateStr), { weekStartsOn: 1 }), 'MMM d')} – ${format(endOfWeek(parseISO(referenceDateStr), { weekStartsOn: 1 }), 'MMM d')}` 
    : quotaPeriod === 'quarter' 
    ? `in Q${Math.floor(currentMonth.getMonth() / 3) + 1} ${format(currentMonth, 'yyyy')}`
    : quotaPeriod === 'year'
    ? `in ${format(currentMonth, 'yyyy')}`
    : `in ${format(currentMonth, 'MMMM yyyy')}`;

  // Calendar grid calculation
  const calendarDays = useMemo(() => {
    const startM = startOfMonth(currentMonth);
    const endM = endOfMonth(currentMonth);
    const gridStart = startOfWeek(startM, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endM, { weekStartsOn: 1 });

    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return days.map(dateObj => {
      const dateStr = format(dateObj, 'yyyy-MM-dd');
      const weekdayStr = weekdayNames[dateObj.getDay()];
      const isWeekend = weekdayStr === 'Sat' || weekdayStr === 'Sun';
      const isCurrentMonth = isSameMonth(dateObj, currentMonth);
      const isToday = isSameDay(dateObj, new Date());
      const isPast = dateStr < todayStr;

      // Check holidays & company closures
      const isHoliday = (publicHolidays || []).some(h => h.date === dateStr);
      const isMandatory = (mandatoryLeaves || []).some(m => !(m.end_date < dateStr || m.start_date > dateStr));
      const isOnLeave = (leaveRequests || []).some(r => 
        r.profile_id === currentUser.id && 
        (r.status === 'approved' || r.status === 'in_progress' || r.status === 'taken') && 
        !(r.end_date < dateStr || r.start_date > dateStr)
      );

      const remoteEntry = (remoteDays || []).find(rd => rd.profile_id === currentUser.id && rd.date === dateStr);
      const mode = remoteEntry ? (remoteEntry.mode as 'office' | 'remote_gr' | 'remote_abroad') : 'office';
      // True ad-hoc day: declared override NOT covered by the recurring pattern.
      // Pattern-covered days are handled by the Outlook work plan itself; ad-hoc days mirror as extra events.
      const patternCovered = (remotePatterns || []).some(rp =>
        rp.profile_id === currentUser.id &&
        (rp.mode === 'remote_gr' || rp.mode === 'remote_abroad') &&
        rp.weekday === weekdayStr &&
        dateStr >= rp.valid_from &&
        (!rp.valid_to || dateStr <= rp.valid_to)
      );

      // Check if there is an active pending amendment request for this day
      const pendingAmendment = (remoteAmendmentRequests || []).find(r => r.profile_id === currentUser.id && r.date === dateStr && r.status === 'pending');

      return {
        dateObj,
        dateStr,
        weekdayStr,
        isWeekend,
        isCurrentMonth,
        isToday,
        isPast,
        isHoliday: isHoliday || isMandatory,
        isOnLeave,
        mode,
        isCustom: !!remoteEntry && !patternCovered,
        location: remoteEntry?.location,
        note: remoteEntry?.note,
        pendingAmendment
      };
    });
  }, [currentMonth, remoteDays, remotePatterns, currentUser.id, publicHolidays, mandatoryLeaves, leaveRequests, remoteAmendmentRequests]);

  // Handle clicking a date cell on the interactive schedule calendar
  const handleDateClick = (day: typeof calendarDays[number]) => {
    if (!day.isCurrentMonth || day.isWeekend || day.isHoliday || day.isOnLeave) return;

    setSelectedDateForAction(day.dateStr);
    if (day.isPast && !isAdmin) {
      // Non-admin past date -> Must request amendment
      setTargetMode(day.mode === 'office' ? 'remote_gr' : 'office');
      setAbroadLocation(day.location || '');
      setNoteOrReason('');
      setActionModalMode('amend');
    } else {
      // Future date OR admin user -> Can directly declare / edit
      setTargetMode(day.mode === 'office' ? 'remote_gr' : day.mode === 'remote_gr' ? 'remote_abroad' : 'office');
      setAbroadLocation(day.location || '');
      setNoteOrReason(day.note || '');
      setActionModalMode('declare');
    }
  };

  // Auto-Fill helpers based on Recurring Pattern
  const handleAutoFill = async (periodType: 'week' | 'month' | 'quarter') => {
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let startDate = parseISO(todayStr);
    let endDate: Date;

    if (periodType === 'week') {
      endDate = addDays(startDate, 7);
    } else if (periodType === 'month') {
      startDate = startOfMonth(currentMonth);
      endDate = endOfMonth(currentMonth);
    } else {
      // Quarter (3 months from start of current month)
      startDate = startOfMonth(currentMonth);
      endDate = endOfMonth(addMonths(currentMonth, 2));
    }

    const allDays = eachDayOfInterval({ start: startDate, end: endDate });
    const declarations: { date: string; mode: 'office' | 'remote_gr' | 'remote_abroad'; note?: string }[] = [];
    
    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');
    const periodCounts: Record<string, number> = {};
    (remoteDays || []).forEach(r => {
      if (r.profile_id === currentUser.id && r.mode !== 'office') {
        if (r.date < startStr || r.date > endStr) {
          const key = getPolicyPeriodKey(r.date, quotaPeriod);
          periodCounts[key] = (periodCounts[key] || 0) + 1;
        }
      }
    });

    allDays.forEach(dObj => {
      const dStr = format(dObj, 'yyyy-MM-dd');
      // Do not auto-fill past dates!
      if (dStr < todayStr) return;

      const wStr = weekdayNames[dObj.getDay()];
      if (wStr === 'Sat' || wStr === 'Sun') return;

      const isHoliday = (publicHolidays || []).some(h => h.date === dStr);
      const isMandatory = (mandatoryLeaves || []).some(m => !(m.end_date < dStr || m.start_date > dStr));
      const isOnLeave = (leaveRequests || []).some(r => 
        r.profile_id === currentUser.id && 
        (r.status === 'approved' || r.status === 'in_progress' || r.status === 'taken') && 
        !(r.end_date < dStr || r.start_date > dStr)
      );
      if (isHoliday || isMandatory || isOnLeave) return;

      const defaultMode = pattern[wStr] || 'office';
      const pKey = getPolicyPeriodKey(dStr, quotaPeriod);
      const curCount = periodCounts[pKey] || 0;

      if (defaultMode !== 'office') {
        if (curCount < quotaMaxDays || isAdmin) {
          declarations.push({ date: dStr, mode: defaultMode, note: `Auto-filled from default ${wStr} pattern` });
          periodCounts[pKey] = curCount + 1;
        } else {
          declarations.push({ date: dStr, mode: 'office', note: `Office (${periodLabel} Quota limit of ${quotaMaxDays} reached)` });
        }
      } else {
        declarations.push({ date: dStr, mode: 'office' });
      }
    });

    if (declarations.length === 0) {
      alert("No available open working days found to auto-fill in this period!");
      return;
    }

    const success = await bulkAddRemoteDays(currentUser.id, declarations);
    if (success) {
      notifySuccess(`Applied your default pattern to ${declarations.filter(d => d.mode !== 'office').length} remote working day(s) across the selected ${periodType}.`);
    }
  };

  // Submit declaration or amendment
  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDateForAction || !actionModalMode) return;

    if (targetMode === 'remote_abroad' && !abroadLocation.trim()) {
      alert('VALIDATION ERROR: Location is mandatory when working remotely from abroad due to EU tax compliance!');
      return;
    }

    if (actionModalMode === 'amend') {
      if (!noteOrReason.trim()) {
        alert('VALIDATION ERROR: An explanation reason is mandatory when requesting amendments for past dates.');
        return;
      }
      await requestRemoteAmendment({
        date: selectedDateForAction,
        requested_mode: targetMode,
        reason: noteOrReason,
        location: targetMode === 'remote_abroad' ? abroadLocation : undefined
      });
      alert(`Submitted amendment request for ${selectedDateForAction}. Pending admin approval.`);
    } else {
      // Direct declare: strictly enforce admin-configured quota (weekly/monthly/etc.)
      if (targetMode !== 'office' && !isAdmin) {
        const remoteCountForDate = getRemoteCountForDatePeriod(selectedDateForAction, quotaPeriod);
        const leaveCountForDate = countsLeave ? countLeaveDaysInPeriod(selectedDateForAction, quotaPeriod) : 0;
        const periodCountForDate = remoteCountForDate + leaveCountForDate;
        const wasRemote = (remoteDays || []).some(r => r.profile_id === currentUser.id && r.date === selectedDateForAction && r.mode !== 'office');
        if (!wasRemote && periodCountForDate >= quotaMaxDays) {
          const periodNoun = quotaPeriod === 'week' ? 'week' : quotaPeriod === 'quarter' ? 'quarter' : quotaPeriod === 'year' ? 'year' : 'month';
          notifyValidation({
            type: 'error',
            title: 'Remote quota exceeded',
            message: (leaveCountForDate > 0 && remoteCountForDate < quotaMaxDays)
              ? `Approved leave fills your ${periodLabel.toLowerCase()} remote-work quota (${quotaMaxDays} day(s) per ${periodNoun}), so no remote day can be added this period.`
              : `You've reached your ${periodLabel.toLowerCase()} remote-work quota (${quotaMaxDays} day(s) per ${periodNoun}). No more remote days can be added this period.`,
            items: [
              { label: 'Remote days used', value: `${remoteCountForDate} / ${quotaMaxDays}` },
              ...(countsLeave ? [{ label: 'Approved leave counted', value: String(leaveCountForDate) }] : []),
              { label: 'Total toward quota', value: String(periodCountForDate) },
            ]
          });
          return;
        }
      }
      addRemoteDay({
        profile_id: currentUser.id,
        date: selectedDateForAction,
        mode: targetMode,
        location: targetMode === 'remote_abroad' ? abroadLocation : undefined,
        note: noteOrReason || undefined,
        ergani_status: targetMode === 'office' ? 'not_required' : 'pending'
      });
    }

    setActionModalMode(null);
    setSelectedDateForAction(null);
  };

  // Filter relevant amendment requests
  const myAmendmentRequests = useMemo(() => {
    return (remoteAmendmentRequests || []).filter(r => r.profile_id === currentUser.id);
  }, [remoteAmendmentRequests, currentUser.id]);

  const pendingAdminQueue = useMemo(() => {
    if (!isAdmin) return [];
    return (remoteAmendmentRequests || []).filter(r => r.status === 'pending');
  }, [remoteAmendmentRequests, isAdmin]);

  return (
    <div className="space-y-8 animate-in fade-in duration-200 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center">
            <Globe className="w-6 h-6 mr-3 text-[#3D87D3]" /> Remote Work Schedule & Declarations
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Declare remote work schedules, utilize pattern auto-fill templates, and inspect organizational office rosters.
          </p>
        </div>

        {/* Compact Quota — rides the header's empty space */}
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200/90 shadow-2xs text-xs shrink-0">
          <div className="p-1.5 rounded-lg bg-white border border-slate-200 text-[#3D87D3] shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <span className="font-bold uppercase tracking-wider text-slate-700 shrink-0 hidden md:inline">
            {periodLabel} Remote Quota
          </span>
          <div className="h-4 w-px bg-slate-200 shrink-0 hidden md:block" />
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="font-extrabold text-slate-900">
              {myRemoteDaysCount} / {quotaMaxDays} {myRemoteDaysCount === 1 ? 'day' : 'days'} used
            </span>
            {countsLeave && <span className="text-[10px] font-semibold text-slate-400">incl. approved leave</span>}
            <span className="font-bold text-slate-500">{remainingQuota} remaining {periodText}</span>
          </div>
          {remainingQuota === 0 ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-extrabold shadow-2xs shrink-0">
              <AlertTriangle className="w-3 h-3 mr-1 text-amber-600" /> Exhausted
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold shadow-2xs shrink-0">
              <ShieldCheck className="w-3 h-3 mr-1 text-emerald-600" /> Eligible
            </span>
          )}
        </div>
      </div>

      {/* Main Grid: Pattern Template Helper & Interactive Schedule Calendar */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        
        {/* Left / Top: Default Pattern Template & Quick Auto-Fill */}
        <div className="xl:col-span-4 space-y-6">
          <Card title="Default Working Pattern Helper" subtitle="Template routine used to easily auto-fill your remote schedule" className="shadow-xs border-slate-200 h-full flex flex-col justify-between">
            <div>
              {/* Hover-only info: pattern explanation + Outlook sync status */}
              <div className="relative group mb-3 inline-block">
                <button
                  type="button"
                  className="w-7 h-7 rounded-full bg-slate-100 hover:bg-[#3D87D3]/10 text-slate-500 hover:text-[#3D87D3] border border-slate-200 flex items-center justify-center cursor-pointer transition-colors"
                  aria-label="Pattern helper info"
                >
                  <Info className="w-4 h-4" />
                </button>
                <div className="hidden group-hover:block absolute left-0 top-9 z-30 w-80 p-4 rounded-xl bg-slate-900/95 backdrop-blur border border-slate-700 shadow-2xl text-[11px] leading-relaxed space-y-3">
                  <div className="text-slate-200">
                    <span className="font-extrabold text-white block mb-0.5">Auto-fill helper template</span>
                    Set your routine below and click an auto-fill action to populate your calendar. The pattern is not just a template — remote days in it update your Outlook work plan.
                  </div>
                  <div className={`rounded-lg p-2.5 border ${outlookConnected ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'}`}>
                    {outlookConnected ? (
                      <>
                        <span className="font-extrabold text-white block mb-0.5">Synced with Outlook</span>
                        Remote pattern days update your Outlook work plan (remote / office) in real time; saving updates Outlook immediately.
                      </>
                    ) : (
                      <>
                        <span className="font-extrabold text-white block mb-0.5">Not synced with Outlook</span>
                        <a href={`/api/msal/connect?next=${encodeURIComponent('/remote')}`} className="font-bold underline underline-offset-2 text-emerald-300">Connect Microsoft</a> once to mirror this pattern and your declared days to Outlook.
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => (
                  <div key={day} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80 text-xs">
                    <span className="font-bold w-14 text-slate-800 text-sm">{day}</span>
                    <div className="flex items-center space-x-1.5">
                      <button 
                        onClick={() => setPattern({ ...pattern, [day]: 'office' })}
                        className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer text-[11px] ${
                          pattern[day] === 'office' 
                            ? 'bg-slate-800 text-white shadow-xs font-extrabold' 
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                      >
                        🏢 Office
                      </button>
                      <button 
                        onClick={() => setPattern({ ...pattern, [day]: 'remote_gr' })}
                        className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer text-[11px] ${
                          pattern[day] === 'remote_gr' 
                            ? 'bg-[#3D87D3] text-white shadow-xs font-extrabold' 
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                      >
                        🏠 Remote GR
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <Button 
                variant="secondary" 
                className="w-full mt-4 text-xs py-2 font-bold border-slate-300 hover:bg-slate-100 shadow-2xs" 
                onClick={async () => {
                  const patternEntries = Object.entries(pattern).map(([weekday, mode]) => ({ weekday, mode }));
                  const success = await saveRemotePattern(currentUser.id, patternEntries);
                  if (success) notifySuccess('Your default pattern template was saved.');
                }}
              >
                Save Pattern Template
              </Button>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-200/80 space-y-2.5">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700 block mb-1">
                ⚡ Quick Auto-Fill Actions
              </span>
              <Button 
                variant="primary" 
                className="w-full bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-white font-extrabold py-2.5 rounded-xl shadow-xs text-xs flex items-center justify-center"
                onClick={() => handleAutoFill('month')}
              >
                <Zap className="w-4 h-4 mr-1.5 text-amber-300 fill-amber-300" />
                Fill {format(currentMonth, 'MMMM yyyy')} from Pattern
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button 
                  variant="secondary" 
                  className="w-full text-[11px] py-2 font-extrabold border-slate-300 hover:bg-slate-50 shadow-2xs"
                  onClick={() => handleAutoFill('week')}
                >
                  Fill Next Week
                </Button>
                <Button 
                  variant="secondary" 
                  className="w-full text-[11px] py-2 font-extrabold border-slate-300 hover:bg-slate-50 shadow-2xs"
                  onClick={() => handleAutoFill('quarter')}
                >
                  Fill Next Quarter
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Right / Bottom: Interactive Remote Schedule Calendar */}
        <div className="xl:col-span-8 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md p-5">
            {/* Calendar Header & Month Navigation */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80 mb-4">
              <div className="flex items-center space-x-3">
                <div className="flex items-center rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                  <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-colors">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => setCurrentMonth(new Date(2026, 7, 1))} className="px-3 py-1.5 bg-white font-bold text-xs text-slate-800 hover:bg-slate-50 border-x border-slate-200">
                    Today (Aug '26)
                  </button>
                  <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <h3 className="text-lg font-extrabold text-slate-900 min-w-[150px]">
                  {format(currentMonth, 'MMMM yyyy')}
                </h3>
              </div>
              <div className="flex items-center space-x-3 text-xs text-slate-600">
                <span className="flex items-center font-medium"><span className="w-2.5 h-2.5 rounded-full bg-cyan-500 mr-1.5" /> Remote (GR)</span>
                <span className="flex items-center font-medium"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 mr-1.5" /> Abroad</span>
                <span className="flex items-center font-medium"><span className="w-2.5 h-2.5 rounded-full bg-slate-400 mr-1.5" /> Office HQ</span>
              </div>
            </div>

            {/* Weekday Header with Mobile Swipe Support */}
            <div className="overflow-x-auto mt-2">
              <div className="min-w-[700px] w-full">
                <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80 text-center text-xs font-extrabold text-slate-600 uppercase tracking-wider py-2.5 rounded-t-xl">
                  <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div>
                  <div className="text-slate-400">Sat</div><div className="text-slate-400">Sun</div>
                </div>

            {/* Month Day Cells Grid */}
            <div className="grid grid-cols-7 auto-rows-[minmax(95px,_auto)] divide-x divide-y divide-slate-200/80 bg-slate-200/20 rounded-b-xl overflow-hidden">
              {calendarDays.map((day) => {
                return (
                  <div
                    key={day.dateStr}
                    onClick={() => handleDateClick(day)}
                    className={`p-2 transition-all flex flex-col justify-between relative group select-none ${
                      !day.isCurrentMonth
                        ? 'bg-slate-50/60 text-slate-400 opacity-60'
                        : day.isWeekend
                          ? 'bg-slate-50 text-slate-400'
                          : day.isToday
                            ? 'bg-blue-50/30 ring-2 ring-inset ring-[#3D87D3] cursor-pointer hover:bg-blue-50/50'
                            : 'bg-white hover:bg-slate-50 cursor-pointer'
                    }`}
                  >
                    {/* Top Date Bar */}
                    <div className="flex items-center justify-between mb-1.5">
                      {day.isPast && day.isCurrentMonth && !day.isWeekend && (
                        <span title="Past record locked. Click to request amendment." className="text-[10px] text-slate-400 flex items-center font-semibold">
                          <Lock className="w-3 h-3 mr-0.5 text-slate-400" /> Past
                        </span>
                      )}
                      {!day.isPast && day.isCurrentMonth && !day.isWeekend && !day.isHoliday && !day.isOnLeave && (
                        <span className="text-[10px] text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity font-extrabold">
                          Click to set
                        </span>
                      )}
                      <span
                        className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ml-auto ${
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

                    {/* Cell Schedule Status */}
                    <div className="flex-1 flex flex-col justify-center">
                      {day.isHoliday && (
                        <span className="px-2 py-1 rounded-md bg-purple-100 text-purple-900 text-[10px] font-extrabold truncate text-center shadow-2xs">
                          🎉 Holiday / Closure
                        </span>
                      )}
                      {!day.isHoliday && day.isOnLeave && (
                        <span className="px-2 py-1 rounded-md bg-amber-100 text-amber-950 text-[10px] font-extrabold truncate text-center shadow-2xs">
                          🏖️ On Leave
                        </span>
                      )}
                      {!day.isHoliday && !day.isOnLeave && !day.isWeekend && day.isCurrentMonth && (
                        <div className="space-y-1">
                          {day.mode === 'office' && (
                            <div className="px-2 py-1 rounded-md bg-slate-100/90 text-slate-600 text-[11px] font-bold text-center border border-slate-200/80 transition-transform group-hover:scale-[1.02]">
                              🏢 Office HQ
                            </div>
                          )}
                          {day.mode === 'remote_gr' && (
                            <div title={day.isCustom ? (outlookConnected ? 'Extra day — synced to your Outlook calendar as an event' : 'Extra day — connect Microsoft to sync to Outlook') : undefined} className="px-2 py-1 rounded-md bg-cyan-100 text-cyan-950 text-[11px] font-extrabold text-center border border-cyan-300 shadow-2xs transition-transform group-hover:scale-[1.02] flex items-center justify-center gap-1">
                              🏠 Remote GR
                              {day.isCustom && <span className={`inline-flex items-center gap-0.5 text-[8px] font-black uppercase px-1 py-0.5 rounded ${outlookConnected ? 'bg-emerald-500/15 text-emerald-700' : 'bg-slate-400/15 text-slate-500'}`}><RefreshCw className="w-2 h-2" /> Outlook</span>}
                            </div>
                          )}
                          {day.mode === 'remote_abroad' && (
                            <div title={`Abroad: ${day.location || 'Logged'}${day.isCustom ? ' · declared day — synced to Outlook as an extra event' : ''}`} className="px-2 py-1 rounded-md bg-blue-100 text-blue-950 text-[11px] font-extrabold truncate text-center border border-blue-300 shadow-2xs transition-transform group-hover:scale-[1.02] flex items-center justify-center gap-1">
                              ✈️ Abroad
                              {day.isCustom && <span className={`inline-flex items-center gap-0.5 text-[8px] font-black uppercase px-1 py-0.5 rounded shrink-0 ${outlookConnected ? 'bg-emerald-500/15 text-emerald-700' : 'bg-slate-400/15 text-slate-500'}`}><RefreshCw className="w-2 h-2" /> Outlook</span>}
                            </div>
                          )}
                          {day.pendingAmendment && (
                            <div className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300/80 text-[9px] font-extrabold text-center flex items-center justify-center animate-pulse">
                              <RefreshCw className="w-2.5 h-2.5 mr-1 animate-spin" /> Amendment Pending
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Modal for Declaring or Requesting Amendment */}
      {actionModalMode && selectedDateForAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center">
                {actionModalMode === 'amend' ? (
                  <>
                    <Lock className="w-5 h-5 mr-2 text-amber-600" /> Request Past Record Amendment
                  </>
                ) : (
                  <>
                    <Globe className="w-5 h-5 mr-2 text-[#3D87D3]" /> Declare Remote Schedule
                  </>
                )}
              </h3>
              <button onClick={() => { setActionModalMode(null); setSelectedDateForAction(null); }} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleModalSubmit} className="space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 font-medium">
                Target Date: <strong className="text-slate-900 text-sm font-mono ml-1">{selectedDateForAction}</strong>
                {actionModalMode === 'amend' && !isAdmin && (
                  <p className="text-[11px] text-amber-900 mt-1.5 flex items-start">
                    <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-600 shrink-0 mt-0.5" />
                    Past dates are protected for ΕΡΓΑΝΗ audit compliance. Submitting this form creates a formal modification request for Admin approval.
                  </p>
                )}
              </div>

              <div>
                <label className="block font-bold uppercase text-slate-700 mb-1.5">Selected Work Location</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetMode('office')}
                    className={`p-2.5 rounded-xl font-extrabold border transition-all flex flex-col items-center justify-center text-center ${
                      targetMode === 'office' ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span>🏢</span>
                    <span className="mt-1">Office HQ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetMode('remote_gr')}
                    className={`p-2.5 rounded-xl font-extrabold border transition-all flex flex-col items-center justify-center text-center ${
                      targetMode === 'remote_gr' ? 'bg-[#3D87D3] text-white border-[#3D87D3] shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span>🏠</span>
                    <span className="mt-1">Remote (GR)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetMode('remote_abroad')}
                    className={`p-2.5 rounded-xl font-extrabold border transition-all flex flex-col items-center justify-center text-center ${
                      targetMode === 'remote_abroad' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span>✈️</span>
                    <span className="mt-1">Abroad</span>
                  </button>
                </div>
              </div>

              {targetMode === 'remote_abroad' && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2 text-amber-900">
                  <span className="font-extrabold flex items-center text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-amber-600" /> MANDATORY ABROAD LOCATION
                  </span>
                  <input 
                    type="text" 
                    placeholder="e.g. Berlin, Germany or Madrid, Spain"
                    value={abroadLocation}
                    onChange={e => setAbroadLocation(e.target.value)}
                    required
                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 font-medium shadow-2xs focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold uppercase text-slate-700 mb-1">
                  {actionModalMode === 'amend' ? 'Mandatory Reason for Past Amendment' : 'Optional Notes / Project Activity'}
                </label>
                <textarea 
                  rows={2}
                  placeholder={actionModalMode === 'amend' ? "e.g. Originally logged remote but had to attend urgent on-site client meeting..." : "e.g. Attending online tech workshop or sprint focus day..."}
                  value={noteOrReason} 
                  onChange={e => setNoteOrReason(e.target.value)} 
                  required={actionModalMode === 'amend'}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-medium shadow-2xs focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
                <Button variant="secondary" type="button" onClick={() => { setActionModalMode(null); setSelectedDateForAction(null); }}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" className="bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-white font-extrabold px-6">
                  {actionModalMode === 'amend' && !isAdmin ? 'Submit Amendment Request &rarr;' : 'Save Declaration &rarr;'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Section: Amendment Requests Queue (Visible if user has requests or is Admin) */}
      {(myAmendmentRequests.length > 0 || pendingAdminQueue.length > 0) && (
        <div className="space-y-4 pt-6 border-t border-slate-200/80">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center">
              <FileText className="w-5 h-5 mr-2 text-amber-600" /> Past Record Amendment Requests
            </h2>
            <Badge variant="info">Audit Compliance Queue</Badge>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* My requests */}
            {myAmendmentRequests.length > 0 && (
              <Card title="My Submitted Amendment Requests" subtitle="Status of past remote work modification submissions" className="shadow-xs border-slate-200">
                <div className="divide-y divide-slate-100 mt-2">
                  {myAmendmentRequests.map(req => (
                    <div key={req.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <span className="font-mono font-bold text-slate-900 text-sm">{req.date}</span>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-slate-600">Requested: <strong className="text-slate-900 font-bold">{req.requested_mode.replace('_', ' ').toUpperCase()}</strong></span>
                          <span className="text-slate-400">|</span>
                          <span className="text-slate-500 italic truncate max-w-[180px]">{req.reason}</span>
                        </div>
                      </div>
                      <div>
                        {req.status === 'pending' && <Badge variant="warning">Pending Approval</Badge>}
                        {req.status === 'approved' && <Badge variant="success">Approved & Updated</Badge>}
                        {req.status === 'rejected' && <Badge variant="error">Rejected</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Admin review queue */}
            {isAdmin && pendingAdminQueue.length > 0 && (
              <Card title="Admin Review Queue: Pending Amendments" subtitle="Review employee requests to update locked past records" className="shadow-sm border-amber-200 bg-amber-50/20">
                <div className="divide-y divide-slate-200 mt-2">
                  {pendingAdminQueue.map(req => {
                    const emp = (profiles || []).find(p => p.id === req.profile_id);
                    return (
                      <div key={req.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div>
                          <p className="font-extrabold text-slate-900 text-sm">{emp ? `${emp.first_name} ${emp.last_name}` : 'Employee'}</p>
                          <p className="text-slate-700 mt-0.5">Target Date: <strong className="font-mono">{req.date}</strong> &rarr; Requesting <strong className="text-[#3D87D3] font-bold">{req.requested_mode.replace('_', ' ').toUpperCase()}</strong></p>
                          <p className="text-slate-600 italic mt-1 bg-white p-2 rounded border border-slate-200/80">"{req.reason}"</p>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          <button 
                            onClick={() => decideRemoteAmendment(req.id, 'approved')}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold transition-all shadow-2xs"
                          >
                            Approve & Update
                          </button>
                          <button 
                            onClick={() => decideRemoteAmendment(req.id, 'rejected')}
                            className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold transition-all border border-rose-200"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
