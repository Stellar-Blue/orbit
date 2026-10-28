"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { notifySuccess } from '@/lib/validation-modal';
import { CalendarDays, Save, CheckCircle2, Info, Infinity as InfinityIcon, AlertTriangle } from 'lucide-react';
import { carryoverExpiryDate } from '@/lib/leave-carryover';

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
              className="w-28 px-3 py-2 border border-slate-300 rounded-xl bg-white text-center font-black text-lg text-slate-900 shadow-2xs focus:ring-2 focus:ring-[#2f6fa3] outline-none"
            />
            <span className="absolute -right-8 inset-y-0 flex items-center text-[10px] font-extrabold text-slate-400">days/yr</span>
          </div>
          <Button variant="primary" size="sm" onClick={save} className="bg-[#2f6fa3] text-white cursor-pointer shrink-0">
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

const EXPIRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Never expires' },
  { value: '1', label: '31 January' },
  { value: '2', label: 'End of February' },
  { value: '3', label: '31 March' },
  { value: '6', label: '30 June' },
  { value: '12', label: '31 December' },
];

/**
 * Carry-over policy + the manual recalculation.
 *
 * Unused days of a closed year are carried into the next one AUTOMATICALLY — the balance derives
 * them live from the closed year, so nothing has to be run for the numbers to be right.
 * This card only sets the limits and can freeze the result into each employee's entitlement
 * record (People → Edit Profile), which is what the Excel exports read.
 */
export function CarryoverPolicyCard() {
  const { leavePolicy, saveLeavePolicy, getCarryoverStatus, profiles } = useAuth();
  const currentYear = new Date().getFullYear();

  const [maxDays, setMaxDays] = useState(() => leavePolicy?.max_carryover_days === null || leavePolicy?.max_carryover_days === undefined ? '' : String(leavePolicy.max_carryover_days));
  const [expiry, setExpiry] = useState(() => leavePolicy?.carryover_expiry_months === null || leavePolicy?.carryover_expiry_months === undefined ? '' : String(leavePolicy.carryover_expiry_months));
  const [warningMonths, setWarningMonths] = useState(() => String(leavePolicy?.carryover_warning_months ?? 3));
  const [autoBook, setAutoBook] = useState(() => leavePolicy?.carryover_auto_book !== false);
  const [saved, setSaved] = useState(false);

  const capLabel = maxDays.trim() === ''
    ? 'Uncapped — every unused day moves over'
    : Number(maxDays) === 0
      ? 'No carry-over — unused days are forfeited'
      : `At most ${maxDays} day(s) move over`;

  const expiryPreview = carryoverExpiryDate(currentYear, {
    maxCarryoverDays: maxDays.trim() === '' ? null : Number(maxDays),
    expiryMonths: expiry === '' ? null : Number(expiry),
  });

  const save = async () => {
    const cap = maxDays.trim() === '' ? null : Number(maxDays);
    if (cap !== null && (!Number.isFinite(cap) || cap < 0)) { alert('Max carry-over days must be 0 or more, or empty for uncapped.'); return; }
    const ok = await saveLeavePolicy({
      max_carryover_days: cap,
      carryover_expiry_months: expiry === '' ? null : Number(expiry),
      carryover_warning_months: Math.min(12, Math.max(0, Math.round(Number(warningMonths) || 0))),
      carryover_auto_book: autoBook,
    });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      notifySuccess('Carry-over policy saved. Balances update immediately.');
    }
  };

  // Quick preview of who the automatic rule currently credits, so the policy can be sanity-checked.
  const dueSoon = profiles
    .filter(p => p.status === 'active' && p.employment_type !== 'contractor')
    .map(p => ({ p, status: getCarryoverStatus(p.id) }))
    .filter(x => x.status.daysAtRisk > 0 || x.status.expiredDays > 0)
    .sort((a, b) => b.status.daysAtRisk - a.status.daysAtRisk);

  /** Total unused carried-over days, used by the "this date has already passed" warning. */
  const carriedOverTotal = dueSoon.reduce((sum, x) => sum + Math.max(x.status.daysAtRisk, x.status.expiredDays), 0);

  return (
    <Card
      title="Carry-Over of Unused Leave"
      subtitle="What happens to days an employee did not use by the end of the year"
      className="shadow-xs border-slate-200"
      action={<Badge variant="info" className="text-[10px] px-2 py-0.5">Automatic</Badge>}
    >
      <div className="space-y-5 mt-2">
        <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 flex items-start space-x-3">
          <Info className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-extrabold">{currentYear} carry-over is calculated automatically</p>
            <p className="leading-relaxed">
              Orbit takes what each employee had left of the previous year (grant + carry-in − days actually
              taken, company closures included) and adds it to the new year. Nothing needs to be run — the
              balances already include it. Use <strong className="font-extrabold">Carry-Over Recalculation</strong> below
              only to freeze the numbers into the entitlement records so they can be edited per person.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-700 tracking-wide mb-2">Maximum days carried over</label>
            <input
              type="number" min="0" step="0.5"
              value={maxDays}
              onChange={e => setMaxDays(e.target.value)}
              placeholder="Uncapped"
              className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2f6fa3]"
            />
            <p className="text-[11px] text-slate-500 mt-1.5 flex items-center">
              <InfinityIcon className="w-3 h-3 mr-1 text-slate-400 shrink-0" />{capLabel}
            </p>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-700 tracking-wide mb-2">Carried days expire</label>
            <select
              value={expiry}
              onChange={e => setExpiry(e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-sm font-bold text-slate-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2f6fa3]"
            >
              {EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {expiryPreview
                ? `Carried days stay usable until ${expiryPreview}, then drop out of the balance.`
                : 'No due date — carried days never expire, nothing is warned about and nothing is booked automatically.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-700 tracking-wide mb-2">Warn this many months before</label>
            <input
              type="number" min="0" max="12"
              value={warningMonths}
              onChange={e => setWarningMonths(e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2f6fa3]"
            />
            <p className="text-[11px] text-slate-500 mt-1.5">
              Employees see the countdown from this point. 0 = only once it is urgent.
            </p>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-700 tracking-wide mb-2">When the days run out of time</label>
            <button
              type="button"
              onClick={() => setAutoBook(v => !v)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-slate-300 bg-white text-left cursor-pointer hover:border-slate-400 transition-colors"
            >
              <span className="text-[11px] font-semibold text-slate-700 leading-snug">
                {autoBook
                  ? 'Book the leftover days automatically on the last working days before the deadline'
                  : 'Do not book anything — leftover days are simply forfeited'}
              </span>
              <span className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${autoBook ? 'bg-[#2f6fa3]' : 'bg-slate-300'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${autoBook ? 'left-[22px]' : 'left-0.5'}`} />
              </span>
            </button>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Booked days are filed as approved leave marked &ldquo;automatic&rdquo;, so you can hand-edit or delete them.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="primary" size="sm" onClick={save} className="bg-[#2f6fa3] text-white cursor-pointer">
            <Save className="w-3.5 h-3.5 mr-1.5" /> Save Policy
          </Button>
          {saved && (
            <span className="text-[11px] font-bold text-emerald-700 flex items-center gap-1 animate-in fade-in">
              <CheckCircle2 className="w-3.5 h-3.5" /> Policy saved.
            </span>
          )}
        </div>

        {/* Saving a due date that has already gone by zeroes live balances on the spot. Say so. */}
        {expiryPreview !== null && expiryPreview < new Date().toISOString().slice(0, 10) && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-[11px] text-rose-900 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>
              <strong>{expiryPreview} has already passed.</strong> Saving this writes off{' '}
              {carriedOverTotal} unused carried-over day(s) for {dueSoon.length} employee(s) immediately —
              and nothing can be booked automatically, because the deadline is behind us. Pick a date that is
              still ahead, or extend it per employee from People → Edit Profile.
            </span>
          </div>
        )}

        {dueSoon.length > 0 && (
          <div className="pt-4 border-t border-slate-200/80">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block mb-2">
              Carried-over days still unused
            </span>
            <div className="flex flex-wrap gap-2">
              {dueSoon.map(({ p, status }) => (
                <span
                  key={p.id}
                  title={status.expiresOn ? `Must be used by ${status.expiresOn}` : 'No due date set'}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                    status.expiredDays > 0
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : status.level === 'urgent'
                        ? 'bg-rose-50 border-rose-200 text-rose-900'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  {p.first_name} {p.last_name}
                  <span className="font-mono">
                    {status.expiredDays > 0 ? `${status.expiredDays}d expired` : `+${status.daysAtRisk}d`}
                  </span>
                </span>
              ))}
            </div>
            {!expiryPreview && (
              <p className="text-[11px] font-bold text-amber-700 mt-2">
                No due date is set, so none of these days expire yet — choose one above and they will be
                warned about and booked automatically.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
