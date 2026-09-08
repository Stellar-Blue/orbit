"use client";

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Project, WorkItem, TimeEntry } from '@/lib/types';
import { Button, Badge } from '@/components/ui/primitives';
import { Clock, ChevronLeft, ChevronRight, Plus, Trash2, Copy, Check, Send, Layers, Users, ClipboardCheck, X, Save } from 'lucide-react';
import { ProjectForecastEditor } from '@/components/timesheets/project-forecast-editor';
import { ProjectActualVsForecast } from '@/components/timesheets/actual-vs-forecast';

// ---- helpers ----
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mondayOf = (d: Date) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday=0
  x.setDate(x.getDate() - day);
  return x;
};
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const minsToH = (m?: number | null) => (m ? Number(m) / 60 : 0);
const hToMins = (h: number) => Math.round(h * 60);
const fmtH = (m: number) => { const h = m / 60; const hh = Math.floor(h); const mm = Math.round((h - hh) * 60); if (mm === 60) return `${hh + 1}h 0m`; return `${hh}h ${mm}m`; };
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const cellKey = (rowKey: string, day: string) => `${rowKey}|${day}`;

type Tab = 'week' | 'setup' | 'review';
interface Row { key: string; projectId: string; workItemId: string | null; project: Project; workItem?: WorkItem; label: string; billable: boolean; }

export default function TimesheetsPage() {
  const {
    currentUser, profiles, contracts, projects, workItems, timeEntries, leaveRequests, publicHolidays,
    saveTimeEntry, deleteTimeEntry, submitWeek, decideTimeEntries,
    saveProject, deleteProject, saveWorkItem, deleteWorkItem,
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';
  const [tab, setTab] = useState<Tab>('week');
  const [activeProfileId, setActiveProfileId] = useState<string>(currentUser.id);
  const effectiveProfileId = isAdmin ? activeProfileId : currentUser.id;

  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [setupProject, setSetupProject] = useState<{ name: string; contract_id: string; billable: boolean; budget_hours: string }>({ name: '', contract_id: '', billable: true, budget_hours: '' });
  const [setupWorkItem, setSetupWorkItem] = useState<Record<string, string>>({}); // projectId -> name

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekDays = days.map(iso);

  // rows = (project, work item) pairs for active/on_hold projects, plus any week entries not covered
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    const active = projects.filter(p => p.status === 'active' || p.status === 'on_hold');
    active.forEach(p => {
      const wis = workItems.filter(w => w.project_id === p.id);
      if (wis.length === 0) {
        list.push({ key: p.id, projectId: p.id, workItemId: null, project: p, label: p.name, billable: p.default_billable });
      } else {
        wis.forEach(w => list.push({ key: `${p.id}:${w.id}`, projectId: p.id, workItemId: w.id, project: p, workItem: w, label: `${p.name} — ${w.name}`, billable: p.default_billable }));
      }
    });
    // include rows referenced by this week's entries even if the project is not active
    weekDays.forEach(day => {
      timeEntries.forEach(t => {
        if (t.profile_id !== effectiveProfileId || t.work_date !== day) return;
        if (list.some(r => r.projectId === t.project_id && (r.workItemId || null) === (t.work_item_id || null))) return;
        const p = projects.find(x => x.id === t.project_id);
        if (!p) return;
        const w = t.work_item_id ? workItems.find(x => x.id === t.work_item_id) : undefined;
        list.push({ key: `${t.project_id}:${t.work_item_id || ''}`, projectId: t.project_id, workItemId: t.work_item_id || null, project: p, workItem: w, label: w ? `${p.name} — ${w.name}` : p.name, billable: p.default_billable });
      });
    });
    return list;
  }, [projects, workItems, timeEntries, effectiveProfileId, weekDays]);

  const entryFor = (row: Row, day: string): TimeEntry | undefined =>
    timeEntries.find(t => t.profile_id === effectiveProfileId && t.work_date === day && t.project_id === row.projectId && (t.work_item_id || null) === row.workItemId);

  // approved leave + holidays for this profile/week -> not enterable
  const offDays = useMemo(() => {
    const set = new Set<string>();
    leaveRequests.forEach(l => {
      if (l.profile_id !== effectiveProfileId || l.status !== 'approved') return;
      if (l.start_date <= weekDays[6] && l.end_date >= weekDays[0]) {
        let d = new Date(l.start_date + 'T00:00:00');
        const end = new Date(l.end_date + 'T00:00:00');
        while (d <= end) { const s = iso(d); if (s >= weekDays[0] && s <= weekDays[6]) set.add(s); d = addDays(d, 1); }
      }
    });
    publicHolidays.forEach(h => { if (h.date >= weekDays[0] && h.date <= weekDays[6]) set.add(h.date); });
    return set;
  }, [leaveRequests, publicHolidays, effectiveProfileId, weekDays]);

  const weekEntries = timeEntries.filter(t => t.profile_id === effectiveProfileId && t.work_date >= weekDays[0] && t.work_date <= weekDays[6]);
  const weekTotal = weekEntries.reduce((a, t) => a + (t.minutes || 0), 0);
  const dayTotals = weekDays.map(day => weekEntries.filter(t => t.work_date === day).reduce((a, t) => a + (t.minutes || 0), 0));
  const rowTotals = rows.map(r => weekEntries.filter(t => t.project_id === r.projectId && (t.work_item_id || null) === r.workItemId).reduce((a, t) => a + (t.minutes || 0), 0));
  const weekStatus: TimeEntry['status'] | 'mixed' = weekEntries.length === 0 ? 'draft'
    : weekEntries.every(t => t.status === 'approved') ? 'approved'
    : weekEntries.every(t => t.status === 'locked') ? 'locked'
    : weekEntries.every(t => t.status === 'submitted') ? 'submitted'
    : weekEntries.some(t => t.status === 'rejected') ? 'rejected' : 'mixed';

  const commitCell = async (row: Row, day: string) => {
    const key = cellKey(row.key, day);
    const raw = drafts[key];
    const existing = entryFor(row, day);
    if (raw === undefined) return;
    const num = parseFloat(raw);
    setDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
    if (isNaN(num) || num <= 0) {
      if (existing) await deleteTimeEntry(existing.id);
      return;
    }
    await saveTimeEntry({
      profile_id: effectiveProfileId,
      work_date: day,
      minutes: hToMins(num),
      project_id: row.projectId,
      work_item_id: row.workItemId,
      note: existing?.note || null,
      billable: row.billable,
      status: existing?.status || 'draft',
      currency: 'EUR'
    });
  };

  const copyLastWeek = async () => {
    const prevStart = addDays(weekStart, -7);
    const prevDays = Array.from({ length: 7 }, (_, i) => iso(addDays(prevStart, i)));
    let count = 0;
    for (const r of rows) {
      for (let i = 0; i < 7; i++) {
        const day = weekDays[i];
        const prevEntry = timeEntries.find(t => t.profile_id === effectiveProfileId && t.work_date === prevDays[i] && t.project_id === r.projectId && (t.work_item_id || null) === r.workItemId);
        if (!prevEntry || prevEntry.minutes <= 0) continue;
        if (entryFor(r, day)) continue;
        const ok = await saveTimeEntry({
          profile_id: effectiveProfileId, work_date: day, minutes: prevEntry.minutes,
          project_id: r.projectId, work_item_id: r.workItemId, note: prevEntry.note || null,
          billable: r.billable, status: 'draft', currency: 'EUR'
        });
        if (ok) count++;
      }
    }
    alert(count > 0 ? `Copied ${count} entry(ies) from last week.` : 'Nothing to copy from last week.');
  };

  // ---- admin: review submitted weeks ----
  const submittedEntries = useMemo(() => timeEntries.filter(t => t.status === 'submitted'), [timeEntries]);
  const submittedByPerson = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    submittedEntries.forEach(t => { const arr = map.get(t.profile_id) || []; arr.push(t); map.set(t.profile_id, arr); });
    return Array.from(map.entries()).map(([pid, entries]) => {
      const weeks = new Map<string, TimeEntry[]>();
      entries.forEach(t => {
        const m = mondayOf(new Date(t.work_date + 'T00:00:00'));
        const k = iso(m);
        const arr = weeks.get(k) || [];
        arr.push(t);
        weeks.set(k, arr);
      });
      return { profileId: pid, weeks: Array.from(weeks.entries()).sort((a, b) => b[0].localeCompare(a[0])) };
    });
  }, [submittedEntries]);

  const inputCls = "w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none focus:border-blue-500";

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
            <Clock className="w-6 h-6 mr-3 text-[#3D87D3]" /> Timesheets
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Log effort per project / feature for the week. Decimal hours allowed (1.5 = 1h30m). Leave & holidays are pre-marked and not enterable.
          </p>
        </div>
        {isAdmin && (
          <div className="inline-flex rounded-lg bg-slate-100 border border-slate-200 p-0.5">
            <button onClick={() => setTab('week')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${tab === 'week' ? 'bg-[#3D87D3] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}><Clock className="w-3.5 h-3.5" /> Week</button>
            <button onClick={() => setTab('review')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${tab === 'review' ? 'bg-[#3D87D3] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}><ClipboardCheck className="w-3.5 h-3.5" /> Review{submittedEntries.length > 0 ? ` (${submittedEntries.length})` : ''}</button>
            <button onClick={() => setTab('setup')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${tab === 'setup' ? 'bg-[#3D87D3] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}><Layers className="w-3.5 h-3.5" /> Projects</button>
          </div>
        )}
      </div>

      {tab === 'week' && (
        <>
          {/* toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekStart(d => addDays(d, -7))} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-sm font-bold text-slate-800 min-w-[150px] text-center">
                {new Date(weekDays[0] + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – {new Date(weekDays[6] + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <button onClick={() => setWeekStart(d => addDays(d, 7))} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
              <button onClick={() => setWeekStart(mondayOf(new Date()))} className="text-[11px] font-bold text-[#3D87D3] hover:underline cursor-pointer">This week</button>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <select value={effectiveProfileId} onChange={e => setActiveProfileId(e.target.value)} className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3D87D3]">
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                </select>
              )}
              <Button variant="outline" size="sm" onClick={copyLastWeek} className="cursor-pointer"><Copy className="w-3.5 h-3.5 mr-1.5" /> Copy last week</Button>
              <Button
                variant={weekStatus === 'approved' || weekStatus === 'locked' ? 'outline' : weekStatus === 'submitted' ? 'secondary' : 'primary'}
                size="sm"
                disabled={weekEntries.length === 0 || weekStatus === 'approved' || weekStatus === 'locked' || weekStatus === 'submitted'}
                onClick={async () => { if (await submitWeek(effectiveProfileId, weekDays[0], weekDays[6])) alert('Week submitted for review.'); }}
                className="cursor-pointer"
              >
                <Send className="w-3.5 h-3.5 mr-1.5" /> {weekStatus === 'submitted' ? 'Submitted' : weekStatus === 'approved' ? 'Approved' : 'Submit week'}
              </Button>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-white">
              <Layers className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              No projects set up yet. Ask an admin to create projects (Timesheets → Projects).
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-slate-200 shadow-2xs overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[10px] font-extrabold uppercase tracking-wider border-b border-slate-200">
                    <th className="py-2 px-3 text-left min-w-[240px]">Project / Feature</th>
                    {days.map((d, i) => (
                      <th key={i} className={`py-2 px-1.5 text-center min-w-[74px] ${offDays.has(weekDays[i]) ? 'bg-slate-100 text-slate-400' : ''}`}>
                        <div>{WEEKDAY_LABELS[i]}</div>
                        <div className="text-[9px] font-normal">{new Date(weekDays[i] + 'T00:00:00').getDate()}</div>
                      </th>
                    ))}
                    <th className="py-2 px-2 text-center min-w-[70px]">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, ri) => (
                    <tr key={r.key} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-1.5 px-3 align-middle">
                        <div className="font-semibold text-slate-800 text-xs leading-tight">{r.label}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Badge variant={r.billable ? 'success' : 'neutral'} className="text-[9px]">{r.billable ? 'Billable' : 'Internal'}</Badge>
                          {r.workItem && <Badge variant="info" className="text-[9px]">{r.workItem.kind}</Badge>}
                        </div>
                      </td>
                      {days.map((_, i) => {
                        const day = weekDays[i];
                        const off = offDays.has(day);
                        const e = entryFor(r, day);
                        const key = cellKey(r.key, day);
                        const value = drafts[key] !== undefined ? drafts[key] : (e && e.minutes > 0 ? String(minsToH(e.minutes)) : '');
                        return (
                          <td key={i} className={`py-1.5 px-1.5 align-middle ${off ? 'bg-slate-100' : ''}`}>
                            {off ? (
                              <div className="text-center text-[10px] text-slate-400 font-semibold py-1">OFF</div>
                            ) : (
                              <input
                                type="number" step="0.25" min="0" max="24"
                                value={value}
                                disabled={e?.status === 'approved' || e?.status === 'locked'}
                                placeholder="—"
                                onChange={ev => setDrafts(p => ({ ...p, [key]: ev.target.value }))}
                                onBlur={() => commitCell(r, day)}
                                onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
                                title={e ? `status: ${e.status}` : 'Enter decimal hours (1.5 = 1h30m)'}
                                className={`w-full text-center border border-transparent rounded-md py-1.5 text-xs font-mono focus:outline-none focus:border-blue-400 focus:bg-white bg-transparent ${e?.status === 'approved' ? 'text-emerald-700 font-bold' : e?.status === 'submitted' ? 'text-amber-600 font-bold' : e?.status === 'rejected' ? 'text-rose-600 font-bold' : 'text-slate-800'} ${value ? 'font-bold' : ''}`}
                              />
                            )}
                          </td>
                        );
                      })}
                      <td className="py-1.5 px-2 text-center font-mono font-black text-[#3D87D3] whitespace-nowrap">{rowTotals[ri] > 0 ? fmtH(rowTotals[ri]) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold text-slate-700">
                    <td className="py-2 px-3 text-xs font-extrabold uppercase tracking-wider text-slate-500">Day total</td>
                    {dayTotals.map((t, i) => (
                      <td key={i} className={`py-2 px-1.5 text-center font-mono font-bold text-slate-700 ${offDays.has(weekDays[i]) ? 'text-slate-300' : ''}`}>{t > 0 ? fmtH(t) : '—'}</td>
                    ))}
                    <td className="py-2 px-2 text-center font-mono font-black text-[#3D87D3]">{fmtH(weekTotal)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <span>Greyed-out days = approved leave or public holiday. Approved/locked entries are locked.</span>
                <span className="font-mono">status: <span className="font-bold text-slate-600 uppercase">{weekStatus}</span></span>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'review' && isAdmin && (
        <div className="space-y-4">
          {submittedByPerson.length === 0 && (
            <div className="p-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-white">No submitted weeks awaiting review.</div>
          )}
          {submittedByPerson.map(({ profileId, weeks }) => {
            const person = profiles.find(p => p.id === profileId);
            return weeks.map(([wk, entries]) => {
              const total = entries.reduce((a, t) => a + t.minutes, 0);
              const ids = entries.map(t => t.id);
              return (
                <div key={`${profileId}-${wk}`} className="rounded-2xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#3D87D3]" /> {person?.first_name} {person?.last_name}
                      <Badge variant="warning">Week of {wk}</Badge>
                      <span className="font-mono text-xs text-slate-500">{fmtH(total)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="danger" size="sm" onClick={async () => { if (await decideTimeEntries(ids, 'rejected')) alert('Entries rejected — the employee can edit and resubmit.'); }} className="cursor-pointer"><X className="w-3.5 h-3.5 mr-1" /> Reject</Button>
                      <Button variant="primary" size="sm" onClick={async () => { if (await decideTimeEntries(ids, 'approved')) alert('Entries approved.'); }} className="cursor-pointer"><Check className="w-3.5 h-3.5 mr-1" /> Approve</Button>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100 text-xs">
                    {entries.map(t => {
                      const p = projects.find(x => x.id === t.project_id);
                      const w = t.work_item_id ? workItems.find(x => x.id === t.work_item_id) : null;
                      return (
                        <div key={t.id} className="px-4 py-2 flex items-center justify-between gap-3">
                          <span className="font-mono text-slate-400">{t.work_date}</span>
                          <span className="flex-1 font-semibold text-slate-700">{w ? `${p?.name || 'Project'} — ${w.name}` : (p?.name || 'Project')}</span>
                          <span className="font-mono font-bold">{fmtH(t.minutes)}</span>
                          {t.note && <span className="text-slate-400 italic max-w-[260px] truncate">{t.note}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })}
        </div>
      )}

      {tab === 'setup' && isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Create project */}
          <div className="rounded-2xl bg-white border border-slate-200 shadow-2xs p-5 space-y-3 h-fit">
            <span className="text-sm font-extrabold text-slate-800 flex items-center"><Plus className="w-4 h-4 mr-2 text-[#3D87D3]" /> New Project</span>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Name</label>
              <input value={setupProject.name} onChange={e => setSetupProject(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Atlas ETRM — Bidding Engine" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Contract (optional — blank = internal)</label>
              <select value={setupProject.contract_id} onChange={e => setSetupProject(p => ({ ...p, contract_id: e.target.value }))} className={inputCls}>
                <option value="">Internal (no contract)</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{c.counterparty?.legal_name || 'CP'} · {c.reference}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={setupProject.billable} onChange={e => setSetupProject(p => ({ ...p, billable: e.target.checked }))} className="accent-[#3D87D3]" /> Billable
              </label>
              <label className="block text-xs font-bold text-slate-700 flex-1">Budget h
                <input value={setupProject.budget_hours} onChange={e => setSetupProject(p => ({ ...p, budget_hours: e.target.value }))} className={`${inputCls} mt-1`} placeholder="optional" />
              </label>
            </div>
            <Button variant="primary" size="sm" className="w-full cursor-pointer" onClick={async () => {
              if (!setupProject.name.trim()) { alert('Project name required.'); return; }
              await saveProject({ name: setupProject.name.trim(), contract_id: setupProject.contract_id || null, status: 'active', default_billable: setupProject.billable, budget_hours: setupProject.budget_hours ? Number(setupProject.budget_hours) : null });
              setSetupProject({ name: '', contract_id: '', billable: true, budget_hours: '' });
            }}><Plus className="w-3.5 h-3.5 mr-1" /> Create Project</Button>
          </div>

          {/* Project list + work items */}
          <div className="lg:col-span-2 space-y-4">
            {projects.filter(p => p.status !== 'archived').map(p => (
              <div key={p.id} className="rounded-2xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-extrabold text-slate-800">{p.name}</span>
                    <span className="ml-2 text-[10px] font-bold uppercase text-slate-400">{p.status} · {p.default_billable ? 'Billable' : 'Internal'}</span>
                  </div>
                  <button onClick={async () => { if (confirm(`Delete project "${p.name}" and its work items?`)) await deleteProject(p.id); }} className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="p-3 space-y-2">
                  {workItems.filter(w => w.project_id === p.id).map(w => (
                    <div key={w.id} className="flex items-center justify-between gap-3 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-800">{w.name}</span>
                        <Badge variant="info" className="ml-2 text-[9px]">{w.kind}</Badge>
                      </div>
                      <button onClick={async () => { if (confirm(`Delete work item "${w.name}"?`)) await deleteWorkItem(w.id); }} className="text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  {workItems.filter(w => w.project_id === p.id).length === 0 && (
                    <div className="text-[11px] text-slate-400 px-1">No work items — time logs straight to the project.</div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      value={setupWorkItem[p.id] || ''}
                      onChange={e => setSetupWorkItem(s => ({ ...s, [p.id]: e.target.value }))}
                      placeholder="Add feature / work item…"
                      className={`${inputCls} flex-1`}
                    />
                    <Button variant="outline" size="sm" onClick={async () => {
                      const name = (setupWorkItem[p.id] || '').trim();
                      if (!name) { alert('Work item name required.'); return; }
                      await saveWorkItem({ project_id: p.id, name, kind: 'feature', status: 'open' });
                      setSetupWorkItem(s => ({ ...s, [p.id]: '' }));
                    }} className="cursor-pointer"><Save className="w-3.5 h-3.5 mr-1" /> Add</Button>
                  </div>
                  <ProjectForecastEditor projectId={p.id} />
                  <ProjectActualVsForecast projectId={p.id} />
                </div>
              </div>
            ))}
            {projects.filter(p => p.status !== 'archived').length === 0 && (
              <div className="p-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-white">No projects yet — create your first one.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
