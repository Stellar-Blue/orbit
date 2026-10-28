"use client";

import React, { useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/primitives';
import { Scale, CalendarCheck2 } from 'lucide-react';
import { TimeEntry } from '@/lib/types';

/**
 * Compares a project's PREDICTED man-hours against its ACTUAL registered (approved) ones.
 *
 * Predicted  -> project_role_forecasts.forecast_hours (planned per role × seniority,
 *               entered via ProjectForecastEditor).
 * Actual     -> time_entries with status 'approved' | 'locked' on the project, bucketed
 *               to a role × seniority via the entry's approval snapshot, else the profile's
 *               project assignment valid on that work date (falling back to the role history).
 *
 * Admin-only view (forecasts + assignments are admin-gated by RLS).
 */
export function ProjectActualVsForecast({ projectId }: { projectId: string }) {
  const { timeEntries, projectRoleForecasts, projectAssignments, profileRoleHistory, jobRoles, seniorityLevels } = useAuth();

  const { totalForecast, totalActual, rows, unassigned } = useMemo(() => {
    const key = (rid: string, sid: string) => `${rid}|${sid}`;
    const dimLabel = (rid?: string | null, sid?: string | null) => {
      if (!rid && !sid) return 'Unassigned';
      const r = jobRoles.find(x => x.id === rid);
      const s = seniorityLevels.find(x => x.id === sid);
      return `${r?.name || 'Role'} · ${s?.name || '—'}`;
    };

    // Which role × seniority an approved entry counts against on this project.
    const roleKeyFor = (t: TimeEntry): string | null => {
      if (t.job_role_id && t.seniority_id) return key(t.job_role_id, t.seniority_id);
      const asg = projectAssignments.find(a =>
        a.project_id === projectId && a.profile_id === t.profile_id &&
        (!a.valid_from || a.valid_from <= t.work_date) && (!a.valid_to || a.valid_to >= t.work_date));
      if (asg) return key(asg.job_role_id, asg.seniority_id);
      const anyAsg = projectAssignments.find(a => a.project_id === projectId && a.profile_id === t.profile_id);
      if (anyAsg) return key(anyAsg.job_role_id, anyAsg.seniority_id);
      const rh = profileRoleHistory
        .filter(h => h.profile_id === t.profile_id && h.valid_from <= t.work_date && (!h.valid_to || h.valid_to >= t.work_date))
        .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
      if (rh) return key(rh.job_role_id, rh.seniority_id);
      return null; // counted under "Unassigned / other"
    };

    const forecasts = projectRoleForecasts.filter(f => f.project_id === projectId);
    const actuals = timeEntries.filter(t => t.project_id === projectId && (t.status === 'approved' || t.status === 'locked'));

    const totalForecast = forecasts.reduce((a, f) => a + (Number(f.forecast_hours) || 0), 0);
    const totalActual = actuals.reduce((a, t) => a + (Number(t.minutes) || 0), 0);

    const forecastMap = new Map<string, number>();
    forecasts.forEach(f => forecastMap.set(key(f.job_role_id, f.seniority_id), (Number(f.forecast_hours) || 0)));

    const actualMap = new Map<string, number>(); // key -> minutes
    let unassignedMins = 0;
    actuals.forEach(t => {
      const k = roleKeyFor(t);
      if (!k) { unassignedMins += Number(t.minutes) || 0; return; }
      actualMap.set(k, (actualMap.get(k) || 0) + (Number(t.minutes) || 0));
    });

    const dimKeys = new Set<string>([...forecastMap.keys(), ...actualMap.keys()]);
    const rows = Array.from(dimKeys)
      .map(k => {
        const [rid, sid] = k.split('|');
        const forecast = forecastMap.get(k) || 0;
        const actual = (actualMap.get(k) || 0) / 60;
        return { k, label: dimLabel(rid, sid), forecast, actual };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    return { totalForecast, totalActual: totalActual / 60, rows, unassigned: unassignedMins / 60 };
  }, [projectId, timeEntries, projectRoleForecasts, projectAssignments, profileRoleHistory, jobRoles, seniorityLevels]);

  if (totalForecast <= 0 && totalActual <= 0) return null;

  const delta = totalActual - totalForecast;
  const pct = totalForecast > 0 ? (totalActual / totalForecast) * 100 : null;
  const hours = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
  const deltaCls = delta > 0 ? 'text-rose-600' : delta < 0 ? 'text-emerald-600' : 'text-slate-500';

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center">
          <Scale className="w-3 h-3 mr-1 text-[#2f6fa3]" /> Actual vs Predicted man-hours
        </span>
        <Badge variant="info" className="text-[9px]">
          <CalendarCheck2 className="w-2.5 h-2.5 mr-1" /> Approved hours to date
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div className="rounded-lg bg-white border border-slate-200 py-2">
          <div className="text-[9px] font-extrabold uppercase text-slate-400">Predicted</div>
          <div className="text-sm font-black text-slate-800">{hours(totalForecast)}</div>
        </div>
        <div className="rounded-lg bg-white border border-slate-200 py-2">
          <div className="text-[9px] font-extrabold uppercase text-slate-400">Actual approved</div>
          <div className="text-sm font-black text-[#2f6fa3]">{hours(totalActual)}</div>
        </div>
        <div className="rounded-lg bg-white border border-slate-200 py-2">
          <div className="text-[9px] font-extrabold uppercase text-slate-400">Variance</div>
          <div className={`text-sm font-black ${deltaCls}`}>{delta >= 0 ? '+' : ''}{hours(delta)}</div>
        </div>
        <div className="rounded-lg bg-white border border-slate-200 py-2">
          <div className="text-[9px] font-extrabold uppercase text-slate-400">Forecast used</div>
          <div className={`text-sm font-black ${pct !== null && pct > 100 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {pct !== null ? `${Math.round(pct)}%` : '—'}
          </div>
        </div>
      </div>

      {(rows.length > 0 || unassigned > 0) && (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-slate-400 uppercase text-[9px] font-extrabold">
              <th className="py-1 px-2 text-left font-extrabold">Role · Seniority</th>
              <th className="py-1 px-1.5 text-right font-extrabold">Predicted</th>
              <th className="py-1 px-1.5 text-right font-extrabold">Actual</th>
              <th className="py-1 px-1.5 text-right font-extrabold">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => {
              const d = r.actual - r.forecast;
              return (
                <tr key={r.k}>
                  <td className="py-1 px-2 font-semibold text-slate-700">{r.label}</td>
                  <td className="py-1 px-1.5 text-right font-mono text-slate-600">{hours(r.forecast)}</td>
                  <td className="py-1 px-1.5 text-right font-mono font-bold text-slate-800">{hours(r.actual)}</td>
                  <td className={`py-1 px-1.5 text-right font-mono font-bold ${d > 0 ? 'text-rose-600' : d < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {d >= 0 ? '+' : ''}{hours(d)}
                  </td>
                </tr>
              );
            })}
            {unassigned > 0 && (
              <tr>
                <td className="py-1 px-2 font-semibold text-slate-500 italic">Unassigned / other</td>
                <td className="py-1 px-1.5 text-right font-mono text-slate-400">—</td>
                <td className="py-1 px-1.5 text-right font-mono font-bold text-slate-700">{hours(unassigned)}</td>
                <td className="py-1 px-1.5 text-right font-mono font-bold text-rose-600">+{hours(unassigned)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-white/60">
              <td className="py-1.5 px-2 font-extrabold text-slate-800">Total</td>
              <td className="py-1.5 px-1.5 text-right font-mono font-black text-slate-800">{hours(totalForecast)}</td>
              <td className="py-1.5 px-1.5 text-right font-mono font-black text-[#2f6fa3]">{hours(totalActual)}</td>
              <td className={`py-1.5 px-1.5 text-right font-mono font-black ${deltaCls}`}>{delta >= 0 ? '+' : ''}{hours(delta)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <p className="text-[9px] text-slate-400 leading-snug">
        Predicted = planned man-hours from the forecast grid. Actual = logged hours with status Approved / Locked.
        Variance over 0 means more hours were approved than predicted for the engagement so far.
      </p>
    </div>
  );
}
