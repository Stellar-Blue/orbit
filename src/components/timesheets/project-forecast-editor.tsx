"use client";

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/primitives';
import { Clock } from 'lucide-react';

/**
 * Optional "predicted man-hours" forecast per (role × seniority) for a project.
 * Admin-only data (planning/costing). Cells commit on blur; empty clears.
 */
export function ProjectForecastEditor({ projectId }: { projectId: string }) {
  const { jobRoles, seniorityLevels, projectRoleForecasts, saveProjectRoleForecast, deleteProjectRoleForecast } = useAuth();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const roles = useMemo(() => jobRoles.filter(r => r.active).sort((a, b) => a.sort_order - b.sort_order), [jobRoles]);
  const sens = useMemo(() => seniorityLevels.filter(s => s.active).sort((a, b) => a.rank - b.rank), [seniorityLevels]);

  const entryFor = (roleId: string, senId: string) =>
    projectRoleForecasts.find(f => f.project_id === projectId && f.job_role_id === roleId && f.seniority_id === senId);

  const commit = async (roleId: string, senId: string) => {
    const dk = `${roleId}|${senId}`;
    const raw = drafts[dk];
    if (raw === undefined) return;
    setDrafts(d => { const n = { ...d }; delete n[dk]; return n; });
    const num = parseFloat(raw);
    const existing = entryFor(roleId, senId);
    if (isNaN(num) || num <= 0) {
      if (existing) await deleteProjectRoleForecast(existing.id);
      return;
    }
    await saveProjectRoleForecast({ id: existing?.id, project_id: projectId, job_role_id: roleId, seniority_id: senId, forecast_hours: num });
  };

  const total = projectRoleForecasts.filter(f => f.project_id === projectId).reduce((a, f) => a + (Number(f.forecast_hours) || 0), 0);

  if (roles.length === 0 || sens.length === 0) return null;

  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center">
          <Clock className="w-3 h-3 mr-1" /> Predicted man-hours by role & seniority
        </span>
        <Badge variant="info" className="text-[9px]">{Math.round(total)}h total</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-slate-400 uppercase text-[9px] font-extrabold">
              <th className="py-1 px-2 text-left font-extrabold">Role \ Seniority</th>
              {sens.map(s => <th key={s.id} className="py-1 px-1.5 text-center font-extrabold">{s.name}</th>)}
              <th className="py-1 px-1.5 text-center font-extrabold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roles.map(role => {
              let rowTotal = 0;
              return (
                <tr key={role.id}>
                  <td className="py-1 px-2 font-semibold text-slate-700">{role.name}</td>
                  {sens.map(sen => {
                    const e = entryFor(role.id, sen.id);
                    rowTotal += Number(e?.forecast_hours) || 0;
                    const dk = `${role.id}|${sen.id}`;
                    const val = drafts[dk] !== undefined ? drafts[dk] : (e?.forecast_hours ? String(e.forecast_hours) : '');
                    return (
                      <td key={sen.id} className="py-1 px-1.5 text-center">
                        <input
                          type="number" step="0.5" min="0"
                          value={val}
                          placeholder="—"
                          onChange={ev => setDrafts(d => ({ ...d, [dk]: ev.target.value }))}
                          onBlur={() => commit(role.id, sen.id)}
                          title="Predicted hours for this role & seniority"
                          className="w-16 text-center border border-transparent rounded bg-slate-50 py-1 font-mono focus:outline-none focus:border-sky-400 focus:bg-white text-slate-800"
                        />
                      </td>
                    );
                  })}
                  <td className="py-1 px-1.5 text-center font-mono font-bold text-[#3D87D3]">{rowTotal > 0 ? rowTotal : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
