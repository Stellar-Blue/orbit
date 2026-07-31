"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card, StatCard, Badge, Button } from '@/components/ui/primitives';
import { 
  Users, FileText, Calendar, DollarSign, AlertTriangle, 
  CheckCircle, ArrowUpRight, Clock, MapPin, Sparkles, Plus 
} from 'lucide-react';

export default function DashboardPage() {
  const { currentUser, profiles, contracts, leaveRequests, entitlements, salaries, remoteDays, remotePatterns, remotePolicies, getEmployeeLeaveBalance } = useAuth();
  const isAdmin = currentUser.role === 'admin';
  const isContractor = currentUser.employment_type === 'contractor';

  // Calculations for Admin view
  const totalHeadcount = profiles.filter(p => p.status === 'active').length;
  const fullTimeCount = profiles.filter(p => p.status === 'active' && p.employment_type === 'full_time').length;
  const contractorCount = profiles.filter(p => p.status === 'active' && p.employment_type === 'contractor').length;
  
  // Calculate fully loaded monthly payroll cost
  const monthlyCost = salaries.reduce((acc, sal) => {
    if (sal.valid_to) return acc; // ignore old salary rows
    const employerCont = sal.employer_cost_pct ? sal.gross_amount * (sal.employer_cost_pct / 100) : 0;
    return acc + sal.gross_amount + employerCont;
  }, 0);

  // Notice deadlines within next 90 days or expired notice
  const urgentContracts = contracts.filter(c => c.status === 'active' || c.status === 'expiring').slice(0, 3);
  const pendingLeaves = leaveRequests.filter(r => r.status === 'pending');

  // Employee personal leave entitlement
  const myEntitlement = entitlements.find(e => e.profile_id === currentUser.id && e.year === 2026);
  const myLeavesTaken = getEmployeeLeaveBalance(currentUser.id, 2026).taken;

  const myExistingPatterns = (remotePatterns || []).filter(rp => rp.profile_id === currentUser.id);
  const getPatternMode = (day: string) => {
    const found = myExistingPatterns.find(p => p.weekday === day);
    return found ? found.mode : (day === 'Tue' || day === 'Thu' ? 'remote_gr' : 'office');
  };
  const weeklyRemoteDaysCount = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].filter(day => {
    const m = getPatternMode(day);
    return m === 'remote_gr' || m === 'remote_abroad';
  }).length;
  const companyPolicy = (remotePolicies || []).find(p => p.scope_type === 'company');
  const quotaMaxDays = companyPolicy ? (companyPolicy.max_days ?? companyPolicy.max_days_per_month ?? 8) : 8;
  const quotaPeriod = companyPolicy ? (companyPolicy.period_type || 'month') : 'month';

  let plannedDaysForPeriod = weeklyRemoteDaysCount * 4;
  if (quotaPeriod === 'week') plannedDaysForPeriod = weeklyRemoteDaysCount;
  else if (quotaPeriod === 'quarter') plannedDaysForPeriod = weeklyRemoteDaysCount * 13;
  else if (quotaPeriod === 'year') plannedDaysForPeriod = weeklyRemoteDaysCount * 52;

  const isPatternCompliant = plannedDaysForPeriod <= quotaMaxDays;
  const periodLabel = quotaPeriod === 'week' ? 'wk' : quotaPeriod === 'quarter' ? 'qtr' : quotaPeriod === 'year' ? 'yr' : 'mo';
  const periodFullLabel = quotaPeriod === 'week' ? 'week' : quotaPeriod === 'quarter' ? 'quarter' : quotaPeriod === 'year' ? 'year' : 'month';

  // Setup checklist state for guided initial manual setup (requirements decision)
  const [checklist, setChecklist] = useState({
    profiles: true,
    entitlements: true,
    salaries: true,
    contracts: true,
    reconciliation: false
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Welcome & Context Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
              Welcome back, {currentUser.first_name}!
            </h1>
            <Badge variant={isAdmin ? 'info' : 'neutral'}>{currentUser.title}</Badge>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            {isAdmin 
              ? "StellarBlue Executive Admin Command Center — Monitoring contracts, compliance, and team operations."
              : "StellarBlue Employee Portal — Manage your leave requests, out-of-office schedules, and remote pattern."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isContractor && (
            <Link href="/leave">
              <Button variant="primary" className="cursor-pointer shadow-sm">
                <Plus className="w-4 h-4 mr-2" /> Request Leave
              </Button>
            </Link>
          )}
          <Link href="/people">
            <Button variant="secondary" className="cursor-pointer">
              <Users className="w-4 h-4 mr-2" /> Team Directory
            </Button>
          </Link>
        </div>
      </div>

      {/* ADMIN SECTION: EXECUTIVE METRICS & CONTRACT ALERTS */}
      {isAdmin && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <StatCard 
              title="Fully Loaded Monthly Burn" 
              value={`€${Math.round(monthlyCost).toLocaleString()}`}
              subtitle="Includes employer EFKA & retainer fees"
              icon={<DollarSign className="w-5 h-5" />}
              trend="4.2%" trendUp={true}
            />
            <StatCard 
              title="Active Headcount" 
              value={totalHeadcount} 
              subtitle={`${fullTimeCount} Full-time · ${contractorCount} Contractors`}
              icon={<Users className="w-5 h-5" />}
            />
            <StatCard 
              title="Pending Approval Queue" 
              value={pendingLeaves.length}
              subtitle={pendingLeaves.length > 0 ? "Requires Founder decision" : "Queue fully cleared!"}
              icon={<Calendar className="w-5 h-5" />}
            />
            <StatCard 
              title="Contract Notice Alerts" 
              value="2 Urgent"
              subtitle="Notice closing within 60 days"
              icon={<AlertTriangle className="w-5 h-5" />}
            />
          </div>

          {/* First-run Manual Setup Guide Checklist (Per confirmed decisions log) */}
          <Card title="Orbit Initial Setup & Guided Onboarding Checklist" subtitle="Track progress of manual data population across StellarBlue core domains">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-2">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-emerald-200 flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-emerald-700 font-semibold mb-2">
                  <span>1. People Directory</span>
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                </div>
                <p className="text-[11px] text-slate-600">All 11 initial profiles populated with employment types and schedules.</p>
              </div>
              
              <div className="p-3.5 rounded-xl bg-slate-50 border border-emerald-200 flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-emerald-700 font-semibold mb-2">
                  <span>2. Leave Entitlements</span>
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                </div>
                <p className="text-[11px] text-slate-600">2026 annual leave quotas manually seeded per accountant directives.</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-emerald-200 flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-emerald-700 font-semibold mb-2">
                  <span>3. Compensation Ledger</span>
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                </div>
                <p className="text-[11px] text-slate-600">Effective-dated salary records entered. Ready for 14-salary payroll run.</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-emerald-200 flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-emerald-700 font-semibold mb-2">
                  <span>4. Contract Registry</span>
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                </div>
                <p className="text-[11px] text-slate-600">Client (Atlas ETRM/EMS) & Supplier contracts with notice deadlines set.</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-amber-200 flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-amber-700 font-semibold mb-2">
                  <span>5. ΕΡΓΑΝΗ Reconciliation</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">Pending Run</span>
                </div>
                <p className="text-[11px] text-slate-600">Upload monthly portal Excel export to verify zero filing drift.</p>
              </div>
            </div>
          </Card>

          {/* Urgent Admin Queue & Notice Alert Widgets */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Contract Notice Windows & Renewal Alerts" subtitle="The high-ROI alert engine protecting against auto-renewing supplier notice lapses" action={<Link href="/contracts" className="text-xs text-[#3D87D3] hover:underline flex items-center font-medium">View All <ArrowUpRight className="w-3 h-3 ml-1" /></Link>}>
              <div className="space-y-3 mt-1">
                {urgentContracts.map(c => {
                  const isSupplier = c.direction === 'cost';
                  return (
                    <div key={c.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-slate-300 transition-colors flex items-center justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-sm text-slate-800">{c.counterparty?.legal_name}</span>
                          <Badge variant={isSupplier ? 'warning' : 'success'}>{c.direction.toUpperCase()}</Badge>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{c.product || c.type} &bull; Ref: <span className="font-mono text-slate-600">{c.reference}</span></p>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-semibold text-rose-600 flex items-center justify-end">
                          <Clock className="w-3.5 h-3.5 mr-1 text-rose-600" />
                          Notice: {c.notice_deadline}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">{c.notice_period_days}-day notice window</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Founder Approval Queue (Leave Requests)" subtitle="Single-step approval routing to founders queue" action={<Link href="/leave" className="text-xs text-[#3D87D3] hover:underline flex items-center font-medium">Manage Queue <ArrowUpRight className="w-3 h-3 ml-1" /></Link>}>
              {pendingLeaves.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 text-sm">
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
                          <Button size="sm" variant="primary">Review</Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* EMPLOYEE WORKSPACE VIEW (LEAVE & REMOTE PATTERN) */}
      {!isContractor ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card title="2026 Annual Leave Quota" subtitle="Managed manually per employee per year" className="md:col-span-1">
            {myEntitlement ? (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between p-4 rounded-xl bg-[#3D87D3]/10 border border-[#3D87D3]/20">
                  <div>
                    <span className="text-3xl font-extrabold text-[#3D87D3]">{myEntitlement.entitlement_days + myEntitlement.carried_over_days - myLeavesTaken}</span>
                    <span className="text-xs text-slate-600 ml-1.5 font-medium">days remaining</span>
                  </div>
                  <Badge variant="info">2026 Quota</Badge>
                </div>
                <div className="space-y-2 text-xs text-slate-700 border-t border-slate-100 pt-3">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Annual Entitlement:</span>
                    <span className="font-semibold">{myEntitlement.entitlement_days} days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Carried Over (from 2025):</span>
                    <span className="font-semibold text-emerald-700">+{myEntitlement.carried_over_days} days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Approved & Taken:</span>
                    <span className="font-semibold text-rose-600">-{myLeavesTaken} days</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-amber-600" />
                Entitlement not yet set for 2026 &mdash; please contact a founder/admin to configure your annual quota.
              </div>
            )}
          </Card>

          <Card title="My Telework Schedule & Pattern Helper" subtitle="Default routine used to auto-fill your monthly declarations" action={<Link href="/remote" className="text-xs text-[#3D87D3] hover:underline font-bold">Open Schedule Calendar</Link>} className="md:col-span-2">
            <div className="grid grid-cols-5 gap-3 mt-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => {
                const isScheduled = currentUser.work_schedule.includes(day);
                const mode = getPatternMode(day);
                if (!isScheduled) {
                  return (
                    <div key={day} className="p-3.5 rounded-xl bg-slate-100/60 border border-slate-200 text-center text-slate-400">
                      <div className="text-xs font-bold">{day}</div>
                      <div className="text-[11px] mt-2 font-semibold">Non-Working Day</div>
                    </div>
                  );
                }
                return (
                  <div key={day} className={`p-3.5 rounded-xl border text-center transition-all ${mode === 'remote_gr' ? 'bg-[#3D87D3]/10 border-[#3D87D3]/30 text-[#3D87D3]' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                    <div className="text-xs font-bold tracking-wider uppercase text-slate-500">{day}</div>
                    <div className="mt-3 flex items-center justify-center space-x-1 font-semibold text-xs">
                      {mode === 'remote_gr' ? (
                        <>
                          <MapPin className="w-3.5 h-3.5 text-[#3D87D3]" />
                          <span>Remote (GR)</span>
                        </>
                      ) : (
                        <>
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          <span>Office</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Policy limit: Max {quotaMaxDays} remote days / {periodFullLabel}</span>
              <span>Remaining Quota: <strong className="text-[#3D87D3] font-bold">{Math.max(0, quotaMaxDays - (remoteDays || []).filter(r => r.profile_id === currentUser.id && r.mode !== 'office' && r.date.startsWith('2026-08')).length)} days available</strong> in August</span>
            </div>
          </Card>
        </div>
      ) : (
        <Card title="Contractor Retainer Summary & Invoicing" subtitle="StellarBlue contractor partner workspace">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div>
              <p className="text-slate-800 font-semibold">Active Contractor Agreement</p>
              <p className="text-xs text-slate-500 mt-0.5">Invoicing via monthly fixed-fee retainer or day-rate block.</p>
            </div>
            <Badge variant="info">Mplokaki / External Partner</Badge>
          </div>
        </Card>
      )}
    </div>
  );
}
