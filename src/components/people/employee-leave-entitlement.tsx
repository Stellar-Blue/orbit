"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/primitives';
import { CalendarDays, Save, Trash2, Plus } from 'lucide-react';

/**
 * Edits an employee's ANNUAL LEAVE ENTITLEMENT per calendar year.
 * Each year = an entry in leave_entitlements (entitlement_days + carried_over_days).
 * If a year has no entry, the COMPANY DEFAULT (leave_policy.default_annual_days) applies
 * — use this widget to override it per year (tenure adds, mid-year joiners prorate down).
 */
export function EmployeeLeaveEntitlement({ profileId }: { profileId: string }) {
  const { entitlements, leaveDefaultDays, saveLeaveEntitlement, deleteLeaveEntitlement, getDerivedCarryover } = useAuth();
  const currentYear = new Date().getFullYear();

  const rowFor = (year: number) => entitlements.find(e => e.profile_id === profileId && e.year === year);

  const [years, setYears] = useState<number[]>(() => {
    const set = new Set<number>();
    entitlements.forEach(e => { if (e.profile_id === profileId) set.add(e.year); });
    set.add(currentYear);
    set.add(currentYear + 1);
    return Array.from(set).sort((a, b) => a - b);
  });
  const [customYear, setCustomYear] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const [daysDraft, setDaysDraft] = useState<Record<number, string>>({});
  const [carryDraft, setCarryDraft] = useState<Record<number, string>>({});

  const val = (drafts: Record<number, string>, year: number, rowVal?: number, fallback?: number) =>
    drafts[year] !== undefined ? drafts[year] : (rowVal !== undefined && rowVal !== null ? String(rowVal) : (fallback !== undefined ? String(fallback) : ''));

  const addYear = () => {
    const y = parseInt(customYear, 10);
    if (!y || y < 2000 || y > 2100) { alert('Enter a valid year (2000–2100).'); return; }
    setYears(prev => Array.from(new Set([...prev, y])).sort((a, b) => a - b));
    setCustomYear('');
  };

  const save = async (year: number) => {
    const existing = rowFor(year);
    const days = parseFloat(daysDraft[year] ?? '') || (existing?.entitlement_days ?? 0);
    const carry = parseFloat(carryDraft[year] ?? '') || (existing?.carried_over_days ?? 0);
    if (days < 0 || carry < 0) { alert('Values cannot be negative.'); return; }
    const ok = await saveLeaveEntitlement({
      id: existing?.id,
      profile_id: profileId,
      year,
      entitlement_days: days,
      carried_over_days: carry,
    });
    if (ok) {
      setDaysDraft(d => { const n = { ...d }; delete n[year]; return n; });
      setCarryDraft(d => { const n = { ...d }; delete n[year]; return n; });
      setFlash(`Saved ${year} entitlement.`);
      setTimeout(() => setFlash(null), 3000);
    }
  };

  const remove = async (year: number) => {
    const existing = rowFor(year);
    if (!existing) return;
    if (!confirm(`Delete the ${year} entitlement for this employee? It will fall back to the company default (${leaveDefaultDays} days).`)) return;
    const ok = await deleteLeaveEntitlement(existing.id);
    if (ok) setFlash(`${year} entitlement cleared — falls back to default.`);
    setTimeout(() => setFlash(null), 3000);
  };

  const inputCls = "w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-mono text-slate-800";

  return (
    // Enter must not submit the surrounding People profile form.
    <div className="space-y-2" onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-slate-400 leading-snug">
          Days granted per calendar year. Use fewer for mid-year joiners (pro-rata), more for tenure. Empty values fall back to the company default.
        </p>
        <Badge variant="info" className="shrink-0 text-[9px]">Default: {leaveDefaultDays} days/yr</Badge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-slate-400 uppercase text-[9px] font-extrabold">
              <th className="py-1 pr-2 text-left font-extrabold">Year</th>
              <th className="py-1 px-2 text-left font-extrabold">Entitlement days</th>
              <th className="py-1 px-2 text-left font-extrabold">Carried over</th>
              <th className="py-1 pl-2 text-right font-extrabold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {years.map(year => {
              const existing = rowFor(year);
              return (
                <tr key={year}>
                  <td className="py-1.5 pr-2">
                    <span className="font-bold text-slate-800 font-mono">{year}</span>
                    {existing ? (
                      existing.carryover_is_manual === true ? (
                        <Badge variant="success" className="ml-1.5 text-[8px] px-1.5">MANUAL</Badge>
                      ) : (
                        <Badge variant="info" className="ml-1.5 text-[8px] px-1.5">AUTO</Badge>
                      )
                    ) : (
                      <span className="ml-1.5 text-[9px] font-semibold text-slate-400 uppercase">default</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="number" step="0.5" min="0"
                      value={val(daysDraft, year, existing?.entitlement_days)}
                      placeholder={existing ? String(existing.entitlement_days) : String(leaveDefaultDays)}
                      onChange={e => setDaysDraft(d => ({ ...d, [year]: e.target.value }))}
                      className={inputCls}
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="number" step="0.5" min="0"
                      value={val(carryDraft, year, existing?.carried_over_days, 0)}
                      placeholder={existing ? String(existing.carried_over_days) : '0'}
                      onChange={e => setCarryDraft(d => ({ ...d, [year]: e.target.value }))}
                      className={inputCls}
                    />
                    {/* The balance uses the automatic value while a row is not flagged manual, so
                        show it here — otherwise a stale 0 would contradict the employee's balance. */}
                    {existing?.carryover_is_manual !== true && (() => {
                      const derived = getDerivedCarryover(profileId, year);
                      return derived > 0 ? (
                        <span className="text-[9px] font-bold text-sky-700 mt-0.5 block">auto: +{derived}d</span>
                      ) : null;
                    })()}
                  </td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                    <button type="button" onClick={() => save(year)} className="inline-flex items-center text-emerald-600 hover:text-emerald-700 px-1.5 py-0.5 cursor-pointer font-bold text-[10px]" title={`Save ${year}`}><Save className="w-3.5 h-3.5 mr-0.5" /> Save</button>
                    {existing && (
                      <button type="button" onClick={() => remove(year)} className="inline-flex items-center text-slate-400 hover:text-rose-600 px-1 py-0.5 cursor-pointer" title={`Delete ${year}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="number" min="2000" max="2100"
          value={customYear}
          onChange={e => setCustomYear(e.target.value)}
          placeholder={`${currentYear - 1}, ${currentYear}…`}
          className={`${inputCls} w-28`}
        />
        <button type="button" onClick={addYear} className="inline-flex items-center text-[10px] font-bold text-[#2f6fa3] hover:underline px-1.5 py-1 cursor-pointer"><Plus className="w-3 h-3 mr-0.5" /> Add year</button>
        {flash && <span className="text-[10px] font-bold text-emerald-700 animate-in fade-in">{flash}</span>}
      </div>

      <p className="text-[10px] text-slate-400 leading-snug flex items-start">
        <CalendarDays className="w-3 h-3 mr-1 mt-0.5 shrink-0" />
        Tip: for a mid-year hire, grant pro-rated days for the joining year (e.g. 22 × remaining months / 12). For extra-tenure staff, raise their yearly days above the default.
      </p>
    </div>
  );
}
