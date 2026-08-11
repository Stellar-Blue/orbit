"use client";

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

/**
 * Editable rate-card matrix: rows = active job roles, columns = active seniority levels.
 * Cells commit hourly rates on blur; empty clears the entry. Shared between the Settings
 * (global/default card) and each contract's own rate card.
 */
export function RateCardMatrix({ cardId }: { cardId: string }) {
  const { jobRoles, seniorityLevels, rateCardEntries, saveRateCardEntry, deleteRateCardEntry } = useAuth();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const roles = useMemo(() => jobRoles.filter(r => r.active).sort((a, b) => a.sort_order - b.sort_order), [jobRoles]);
  const sens = useMemo(() => seniorityLevels.filter(s => s.active).sort((a, b) => a.rank - b.rank), [seniorityLevels]);

  const entryFor = (roleId: string, senId: string) =>
    rateCardEntries.find(e => e.rate_card_id === cardId && e.job_role_id === roleId && e.seniority_id === senId);

  const commit = async (roleId: string, senId: string) => {
    const dk = `${roleId}|${senId}`;
    const raw = drafts[dk];
    if (raw === undefined) return;
    setDrafts(d => { const n = { ...d }; delete n[dk]; return n; });
    const num = parseFloat(raw);
    const existing = entryFor(roleId, senId);
    if (isNaN(num) || num < 0) {
      if (existing) await deleteRateCardEntry(existing.id);
      return;
    }
    await saveRateCardEntry({ id: existing?.id, rate_card_id: cardId, job_role_id: roleId, seniority_id: senId, hourly_rate: num, daily_rate: null });
  };

  const total = rateCardEntries.filter(e => e.rate_card_id === cardId).reduce((a, e) => a + (Number(e.hourly_rate) || 0), 0);

  if (roles.length === 0 || sens.length === 0) {
    return <div className="p-8 text-center text-xs text-slate-400">Define roles & seniority levels first (Settings → Workforce Policies).</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-100 text-slate-500 uppercase tracking-wider text-[10px] font-extrabold border-b border-slate-200">
            <th className="py-2 px-3 text-left">Role \ Seniority</th>
            {sens.map(s => <th key={s.id} className="py-2 px-2 text-center">{s.name}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {roles.map(role => (
            <tr key={role.id}>
              <td className="py-1.5 px-3 font-semibold text-slate-800">{role.name}</td>
              {sens.map(sen => {
                const entry = entryFor(role.id, sen.id);
                const dk = `${role.id}|${sen.id}`;
                const val = drafts[dk] !== undefined ? drafts[dk] : (entry?.hourly_rate != null ? String(entry.hourly_rate) : '');
                return (
                  <td key={sen.id} className="py-1.5 px-2 text-center">
                    <input
                      type="number" step="0.5" min="0"
                      value={val}
                      placeholder="—"
                      onChange={ev => setDrafts(d => ({ ...d, [dk]: ev.target.value }))}
                      onBlur={() => commit(role.id, sen.id)}
                      title="Hourly rate (€)"
                      className="w-20 text-center border border-transparent rounded-md py-1 font-mono focus:outline-none focus:border-sky-400 focus:bg-white bg-slate-50 text-slate-800"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 text-slate-500 text-[10px] font-bold">
            <td className="py-1.5 px-3">Matrix total (hourly sum)</td>
            <td colSpan={sens.length} className="py-1.5 px-3 text-right font-mono font-bold text-slate-700">€{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
