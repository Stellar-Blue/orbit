"use client";

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { 
  format, startOfWeek, endOfWeek, addMonths, subMonths, 
  startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, 
  isSameDay, parseISO, isWithinInterval 
} from 'date-fns';
import { Card, StatCard, Badge, Button } from '@/components/ui/primitives';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import { 
  Users, FileText, Calendar as CalendarIcon, DollarSign, AlertTriangle, 
  CheckCircle, ArrowUpRight, Clock, MapPin, Sparkles, Plus,
  CalendarDays, ChevronLeft, ChevronRight, Search, Globe,
  ShieldCheck, Building2, Info, X, FileCheck, Zap, AlertCircle, RefreshCw
} from 'lucide-react';
import { Profile, LeaveRequest, PublicHoliday, MandatoryLeave, LeaveType } from '@/lib/types';
import { calculateContractValuation, getContractNoticeStatus, calculateInvoiceAmountForPeriod, calculateManHoursCharge } from '@/lib/pricing-engine';

const BillingActionGrid = dynamic(() => import('@/components/billing/billing-action-grid').then(m => m.BillingActionGrid), { ssr: false });

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
    currentUser, profiles, teams, contracts, invoices, addInvoice, catalogModules, catalogItems, leaveRequests, leaveTypes, 
    entitlements, salaries, remoteDays, remotePatterns, remotePolicies, 
    mandatoryLeaves, publicHolidays, getEmployeeLeaveBalance, integrationExceptions, integrationLastReconciledAt, timesheets 
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
    const employerCont = sal.employer_cost_pct ? sal.gross_amount * (sal.employer_cost_pct / 100) : 0;
    return acc + sal.gross_amount + employerCont;
  }, 0);

  const urgentContracts = contracts.filter(c => getContractNoticeStatus(c).isUrgent).slice(0, 5);
  const pendingLeaves = leaveRequests.filter(r => r.status === 'pending');

  // --- 3. EMPLOYEE LEAVE HELPER ---
  const myEntitlement = entitlements.find(e => e.profile_id === currentUser.id && e.year === 2026);
  const myLeavesTaken = getEmployeeLeaveBalance(currentUser.id, 2026).taken;

  // --- 3.5. UNBILLED CONTRACT & INVOICING ACTION ENGINE ---
  const [generatedDraftIds, setGeneratedDraftIds] = useState<Record<string, string>>({});
  const currentPeriodStr = useMemo(() => format(new Date(), 'yyyy-MM'), []);
  const currentQuarterStr = useMemo(() => `Q${Math.floor(new Date().getMonth() / 3) + 1} ${new Date().getFullYear()}`, []);

  const pendingInvoicesQueue = useMemo(() => {
    const results: Array<{
      contractId: string;
      reference: string;
      counterpartyId: string;
      counterpartyName: string;
      direction: 'revenue' | 'cost';
      cadence: string;
      timing: string;
      periodLabel: string;
      periodKey: string; // machine-comparable key e.g. "2026-01" or "2026-Q1"
      periodFrom: string;
      periodTo: string;
      expectedAmount: number;
      currency: string;
      dueDate: string;
      status: 'unbilled' | 'draft_created' | 'billed';
      invoiceId?: string;
    }> = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    (contracts || []).forEach(cnt => {
      if (cnt.status !== 'active' && cnt.status !== 'in_negotiation') return;

      const val = calculateContractValuation(cnt.lines || [], cnt.discount_pct || 0, cnt.term_years || 1, cnt.service_start_date || cnt.starts_on, catalogModules || [], catalogItems || [], cnt.value || 0, cnt.billing_cadence);

      // Determine the start of billing periods to check
      const startDateStr = cnt.service_start_date || cnt.starts_on;
      if (!startDateStr) return;
      const startDate = new Date(startDateStr + 'T00:00:00');

      const cadence = cnt.billing_cadence || 'monthly';

      // Helper: get period key + label + boundaries for a given cursor date
      const getPeriodInfo = (cursor: Date): { key: string; label: string; from: string; to: string } => {
        if (cadence === 'monthly') {
          const key = format(cursor, 'yyyy-MM');
          const from = format(new Date(cursor.getFullYear(), cursor.getMonth(), 1), 'yyyy-MM-dd');
          const to = format(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), 'yyyy-MM-dd');
          return { key, label: `Monthly (${key})`, from, to };
        } else if (cadence === 'quarterly') {
          const q = Math.floor(cursor.getMonth() / 3);
          const year = cursor.getFullYear();
          const key = `${year}-Q${q + 1}`;
          const from = format(new Date(year, q * 3, 1), 'yyyy-MM-dd');
          const to = format(new Date(year, q * 3 + 3, 0), 'yyyy-MM-dd');
          return { key, label: `Q${q + 1} ${year}`, from, to };
        } else if (cadence === 'annual') {
          const year = cursor.getFullYear();
          const key = `${year}`;
          const from = format(new Date(year, 0, 1), 'yyyy-MM-dd');
          const to = format(new Date(year, 11, 31), 'yyyy-MM-dd');
          return { key, label: `${year} Annual Term`, from, to };
        } else {
          // one_off / milestone — single period from start date
          const key = format(startDate, 'yyyy-MM-dd');
          return { key, label: cadence === 'one_off' ? 'One-off Delivery' : 'Milestone Settlement', from: startDateStr, to: format(today, 'yyyy-MM-dd') };
        }
      };

      // Advance cursor to the next billing period boundary
      const advanceCursor = (cursor: Date): Date => {
        const next = new Date(cursor);
        if (cadence === 'monthly') next.setMonth(next.getMonth() + 1);
        else if (cadence === 'quarterly') next.setMonth(next.getMonth() + 3);
        else if (cadence === 'annual') next.setFullYear(next.getFullYear() + 1);
        else return new Date(today.getTime() + 1); // stop after one pass for one_off/milestone
        return next;
      };

      // Collect all billing period keys that should have been invoiced by now
      const periods: Array<ReturnType<typeof getPeriodInfo>> = [];
      const seenKeys = new Set<string>();
      let cursor = new Date(startDate);

      // For end_of_period timing, a period is due when it has ended; for start_of_period it is due when it begins
      const timingIsEnd = cnt.invoice_timing === 'end_of_period';

      while (true) {
        const info = getPeriodInfo(cursor);
        if (seenKeys.has(info.key)) break; // safety guard
        seenKeys.add(info.key);

        // The invoice is due at start or end of this period
        const dueAt = timingIsEnd ? new Date(info.to + 'T00:00:00') : new Date(info.from + 'T00:00:00');
        if (dueAt > today) break; // not yet due

        periods.push(info);

        if (cadence === 'one_off' || cadence === 'milestone') break; // only one period ever
        cursor = advanceCursor(cursor);
        if (cursor > today && cursor.getTime() - today.getTime() > 366 * 86400000) break; // safety
      }

      if (periods.length === 0) return;

      // Amount per period — respects line-item frequencies vs contract billing cadence.
      // Annual lines only appear on the first/last period of the year;
      // Quarterly lines only on the first/last period of the quarter.
      const getAmt = (period: { from: string; to: string }): number => {
        const cntLines = cnt.lines || [];
        const startDateForCalc = cnt.service_start_date || cnt.starts_on || period.from;

        // Man-hours are billed from logged timesheets (hours × rate per man-hours line)
        const manHours = calculateManHoursCharge(cntLines as any, (timesheets || []), period.from, period.to);

        let base = 0;
        // If we have structured line items, use the frequency-aware calculator
        if (cntLines.length > 0) {
          base = calculateInvoiceAmountForPeriod(
            cntLines as any,
            period.from,
            period.to,
            cnt.invoice_timing || 'start_of_period',
            cadence,
            startDateForCalc,
            cnt.discount_pct || 0,
            catalogModules || [],
            catalogItems || []
          );
        }
        if (base > 0 || manHours > 0) return base + manHours;

        // Fallback to valuation-based estimate when no structured lines exist
        const schedItem = (cnt.schedule || []).find(s => s.period === period.from.slice(0, 7));
        if (schedItem) return schedItem.amount;
        if (cadence === 'annual') return val.netARR || (cnt.value || 0);
        if (cadence === 'quarterly') return (val.netARR / 4) || ((cnt.value || 0) / 4);
        if (cadence === 'monthly') return val.netMonthlyMRR || ((cnt.value || 0) / 12);
        return val.totalContractValue || (cnt.value || 0);
      };

      periods.forEach(period => {
        const expectedAmt = getAmt(period);
        if (expectedAmt <= 0 && !cnt.value) return; // skip periods with no billable amount

        // Check if invoice already exists for this period (checking reference_period first!)
        const existingInv = (invoices || []).find(i => {
          if (i.contract_id !== cnt.id) return false;
          if (i.reference_period && i.reference_period.trim() !== '') {
            return (
              i.reference_period.trim() === period.key ||
              i.reference_period.trim().toLowerCase() === period.key.toLowerCase() ||
              i.reference_period.trim().toLowerCase() === period.label.toLowerCase()
            );
          }
          if (cadence === 'monthly') {
            if (i.period_from && i.period_from.trim() !== '') return i.period_from.startsWith(period.key);
            return (i.issue_date || '').startsWith(period.key);
          }
          if (cadence === 'quarterly') {
            if (i.period_from && i.period_from.trim() !== '') return i.period_from >= period.from && i.period_from <= period.to;
            return (i.issue_date || '') >= period.from && (i.issue_date || '') <= period.to;
          }
          if (cadence === 'annual') {
            if (i.period_from && i.period_from.trim() !== '') return i.period_from.startsWith(period.key.slice(0, 4));
            return (i.issue_date || '').startsWith(period.key.slice(0, 4));
          }
          return true; // one_off/milestone without explicit reference_period
        });

        const draftId = generatedDraftIds[`${cnt.id}::${period.key}`];
        const status: 'unbilled' | 'draft_created' | 'billed' = existingInv
          ? (existingInv.status === 'draft' ? 'draft_created' : 'billed')
          : draftId ? 'draft_created' : 'unbilled';

        results.push({
          contractId: cnt.id,
          reference: cnt.reference,
          counterpartyId: cnt.counterparty_id,
          counterpartyName: cnt.counterparty?.legal_name || 'Unknown Counterparty',
          direction: cnt.direction,
          cadence,
          timing: cnt.invoice_timing || 'start_of_period',
          periodLabel: period.label,
          periodKey: period.key,
          periodFrom: period.from,
          periodTo: period.to,
          expectedAmount: Number(expectedAmt.toFixed(2)),
          currency: cnt.currency || 'EUR',
          dueDate: period.from,
          status,
          invoiceId: existingInv?.id || draftId
        });
      });
    });

    return results.sort((a, b) => {
      const statusScore = { unbilled: 0, draft_created: 1, billed: 2 };
      if (statusScore[a.status] !== statusScore[b.status]) return statusScore[a.status] - statusScore[b.status];
      if (a.direction !== b.direction) return a.direction === 'revenue' ? -1 : 1;
      // Sort by period ascending so oldest unbilled shows first
      if (a.periodKey < b.periodKey) return -1;
      if (a.periodKey > b.periodKey) return 1;
      return b.expectedAmount - a.expectedAmount;
    });
  }, [contracts, invoices, currentPeriodStr, currentQuarterStr, catalogModules, catalogItems, generatedDraftIds, timesheets]);

  const handleQuickCreateInvoice = async (item: typeof pendingInvoicesQueue[0]) => {
    if (!addInvoice) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const dueStr = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
    const year = (item.periodFrom || todayStr).slice(0, 4);
    const invNumber = `INV-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
    
    const newInv = await addInvoice({
      direction: item.direction === 'revenue' ? 'outgoing' : 'incoming',
      counterparty_id: item.counterpartyId,
      contract_id: item.contractId,
      type: 'invoice',
      invoice_number: invNumber,
      issue_date: todayStr,
      due_date: dueStr,
      period_from: item.periodFrom || todayStr,
      period_to: item.periodTo || dueStr,
      reference_period: item.periodKey,
      currency: item.currency,
      fx_rate: 1.0,
      net: Number((item.expectedAmount / 1.24).toFixed(2)),
      vat_rate: '24',
      vat_amount: Number((item.expectedAmount - (item.expectedAmount / 1.24)).toFixed(2)),
      gross: item.expectedAmount,
      gross_eur: item.expectedAmount,
      status: 'draft',
      missing_document: false,
      notes: `Auto-generated draft for contract ${item.reference} (${item.periodLabel} - ${item.timing})`,
      created_via: 'ui'
    });

    if (newInv) {
      const compositeKey = `${item.contractId}::${item.periodKey}`;
      setGeneratedDraftIds(prev => ({ ...prev, [compositeKey]: newInv.id }));
      alert(`Draft invoice #${invNumber} generated for ${item.counterpartyName} — period ${item.periodLabel} (€${item.expectedAmount.toLocaleString()})!`);
    }
  };

  const [actionSearchQuery, setActionSearchQuery] = useState<string>('');
  const [actionFilterStatus, setActionFilterStatus] = useState<string>('all');
  const [actionFilterDirection, setActionFilterDirection] = useState<string>('all');
  const [actionSortBy, setActionSortBy] = useState<'period' | 'amount_desc' | 'amount_asc' | 'counterparty'>('period');

  const filteredActionQueue = useMemo(() => {
    let list = [...pendingInvoicesQueue];
    if (actionSearchQuery.trim()) {
      const q = actionSearchQuery.toLowerCase();
      list = list.filter(item => 
        item.counterpartyName.toLowerCase().includes(q) ||
        (item.reference || '').toLowerCase().includes(q) ||
        item.periodLabel.toLowerCase().includes(q)
      );
    }
    if (actionFilterStatus !== 'all') {
      list = list.filter(item => item.status === actionFilterStatus);
    }
    if (actionFilterDirection !== 'all') {
      list = list.filter(item => item.direction === actionFilterDirection);
    }
    list.sort((a, b) => {
      if (actionSortBy === 'amount_desc') return b.expectedAmount - a.expectedAmount;
      if (actionSortBy === 'amount_asc') return a.expectedAmount - b.expectedAmount;
      if (actionSortBy === 'counterparty') return a.counterpartyName.localeCompare(b.counterpartyName);
      // default 'period': unbilled first, then reverse chronological periodKey
      if (a.status !== b.status) {
        if (a.status === 'unbilled') return -1;
        if (b.status === 'unbilled') return 1;
      }
      return b.periodKey.localeCompare(a.periodKey);
    });
    return list;
  }, [pendingInvoicesQueue, actionSearchQuery, actionFilterStatus, actionFilterDirection, actionSortBy]);

  // --- 4. ORGANIZATIONAL OFFICE & REMOTE ROSTER STATE ---
  const [rosterDate, setRosterDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  
  const teamAttendance = useMemo(() => {
    const activeMembers = (profiles || []).filter(p => p.status === 'active' && p.employment_type !== 'contractor');
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let weekdayStr = 'Mon';
    try {
      const dateObj = new Date(rosterDate + 'T00:00:00');
      if (!isNaN(dateObj.getTime())) {
        weekdayStr = weekdayNames[dateObj.getDay()];
      }
    } catch {
      // fallback
    }

    return activeMembers.map(prof => {
      if (weekdayStr === 'Sat' || weekdayStr === 'Sun') {
        return { profile: prof, mode: 'weekend', source: 'Non-working day' };
      }
      const decl = (remoteDays || []).find(rd => rd.profile_id === prof.id && rd.date === rosterDate);
      if (decl && decl.mode !== 'office') {
        return { profile: prof, mode: decl.mode, location: decl.location, source: 'Declared Remote Log' };
      }
      return { profile: prof, mode: 'office', source: 'Office Routine' };
    });
  }, [profiles, remoteDays, rosterDate]);

  const officeCount = teamAttendance.filter(t => t.mode === 'office').length;
  const remoteCount = teamAttendance.filter(t => t.mode === 'remote_gr' || t.mode === 'remote_abroad').length;

  // --- 5. UNIFIED CALENDAR GRID STATE & ENGINE ---
  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date(2026, 7, 1)); // Default demo view August 2026
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
        const full = `${p.first_name} ${p.last_name} ${p.title || ''}`.toLowerCase();
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Welcome back, {currentUser.first_name}!
            </h1>
            <Badge variant={isAdmin ? 'info' : 'neutral'}>{currentUser.title || 'Team Member'}</Badge>
          </div>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">
            {isAdmin 
              ? "StellarBlue Executive Hub & Unified Calendar — Monitoring attendance, roster schedules, and contract operations."
              : "StellarBlue Unified Home — Inspect organization schedules, review attendance rosters, and manage time off."}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          {!isContractor && (
            <>
              <Link href="/remote">
                <Button variant="outline" className="cursor-pointer font-extrabold text-xs shadow-2xs">
                  <Globe className="w-4 h-4 mr-2 text-cyan-600" /> Log Remote Work
                </Button>
              </Link>
              <Link href="/leave">
                <Button variant="primary" className="cursor-pointer font-extrabold text-xs bg-[#3D87D3] hover:bg-[#3D87D3]/90 shadow-sm">
                  <Plus className="w-4 h-4 mr-1.5" /> Request Leave
                </Button>
              </Link>
            </>
          )}
          <Link href="/people">
            <Button variant="secondary" className="cursor-pointer font-extrabold text-xs">
              <Users className="w-4 h-4 mr-2 text-indigo-600" /> Team Directory
            </Button>
          </Link>
        </div>
      </div>

      {/* 3. ADMIN SECTION: EXECUTIVE METRICS & ALERTS */}
      {isAdmin && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <StatCard 
              title="Fully Loaded Monthly Burn" 
              value={`€${Math.round(monthlyCost).toLocaleString()}`}
              subtitle="Includes employer EFKA & retainer fees"
              icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
              trend="4.2%" trendUp={true}
            />
            <StatCard 
              title="Active Headcount" 
              value={totalHeadcount} 
              subtitle={`${fullTimeCount} Full-time · ${contractorCount} Contractors`}
              icon={<Users className="w-5 h-5 text-blue-600" />}
            />
            <StatCard 
              title="Pending Approval Queue" 
              value={pendingLeaves.length}
              subtitle={pendingLeaves.length > 0 ? "Requires Founder decision" : "Queue fully cleared!"}
              icon={<CalendarIcon className="w-5 h-5 text-amber-500" />}
            />
            <StatCard 
              title="Contract Notice Alerts" 
              value={urgentContracts.length > 0 ? `${urgentContracts.length} Urgent` : "0 Urgent"}
              subtitle={urgentContracts.length > 0 ? "Notice closing within 60 days" : "All renewals secure!"}
              icon={<AlertTriangle className={`w-5 h-5 ${urgentContracts.length > 0 ? 'text-rose-500' : 'text-slate-400'}`} />}
            />
          </div>

          {/* Integrations health widget */}
          {(() => {
            const totalExceptions = integrationExceptions.exceptions.length + integrationExceptions.revoked.length;
            const healthy = totalExceptions === 0;
            return (
              <Link href="/settings" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border bg-gradient-to-r from-indigo-50/70 to-slate-50/70 border-indigo-200/60 hover:border-indigo-300 hover:shadow-xs transition-all no-underline group">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${healthy ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-200' : 'bg-amber-500/10 text-amber-600 border border-amber-200'}`}>
                    <RefreshCw className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      Integrations
                      {healthy
                        ? <Badge variant="success" className="text-[9px] px-1.5 py-0">All mirrors healthy</Badge>
                        : <Badge variant="warning" className="text-[9px] px-1.5 py-0">{totalExceptions} exceptions</Badge>}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium">
                      Last reconciled: {integrationLastReconciledAt ? new Date(integrationLastReconciledAt).toLocaleString() : 'not yet'} · {integrationExceptions.notConnectedCount} employee(s) not connected to Slack
                    </div>
                  </div>
                </div>
                <span className="text-xs font-bold text-[#3D87D3] group-hover:underline flex items-center gap-1 shrink-0">
                  Manage <ArrowUpRight className="w-3.5 h-3.5" />
                </span>
              </Link>
            );
          })()}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Contract Notice Windows & Renewal Alerts" subtitle="Alert engine protecting against auto-renewing notice lapses" action={<Link href="/contracts" className="text-xs text-[#3D87D3] hover:underline flex items-center font-bold">View All <ArrowUpRight className="w-3.5 h-3.5 ml-1" /></Link>} className="border-slate-200/90 shadow-2xs">
              {urgentContracts.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 text-sm font-medium">
                  <CheckCircle className="w-8 h-8 mx-auto text-emerald-600 mb-2" />
                  No contract notice deadlines closing within the next 60 days. All commercial renewals are secure!
                </div>
              ) : (
                <div className="space-y-3 mt-1">
                  {urgentContracts.map(c => {
                    const isSupplier = c.direction === 'cost';
                    const { noticeDeadlineStr, daysUntilNotice } = getContractNoticeStatus(c);
                    return (
                      <Link key={c.id} href={`/contracts/${c.id}`} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-slate-300 transition-all hover:bg-slate-100/80 hover:shadow-2xs flex items-center justify-between group block">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-sm text-slate-800 group-hover:text-blue-600 transition-colors">{c.counterparty?.legal_name}</span>
                            <Badge variant={isSupplier ? 'warning' : 'success'}>{c.direction.toUpperCase()}</Badge>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">{c.product || c.type} &bull; Ref: <span className="font-mono text-slate-600">{c.reference}</span></p>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-bold text-rose-600 flex items-center justify-end">
                            <Clock className="w-3.5 h-3.5 mr-1 text-rose-600" />
                            Notice: {noticeDeadlineStr}
                          </div>
                          <p className="text-[11px] text-rose-500 font-medium mt-0.5">{daysUntilNotice <= 0 ? 'Deadline passed!' : `In ${daysUntilNotice} days (${c.notice_period_days}-day window)`}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="Founder Approval Queue (Leave Requests)" subtitle="Single-step approval routing to founders queue" action={<Link href="/leave" className="text-xs text-[#3D87D3] hover:underline flex items-center font-bold">Manage Queue <ArrowUpRight className="w-3.5 h-3.5 ml-1" /></Link>} className="border-slate-200/90 shadow-2xs">
              {pendingLeaves.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 text-sm font-medium">
                  <CheckCircle className="w-8 h-8 mx-auto text-emerald-600 mb-2" />
                  All leave requests have been processed. Excellent operational flow!
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingLeaves.map(req => {
                    const requester = profiles.find(p => p.id === req.profile_id);
                    return (
                      <div key={req.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm text-slate-800">{requester?.first_name} {requester?.last_name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{req.working_days} working days ({req.start_date} to {req.end_date})</p>
                        </div>
                        <Link href="/leave">
                          <Button size="sm" variant="primary" className="font-black bg-[#3D87D3]">Review</Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* Pending Contract Invoicing & Revenue Action Center */}
          <Card 
            title="Contract Invoicing & Revenue Action Center"
            subtitle="Automated ledger monitoring across active commercial contracts to ensure timely billing in advance or arrears" 
            action={
              <div className="flex items-center space-x-3">
                {pendingInvoicesQueue.filter(i => i.status === 'unbilled').length > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
                    {pendingInvoicesQueue.filter(i => i.status === 'unbilled').length} Action(s) Needed
                  </span>
                )}
                <Link href="/invoices" className="text-xs text-[#3D87D3] hover:underline flex items-center font-bold">
                  Go to Invoice Ledger <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
                </Link>
              </div>
            } 
            className="border-slate-200/90 shadow-2xs"
          >
            <div className="mt-4 mb-3 flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
                <input
                  type="text"
                  placeholder="Search counterparty, ref, or period..."
                  value={actionSearchQuery}
                  onChange={(e) => setActionSearchQuery(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20 flex-1 min-w-[160px]"
                />
                <select
                  value={actionFilterStatus}
                  onChange={(e) => setActionFilterStatus(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value="all">All Statuses</option>
                  <option value="unbilled">Unbilled Only</option>
                  <option value="draft_created">Draft Created</option>
                  <option value="billed">Invoiced</option>
                </select>
                <select
                  value={actionFilterDirection}
                  onChange={(e) => setActionFilterDirection(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value="all">All Directions</option>
                  <option value="revenue">Revenue Only</option>
                  <option value="cost">Spend Only</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">Sort:</span>
                <select
                  value={actionSortBy}
                  onChange={(e: any) => setActionSortBy(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20"
                >
                  <option value="period">Urgency & Period</option>
                  <option value="amount_desc">Amount (High to Low)</option>
                  <option value="amount_asc">Amount (Low to High)</option>
                  <option value="counterparty">Counterparty Name</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[480px] overflow-y-auto border border-slate-200/80 rounded-xl shadow-inner">
              <BillingActionGrid
              items={filteredActionQueue as any}
              onQuickCreate={(item) => handleQuickCreateInvoice(item as any)}
            />
            </div>
          </Card>
        </div>
      )}

      {/* 4. EMPLOYEE PERSONAL SUMMARY (LEAVE QUOTA) */}
      {!isContractor ? (
        <Card title="My 2026 Annual Leave Quota" subtitle="Managed per employee per year" className="border-slate-200/90 shadow-2xs">
          {myEntitlement ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-6 p-2">
              <div className="flex items-center space-x-5">
                <div className="px-6 py-4 rounded-2xl bg-[#3D87D3]/10 border border-[#3D87D3]/20 flex flex-col justify-center shrink-0">
                  <span className="text-3xl font-black text-[#3D87D3] leading-none">
                    {myEntitlement.entitlement_days + myEntitlement.carried_over_days - myLeavesTaken}
                  </span>
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600 mt-1">Days Remaining</span>
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Your Available Time Off</h3>
                  <p className="text-xs text-slate-500 max-w-sm mt-0.5">
                    Plan your breaks and time away. Submit requests directly via the leave management workspace.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 text-xs font-semibold bg-slate-50 p-4 rounded-xl border border-slate-200/80 shrink-0">
                <div>
                  <span className="text-slate-400 text-[11px] block">Entitlement</span>
                  <span className="font-bold text-slate-800 text-sm">{myEntitlement.entitlement_days} d</span>
                </div>
                <div className="w-px h-8 bg-slate-200 hidden sm:block" />
                <div>
                  <span className="text-slate-400 text-[11px] block">Carried Over</span>
                  <span className="font-extrabold text-emerald-600 text-sm">+{myEntitlement.carried_over_days} d</span>
                </div>
                <div className="w-px h-8 bg-slate-200 hidden sm:block" />
                <div>
                  <span className="text-slate-400 text-[11px] block">Taken / Approved</span>
                  <span className="font-extrabold text-rose-600 text-sm">-{myLeavesTaken} d</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl font-medium">
              <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-amber-600" />
              Entitlement not yet set for 2026 &mdash; please contact a founder/admin to configure your annual quota.
            </div>
          )}
        </Card>
      ) : (
        <Card title="Contractor Retainer Summary & Invoicing" subtitle="StellarBlue contractor partner workspace" className="border-slate-200/90 shadow-2xs">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div>
              <p className="text-slate-800 font-bold">Active Contractor Agreement</p>
              <p className="text-xs text-slate-500 mt-0.5">Invoicing via monthly fixed-fee retainer or day-rate block.</p>
            </div>
            <Badge variant="info" className="font-bold">External Partner</Badge>
          </div>
        </Card>
      )}

      {/* 5. ORGANIZATIONAL OFFICE & REMOTE ROSTER (Moved from /remote to Unified Homepage) */}
      <div className="space-y-4 pt-6 border-t border-slate-200/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center">
              <Building2 className="w-6 h-6 mr-2.5 text-emerald-600" /> Organizational Office &amp; Remote Roster
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Live daily schedule inspection across all departments based on declared remote work logs.
            </p>
          </div>
          <div className="flex items-center space-x-2 text-xs font-bold">
            <Badge variant="neutral">{officeCount} at Office HQ</Badge>
            <Badge variant="info">{remoteCount} working Remotely</Badge>
          </div>
        </div>

        <Card className="shadow-xs border-slate-200/90">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80 mb-5">
            <div className="flex items-center space-x-2.5">
              <CalendarIcon className="w-4 h-4 text-slate-500 shrink-0" />
              <label htmlFor="roster-date-picker" className="text-xs font-extrabold uppercase tracking-wider text-slate-700 select-none">
                Inspect Date:
              </label>
              <input
                id="roster-date-picker"
                type="date"
                value={rosterDate}
                onChange={(e) => setRosterDate(e.target.value)}
                className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-900 text-xs font-mono font-bold shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#3D87D3] cursor-pointer"
              />
            </div>
            <span className="text-xs text-slate-600 font-medium">
              Active schedule roster for <strong className="text-slate-900 font-mono font-extrabold">{rosterDate}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {teamAttendance.map((item) => {
              const { profile, mode, location, source } = item;
              return (
                <div 
                  key={profile.id} 
                  className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ProfileAvatar photoUrl={profile.photo_url} firstName={profile.first_name} lastName={profile.last_name} size="md" />
                      <div className="min-w-0">
                        <p className="font-extrabold text-slate-900 text-sm leading-snug truncate">{profile.first_name} {profile.last_name}</p>
                        <p className="text-xs text-slate-500 font-medium truncate">{profile.title || 'Team Member'}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
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
                        <span className="px-2.5 py-1 rounded-md bg-cyan-100 text-cyan-950 text-xs font-extrabold border border-cyan-200 shadow-2xs flex items-center">
                          🏠 Remote (GR)
                        </span>
                      )}
                      {mode === 'remote_abroad' && (
                        <span 
                          title={`Location: ${location || 'Logged in EU'}`}
                          className="px-2.5 py-1 rounded-md bg-blue-100 text-blue-900 text-xs font-extrabold border border-blue-200 shadow-2xs flex items-center truncate max-w-[140px]"
                        >
                          ✈️ Abroad {location ? `(${location})` : ''}
                        </span>
                      )}
                      {mode === 'weekend' && (
                        <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-500 text-xs font-bold">
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

      {/* 6. UNIFIED COMPANY & TEAM CALENDAR */}
      <div className="space-y-4 pt-6 border-t border-slate-200/80">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center">
                <CalendarDays className="w-6 h-6 mr-2.5 text-[#3D87D3]" /> Company&apos;s Calendar
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Comprehensive organizational schedule combining daily remote logs, approved leave requests, and celebrations.
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
                  className="h-8 pl-3 pr-7 py-0 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-white text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#3D87D3] cursor-pointer shadow-2xs transition-all"
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
                  className="w-full h-8 pl-7 pr-7 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-white placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#3D87D3] shadow-2xs transition-all"
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
                        ? 'bg-white text-[#3D87D3] shadow-2xs font-extrabold'
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
                                  ? 'bg-blue-50/30 ring-2 ring-inset ring-[#3D87D3]'
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
                                  title={`${prof.first_name} ${prof.last_name} — ${displayType} (${req.start_date} to ${req.end_date})`}
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
                          {(p as any).avatar_url ? (
                            <img src={(p as any).avatar_url} alt={p.first_name} className="w-7 h-7 rounded-full object-cover border border-slate-200 shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-cyan-100/80 text-cyan-800 border border-cyan-200/60 font-bold text-[11px] flex items-center justify-center shrink-0 tracking-tighter">
                              {p.first_name[0]}{p.last_name[0]}
                            </div>
                          )}
                          <div className="truncate">
                            <span className="text-xs font-bold text-slate-800 tracking-tight block truncate">
                              {p.first_name} {p.last_name}
                            </span>
                            {p.title && (
                              <span className="text-[10px] text-slate-400 block truncate font-medium">
                                {p.title}
                              </span>
                            )}
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
                                className={`h-6 bg-[#3D87D3] text-white flex items-center justify-center text-[9px] font-bold shadow-2xs ${
                                  prevOnLeave ? 'rounded-l-none ml-0' : 'rounded-l-md ml-0.5'
                                } ${
                                  nextOnLeave ? 'rounded-r-none mr-0' : 'rounded-r-md mr-0.5'
                                }`}
                              />
                            )}
                            {!isOnLeave && remoteInfo && (
                              <div
                                title={`${p.first_name} ${p.last_name}: Working Remotely (${remoteInfo.mode === 'remote_abroad' ? 'Abroad' : 'GR'})`}
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

      {/* 7. INTERACTIVE DAY DETAILS MODAL / SLIDE-OVER */}
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
                          <span className="font-extrabold text-slate-800">{l.profile.first_name} {l.profile.last_name}</span>
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
                          <span className="font-extrabold text-slate-800 flex items-center">
                            {r.mode === 'remote_abroad' ? <Globe className="w-3.5 h-3.5 mr-1 text-blue-600" /> : <MapPin className="w-3.5 h-3.5 mr-1 text-cyan-600" />}
                            {r.profile.first_name} {r.profile.last_name}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono font-bold">{r.profile.team?.name || 'Staff'}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-cyan-800 capitalize">
                            {r.mode === 'remote_abroad' ? `Abroad: ${r.location || 'International'}` : 'Remote (Greece)'}
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
                      <div key={idx} className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold flex items-center">
                        <Building2 className="w-3 h-3 mr-1 text-slate-500" />
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
                  className="px-4 py-2 rounded-xl bg-[#3D87D3] hover:bg-blue-600 text-white font-black text-xs transition-all flex items-center shadow-xs"
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
