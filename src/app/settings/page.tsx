"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { 
  Settings, Globe, ShieldCheck, CheckCircle2, AlertTriangle, 
  Building2, Sliders, Calendar, Clock, Save, Info, RefreshCw, Sparkles 
} from 'lucide-react';
import { PolicyPeriod, RemotePolicy } from '@/lib/types';

export default function CompanySettingsPage() {
  const { currentUser, remotePolicies, updateRemotePolicy } = useAuth();
  const isAdmin = currentUser.role === 'admin';

  const [selectedTab, setSelectedTab] = useState<'remote' | 'general' | 'notifications'>('remote');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Locate the company-wide remote policy
  const activeCompanyPolicy = remotePolicies.find(p => p.scope_type === 'company');

  // Local state for editing form
  const [maxDays, setMaxDays] = useState<number>(8);
  const [periodType, setPeriodType] = useState<PolicyPeriod>('month');

  useEffect(() => {
    if (activeCompanyPolicy) {
      setMaxDays(activeCompanyPolicy.max_days ?? activeCompanyPolicy.max_days_per_month ?? 8);
      setPeriodType(activeCompanyPolicy.period_type || 'month');
    }
  }, [activeCompanyPolicy, remotePolicies]);

  if (!isAdmin) {
    return (
      <div className="p-10 text-center bg-slate-50 border border-slate-200 rounded-2xl max-w-xl mx-auto my-12 space-y-3 shadow-xs">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-600" />
        <h3 className="text-lg font-bold text-slate-800">Access Restricted: Admin Clearance Required</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          The Company Settings console allows modifying organization-wide compliance parameters and quotas. Your current profile does not have administrative permissions.
        </p>
      </div>
    );
  }

  const handleSaveRemotePolicy = async () => {
    if (!activeCompanyPolicy) {
      alert("No company-wide remote policy found in Supabase database. Please check migrations.");
      return;
    }
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await updateRemotePolicy(activeCompanyPolicy.id, {
        max_days: maxDays,
        period_type: periodType
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err) {
      console.error("Error updating settings:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const getPeriodDisplay = (period: PolicyPeriod) => {
    switch (period) {
      case 'week': return 'Week';
      case 'month': return 'Month';
      case 'quarter': return 'Quarter';
      case 'year': return 'Year';
      default: return 'Month';
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16">
      {/* Header section with modern backdrop */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-[#225287] p-8 text-white shadow-md">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[11px] font-semibold tracking-wider uppercase text-[#73A7E3]">
              <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-300 animate-pulse" />
              <span>Global Organizational Controls</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white flex items-center">
              <Settings className="w-7 h-7 mr-3 text-[#73A7E3]" /> Company Settings & Policies
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl">
              Configure company-wide rules, quotas, and automated compliance thresholds. Changes persisted here directly update our PostgreSQL database and immediately apply across all team member modules.
            </p>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <Badge variant="info">Live Supabase Storage</Badge>
            <span className="text-[11px] text-slate-400 mt-1">Table: public.remote_policies</span>
          </div>
        </div>
        <div className="absolute -right-10 -bottom-10 w-64 h-64 rounded-full bg-[#3D87D3]/20 blur-3xl pointer-events-none" />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6 text-sm font-medium">
        <button
          onClick={() => setSelectedTab('remote')}
          className={`pb-3 border-b-2 transition-all flex items-center space-x-2 ${
            selectedTab === 'remote'
              ? 'border-[#3D87D3] text-[#3D87D3] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Globe className="w-4 h-4" />
          <span>Remote Work Quotas & Patterns</span>
        </button>
        <button
          onClick={() => setSelectedTab('general')}
          className={`pb-3 border-b-2 transition-all flex items-center space-x-2 ${
            selectedTab === 'general'
              ? 'border-[#3D87D3] text-[#3D87D3] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>General Company Profile <span className="ml-1 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-normal">Soon</span></span>
        </button>
        <button
          onClick={() => setSelectedTab('notifications')}
          className={`pb-3 border-b-2 transition-all flex items-center space-x-2 ${
            selectedTab === 'notifications'
              ? 'border-[#3D87D3] text-[#3D87D3] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Automated Alerts & Defaults <span className="ml-1 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-normal">Soon</span></span>
        </button>
      </div>

      {/* Content Section: Remote Work Policy */}
      {selectedTab === 'remote' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Main Configuration Card */}
          <Card 
            title="Remote Work Company Quota" 
            subtitle="Define the legal or policy limits for teleworking across the organization"
            className="lg:col-span-2 shadow-xs border-slate-200/80"
          >
            <div className="space-y-6 pt-2">
              <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-200/60 text-xs text-blue-900 flex items-start space-x-3">
                <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">How quotas govern employee compliance:</p>
                  <p className="text-blue-800/90 leading-relaxed">
                    When employees log remote work days or save recurring weekly default patterns, Orbit checks their planned telework schedule against this global limit. Exceeding this quota produces a soft compliance warning without blocking submission.
                  </p>
                </div>
              </div>

              {/* Input Group: Quota Amount & Period */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 tracking-wide mb-2">
                    Max Allowed Days
                  </label>
                  <div className="relative rounded-xl shadow-xs">
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={maxDays}
                      onChange={(e) => setMaxDays(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-lg font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#3D87D3] focus:border-transparent transition-all"
                    />
                    <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-xs text-slate-400 font-semibold">
                      DAYS
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Specify 0 to disable remote work company-wide.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 tracking-wide mb-2">
                    Evaluation Timeframe
                  </label>
                  <select
                    value={periodType}
                    onChange={(e) => setPeriodType(e.target.value as PolicyPeriod)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#3D87D3] focus:border-transparent transition-all cursor-pointer"
                  >
                    <option value="week">Per Week (Weekly Quota)</option>
                    <option value="month">Per Month (Monthly Quota)</option>
                    <option value="quarter">Per Quarter (3-Month Quota)</option>
                    <option value="year">Per Year (Annual Quota)</option>
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Determines the recurring interval for quota reset.
                  </p>
                </div>
              </div>

              {/* Period selection grid cards for quick visual toggling */}
              <div className="pt-2">
                <label className="block text-[11px] font-bold uppercase text-slate-500 tracking-wider mb-3">
                  Quick Select Timeframe
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(['week', 'month', 'quarter', 'year'] as PolicyPeriod[]).map((period) => {
                    const isActive = periodType === period;
                    return (
                      <button
                        key={period}
                        type="button"
                        onClick={() => setPeriodType(period)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isActive
                            ? 'bg-[#3D87D3]/10 border-[#3D87D3] ring-1 ring-[#3D87D3]/50 text-[#3D87D3] shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <div className="text-xs font-bold capitalize">{period}ly</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {period === 'week' && '7-day rolling interval'}
                          {period === 'month' && 'Calendar monthly limit'}
                          {period === 'quarter' && 'Q1-Q4 evaluation'}
                          {period === 'year' && 'Full calendar year'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs">
                  {saveSuccess && (
                    <span className="flex items-center text-emerald-600 font-bold animate-fadeIn">
                      <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-500" />
                      Policy successfully updated in Supabase!
                    </span>
                  )}
                </div>
                <Button 
                  onClick={handleSaveRemotePolicy}
                  disabled={isSaving}
                  variant="primary"
                  className="px-6 py-2.5 rounded-xl shadow-xs hover:shadow-md transition-all text-sm flex items-center space-x-2"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      <span>Saving to DB...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      <span>Save Global Quota</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>

          {/* Live Preview / Impact KPI Card */}
          <div className="space-y-6">
            <Card 
              title="Live Employee UI Impact Preview" 
              subtitle="Preview of employee dashboard widgets"
              className="bg-slate-50 border-slate-200 shadow-xs"
            >
              <div className="space-y-4 pt-1">
                <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-slate-500">Company Policy Status</span>
                    <Badge variant="success">
                      Max {maxDays} {maxDays === 1 ? 'Day' : 'Days'} / {getPeriodDisplay(periodType)}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600 border-l-2 border-emerald-500 pl-3 py-0.5">
                    Within company threshold for this {periodType}.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-slate-500">Over-Quota Warning Example</span>
                    <Badge variant="warning">
                      Exceeded Limit
                    </Badge>
                  </div>
                  <p className="text-xs text-amber-700 border-l-2 border-amber-500 pl-3 py-0.5 font-medium">
                    Soft warning: Planned schedule exceeds company policy limit ({maxDays} days per {periodType}).
                  </p>
                </div>

                <div className="text-[11px] text-slate-500 leading-relaxed pt-2 border-t border-slate-200">
                  <span className="font-semibold text-slate-700 block mb-1">Scope & Applicability</span>
                  Currently enforced at the <span className="font-semibold text-slate-800">Company Level</span> for all employees except designated independent contractors.
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Placeholders for Future Setting Modules */}
      {selectedTab !== 'remote' && (
        <Card className="p-12 text-center border-dashed border-slate-300 bg-slate-50/50 rounded-2xl">
          <Sliders className="w-12 h-12 mx-auto text-slate-300 mb-3" />
          <h3 className="text-base font-bold text-slate-700">Module Currently Under Architecture</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
            We are structuring database schemas for additional operational setting modules. Select the <strong>Remote Work Quotas & Patterns</strong> tab to manage teleworking rules.
          </p>
        </Card>
      )}
    </div>
  );
}
