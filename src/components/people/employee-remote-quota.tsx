"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { RemotePolicy } from '@/lib/types';
import { Button } from '@/components/ui/primitives';
import { Save, Globe, UserRound } from 'lucide-react';

/**
 * Per-employee remote-work quota. When set, overrides the company default; clearing it
 * falls back to the company policy.
 */
export function EmployeeRemoteQuota({ profileId }: { profileId: string }) {
  const { remotePolicies, setEmployeeRemoteQuota } = useAuth();
  const employeePolicy = remotePolicies.find(p => p.scope_type === 'employee' && p.scope_id === profileId);
  const companyPolicy = remotePolicies.find(p => p.scope_type === 'company');
  const companyMax = companyPolicy?.max_days ?? companyPolicy?.max_days_per_month ?? 8;
  const companyPeriod = companyPolicy?.period_type || 'month';

  const [enabled, setEnabled] = useState(!!employeePolicy);
  const [maxDays, setMaxDays] = useState<number>(employeePolicy?.max_days ?? companyMax);
  const [periodType, setPeriodType] = useState<RemotePolicy['period_type']>(employeePolicy?.period_type || companyPeriod);
  const [countsLeave, setCountsLeave] = useState(employeePolicy?.counts_leave ?? false);

  const periodLabel = (p: string) => p === 'week' ? 'week' : p === 'quarter' ? 'quarter' : p === 'year' ? 'year' : 'month';

  const save = async () => {
    await setEmployeeRemoteQuota(profileId, enabled ? { max_days: maxDays, period_type: periodType, counts_leave: countsLeave } : null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
          {employeePolicy ? (
            <><UserRound className="w-3 h-3" /> Personal: <span className="font-bold text-slate-800">{employeePolicy.max_days}/{periodLabel(employeePolicy.period_type || 'month')}</span></>
          ) : (
            <><Globe className="w-3 h-3" /> Company default: <span className="font-bold text-slate-800">{companyMax}/{periodLabel(companyPeriod)}</span></>
          )}
        </span>
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-[#3D87D3]" />
        Custom remote quota for this employee
      </label>
      {enabled && (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Max days</label>
            <input type="number" min={0} max={365} value={maxDays} onChange={e => setMaxDays(Math.max(0, parseInt(e.target.value) || 0))} className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Per</label>
            <select value={periodType} onChange={e => setPeriodType(e.target.value as RemotePolicy['period_type'])} className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </select>
          </div>
          <label className="flex items-end gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer pb-1">
            <input type="checkbox" checked={countsLeave} onChange={e => setCountsLeave(e.target.checked)} className="accent-[#3D87D3]" /> Count leave
          </label>
        </div>
      )}
      <Button variant="primary" size="sm" onClick={save} className="cursor-pointer"><Save className="w-3 h-3 mr-1" /> Save Remote Quota</Button>
    </div>
  );
}
