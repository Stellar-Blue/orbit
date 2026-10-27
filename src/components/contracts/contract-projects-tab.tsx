"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Contract, Project, PROJECT_STATUS_META } from '@/lib/types';
import { Button } from '@/components/ui/primitives';
import { ProjectBillingBar } from '@/components/projects/project-billing-bar';
import { Plus, Trash2, Pencil, Check, X, ChevronDown, ChevronUp, Calendar } from 'lucide-react';
import { ProjectForecastEditor } from '@/components/timesheets/project-forecast-editor';
import { ProjectDetailsPanel, projectBillingStatus } from '@/components/projects/project-details-panel';
import { formatDate } from '@/lib/date';
import { DatePicker } from '@/components/ui/date-picker';

/** Projects linked to one contract: see / create / edit / delete + role-seniority forecast. */
export function ContractProjectsTab({ contract }: { contract: Contract }) {
  const { projects, saveProject, deleteProject, timeEntries, invoices } = useAuth();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [newStatus, setNewStatus] = useState<Project['status']>('planned');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [billable, setBillable] = useState(true);
  const [budgetHours, setBudgetHours] = useState('');
  const [budgetDays, setBudgetDays] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState<Project['status']>('planned');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const linked = projects.filter(p => p.contract_id === contract.id && p.status !== 'archived');

  const createErrors: string[] = [];
  if (plannedStart && plannedEnd && plannedEnd < plannedStart) createErrors.push('Planned end is before the planned start.');
  if (Number(budgetHours) < 0 || Number(budgetDays) < 0) createErrors.push('Budgets cannot be negative.');

  const create = async () => {
    if (!name.trim()) { alert('Project name required.'); return; }
    if (createErrors.length > 0) { alert(createErrors.join(' ')); return; }
    const hours = budgetHours ? Number(budgetHours) : budgetDays ? Number(budgetDays) * 8 : null;
    const ok = await saveProject({
      name: name.trim(),
      contract_id: contract.id,
      code: code.trim() || null,
      status: newStatus,
      default_billable: billable,
      budget_hours: hours,
      budget_days: hours != null ? Number((hours / 8).toFixed(2)) : null,
      starts_on: plannedStart || null,
      ends_on: plannedEnd || null,
    });
    if (!ok) { alert('Could not create the project.'); return; }
    setName(''); setCode(''); setBudgetHours(''); setBudgetDays(''); setPlannedStart(''); setPlannedEnd(''); setNewStatus('planned');
  };

  const startEdit = (p: Project) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditStatus(p.status);
  };

  const saveEdit = async () => {
    const p = projects.find(x => x.id === editingId);
    if (!p) { setEditingId(null); return; }
    await saveProject({ ...p, name: editName.trim() || p.name, status: editStatus });
    setEditingId(null);
  };

  return (
    <div className="space-y-6 pt-3 animate-fadeIn">
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5 space-y-3">
        <span className="text-sm font-extrabold text-slate-800 flex items-center"><Plus className="w-4 h-4 mr-2 text-[#3D87D3]" /> New Project on this Contract</span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Project name…" className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="Code (optional)" className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
          <select value={newStatus} onChange={e => setNewStatus(e.target.value as Project['status'])} className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold">
            <option value="planned">Planned</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="on_hold">On Hold</option>
            <option value="active">Active (legacy)</option>
          </select>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Planned start</label>
            <DatePicker value={plannedStart} onChange={next => setPlannedStart(next)} className="w-full px-3" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Planned end</label>
            <DatePicker value={plannedEnd} onChange={next => setPlannedEnd(next)} className="w-full px-3" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Budget hours</label>
              <input value={budgetHours} onChange={e => { setBudgetHours(e.target.value); setBudgetDays(e.target.value ? String(Number((Number(e.target.value) / 8).toFixed(2))) : ''); }} placeholder="e.g. 120" className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Budget days</label>
              <input value={budgetDays} onChange={e => { setBudgetDays(e.target.value); setBudgetHours(e.target.value ? String(Number(e.target.value) * 8) : ''); }} placeholder="e.g. 15" className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer sm:col-span-3">
            <input type="checkbox" checked={billable} onChange={e => setBillable(e.target.checked)} className="accent-[#3D87D3]" /> Billable to client (hours and day budgets stay in sync at 8h/day)
          </label>
        </div>
        {createErrors.length > 0 && (
          <div className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{createErrors.join(' ')}</div>
        )}
        <Button variant="primary" size="sm" onClick={create} disabled={createErrors.length > 0} className="cursor-pointer disabled:opacity-50"><Plus className="w-3.5 h-3.5 mr-1.5" /> Create Project</Button>
      </div>

      {linked.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-white">
          No projects linked to this contract yet. Create one above (or in Timesheets → Projects).
        </div>
      ) : (
        <div className="space-y-4">
          {linked.map(p => (
            <div key={p.id} className="rounded-2xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                {editingId === p.id ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <input value={editName} onChange={e => setEditName(e.target.value)} className="flex-1 bg-white border border-slate-300 rounded-lg px-2 py-1 text-sm font-bold" />
                    <select value={editStatus} onChange={e => setEditStatus(e.target.value as Project['status'])} className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs">
                      <option value="planned">Planned</option>
                      <option value="in_progress">In Progress</option>
                      <option value="done">Done</option>
                      <option value="on_hold">On Hold</option>
                      <option value="active">Active (legacy)</option>
                      <option value="completed">Completed (legacy)</option>
                      <option value="archived">Archived</option>
                    </select>
                    <button onClick={saveEdit} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 cursor-pointer" title="Save"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditingId(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer" title="Cancel"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold text-slate-800">{p.name}</span>
                      {p.code && <span className="text-[10px] font-mono font-bold text-slate-400">{p.code}</span>}
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${PROJECT_STATUS_META[p.status]?.badge || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        {PROJECT_STATUS_META[p.status]?.label || p.status}
                      </span>
                      <span className="text-[10px] font-bold uppercase text-slate-400">{p.default_billable ? 'Billable' : 'Internal'}</span>
                      {(() => {
                        const b = projectBillingStatus(timeEntries as Array<{ project_id: string; invoice_id?: string | null }>, invoices, p.id);
                        if (b.issued.length > 0) return <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Invoiced{b.billedTotal > 0 ? ` · €${b.billedTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}</span>;
                        if (b.drafts.length > 0) return <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{b.drafts.length} draft invoice{b.drafts.length === 1 ? '' : 's'}</span>;
                        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Not invoiced</span>;
                      })()}
                      {(p.budget_hours || p.budget_days) && (
                        <span className="text-[10px] font-mono text-slate-500">
                          budget {p.budget_hours ? `${p.budget_hours}h` : ''}{p.budget_hours && p.budget_days ? ' · ' : ''}{p.budget_days ? `${p.budget_days}d` : ''}
                        </span>
                      )}
                      {(p.starts_on || p.ends_on) && (
                        <span className="text-[10px] font-mono text-slate-500 inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          plan {p.starts_on ? formatDate(p.starts_on) : '—'} → {p.ends_on ? formatDate(p.ends_on) : '—'}
                        </span>
                      )}
                      {(p.actual_start_on || p.actual_end_on) && (
                        <span className="text-[10px] font-mono text-slate-500">
                          actual {p.actual_start_on ? formatDate(p.actual_start_on) : '—'} → {p.actual_end_on ? formatDate(p.actual_end_on) : 'ongoing'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-[#3D87D3] hover:bg-blue-50 px-2 py-1.5 rounded-lg cursor-pointer"
                        title="Status, dates, budgets, links and documents"
                      >
                        {expandedId === p.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {expandedId === p.id ? 'Hide details' : 'Details'}
                      </button>
                      <button onClick={() => startEdit(p)} className="text-slate-400 hover:text-[#3D87D3] p-1.5 rounded hover:bg-blue-50 cursor-pointer" title="Rename project"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={async () => { if (confirm(`Delete project "${p.name}"?`)) await deleteProject(p.id); }} className="text-slate-400 hover:text-rose-600 p-1.5 rounded hover:bg-rose-50 cursor-pointer" title="Delete project"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </>
                )}
              </div>
              <div className="p-4">
                {expandedId === p.id && (
                  <div className="mb-4">
                    <ProjectDetailsPanel key={p.id} project={p} />
                  </div>
                )}
                <ProjectBillingBar
                  project={p}
                  entries={timeEntries as Array<{ project_id: string; minutes?: number | null; billable?: boolean | null; status?: string | null; billing_rate?: number | null; invoice_id?: string | null }>}
                  invoices={invoices}
                  contractId={contract.id}
                />
                <ProjectForecastEditor projectId={p.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
