"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Contract, Project } from '@/lib/types';
import { Button } from '@/components/ui/primitives';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { ProjectForecastEditor } from '@/components/timesheets/project-forecast-editor';

/** Projects linked to one contract: see / create / edit / delete + role-seniority forecast. */
export function ContractProjectsTab({ contract }: { contract: Contract }) {
  const { projects, saveProject, deleteProject } = useAuth();
  const [name, setName] = useState('');
  const [billable, setBillable] = useState(true);
  const [budgetHours, setBudgetHours] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState<Project['status']>('active');

  const linked = projects.filter(p => p.contract_id === contract.id && p.status !== 'archived');

  const create = async () => {
    if (!name.trim()) { alert('Project name required.'); return; }
    await saveProject({ name: name.trim(), contract_id: contract.id, status: 'active', default_billable: billable, budget_hours: budgetHours ? Number(budgetHours) : null });
    setName('');
    setBudgetHours('');
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
          <input value={budgetHours} onChange={e => setBudgetHours(e.target.value)} placeholder="Budget hours (optional)" className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={billable} onChange={e => setBillable(e.target.checked)} className="accent-[#3D87D3]" /> Billable to client
          </label>
        </div>
        <Button variant="primary" size="sm" onClick={create} className="cursor-pointer"><Plus className="w-3.5 h-3.5 mr-1.5" /> Create Project</Button>
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
                      <option value="active">Active</option>
                      <option value="on_hold">On Hold</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                    <button onClick={saveEdit} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 cursor-pointer" title="Save"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditingId(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer" title="Cancel"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <span className="text-sm font-extrabold text-slate-800">{p.name}</span>
                      <span className="ml-2 text-[10px] font-bold uppercase text-slate-400">{p.status} · {p.default_billable ? 'Billable' : 'Internal'}</span>
                      {p.budget_hours ? <span className="ml-2 text-[10px] font-mono text-slate-500">budget {p.budget_hours}h</span> : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => startEdit(p)} className="text-slate-400 hover:text-[#3D87D3] p-1.5 rounded hover:bg-blue-50 cursor-pointer" title="Edit project"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={async () => { if (confirm(`Delete project "${p.name}"?`)) await deleteProject(p.id); }} className="text-slate-400 hover:text-rose-600 p-1.5 rounded hover:bg-rose-50 cursor-pointer" title="Delete project"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </>
                )}
              </div>
              <div className="p-4">
                <ProjectForecastEditor projectId={p.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
