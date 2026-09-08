"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button } from '@/components/ui/primitives';
import { CalendarDays, Save, CheckCircle2 } from 'lucide-react';

/**
 * Company-wide DEFAULT annual leave days. This is the fallback an employee gets when no
 * per-year entitlement record exists for them (see People → Edit Profile → Annual Leave
 * Entitlement for per-employee/per-year overrides).
 */
export function LeaveDefaultsCard() {
  const { leaveDefaultDays, saveLeavePolicy } = useAuth();
  const [pending, setPending] = useState('');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const n = parseFloat(pending);
    if (isNaN(n) || n < 0) { alert('Enter a valid number of days (0+).'); return; }
    const ok = await saveLeavePolicy({ default_annual_days: n });
    if (ok) {
      setPending('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  return (
    <Card title="Default Annual Leave Allowance" subtitle="Applies to every employee who has no per-year override" className="shadow-xs border-slate-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <CalendarDays className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            Standard leave days granted per calendar year (e.g. <strong className="text-slate-800">22</strong>).
            Employees with more tenure get more, and mid-year joiners get pro-rated fewer — set those per person
            in <strong className="text-slate-800">People → Edit Profile → Annual Leave Entitlement</strong>.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <input
              type="number" min="0" step="0.5"
              value={pending !== '' ? pending : String(leaveDefaultDays)}
              onChange={e => setPending(e.target.value)}
              className="w-28 px-3 py-2 border border-slate-300 rounded-xl bg-white text-center font-black text-lg text-slate-900 shadow-2xs focus:ring-2 focus:ring-[#3D87D3] outline-none"
            />
            <span className="absolute -right-8 inset-y-0 flex items-center text-[10px] font-extrabold text-slate-400">days/yr</span>
          </div>
          <Button variant="primary" size="sm" onClick={save} className="bg-[#3D87D3] text-white cursor-pointer shrink-0">
            <Save className="w-3.5 h-3.5 mr-1.5" /> Save Default
          </Button>
        </div>
      </div>
      {saved && (
        <p className="mt-2 text-[11px] font-bold text-emerald-700 flex items-center gap-1 animate-in fade-in">
          <CheckCircle2 className="w-3.5 h-3.5" /> Default annual allowance saved.
        </p>
      )}
    </Card>
  );
}
