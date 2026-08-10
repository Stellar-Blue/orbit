"use client";

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Contract, ContractTimesheet } from '@/lib/types';
import { Button } from '@/components/ui/primitives';
import { Clock, Plus, Trash2, Pencil, X, Save, Calendar, Layers, CheckCircle2 } from 'lucide-react';

// 7.5 h -> "7h 30m" ; minutes supported via fractional hours
const fmtHours = (h: number): string => {
  const total = Number(h) || 0;
  const hrs = Math.floor(total);
  const mins = Math.round((total - hrs) * 60);
  if (mins === 60) return `${hrs + 1}h 0m`;
  return `${hrs}h ${mins}m`;
};

const contractLabel = (c?: Contract) =>
  c ? `${c.counterparty?.legal_name || 'Counterparty'} · ${c.reference} (${c.direction})` : '—';

const roleLabel = (role?: string | null): string => {
  const map: Record<string, string> = {
    engineer: 'Engineer',
    consultant: 'Consultant',
    designer: 'Product Designer',
    project_manager: 'Project Manager',
    data_scientist: 'Data Scientist',
    devops: 'DevOps Engineer',
  };
  return role ? (map[role] || role) : 'Man-Hours';
};

export default function TimesheetsPage() {
  const { currentUser, profiles, contracts, timesheets, addTimesheet, updateTimesheet, deleteTimesheet } = useAuth();
  const isAdmin = currentUser.role === 'admin';

  const today = () => new Date().toISOString().slice(0, 10);

  const [activeProfileId, setActiveProfileId] = useState<string>(currentUser.id);
  const [contractId, setContractId] = useState('');
  const [lineId, setLineId] = useState('');
  const [workDate, setWorkDate] = useState(today);
  const [hours, setHours] = useState('8');
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Admins can view/edit any employee's timesheet; employees are locked to themselves
  const effectiveProfileId = isAdmin ? activeProfileId : currentUser.id;

  const loggableContracts = useMemo(
    () => contracts.filter(c => c.status === 'active' || c.status === 'expiring'),
    [contracts]
  );

  const myEntries = useMemo(
    () => timesheets
      .filter(t => t.profile_id === effectiveProfileId)
      .sort((a, b) => b.work_date.localeCompare(a.work_date)),
    [timesheets, effectiveProfileId]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, ContractTimesheet[]>();
    myEntries.forEach(t => {
      const arr = map.get(t.contract_id) || [];
      arr.push(t);
      map.set(t.contract_id, arr);
    });
    return Array.from(map.entries());
  }, [myEntries]);

  const profile = profiles.find(p => p.id === effectiveProfileId);
  const editingEntry = editingId ? myEntries.find(t => t.id === editingId) : null;
  const grandTotal = myEntries.reduce((acc, t) => acc + (Number(t.hours) || 0), 0);

  const manHourLines = useMemo(() => {
    const c = contracts.find(x => x.id === contractId);
    return (c?.lines || []).filter(l => l.line_kind === 'man_hours');
  }, [contracts, contractId]);
  const selectedLine = manHourLines.find(l => l.id === lineId) || null;
  const hoursNum = parseFloat(hours);
  const entryAmount = selectedLine && !isNaN(hoursNum) && hoursNum > 0 ? hoursNum * (Number(selectedLine.unit_price) || 0) : 0;

  const lineFor = (t: ContractTimesheet) => {
    const c = contracts.find(x => x.id === t.contract_id);
    return c?.lines?.find(l => l.id === t.contract_line_id);
  };
  const entryCharge = (t: ContractTimesheet) => (Number(t.hours) || 0) * (Number(lineFor(t)?.unit_price) || 0);
  const grandCharge = myEntries.reduce((acc, t) => acc + entryCharge(t), 0);

  const startEdit = (t: ContractTimesheet) => {
    setEditingId(t.id);
    setContractId(t.contract_id);
    setLineId(t.contract_line_id || '');
    setWorkDate(t.work_date);
    setHours(String(t.hours));
    setNote(t.note || '');
  };

  const resetForm = () => {
    setEditingId(null);
    setContractId('');
    setLineId('');
    setWorkDate(today());
    setHours('8');
    setNote('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseFloat(hours);
    if (!contractId) { alert('Select a contract to log hours against.'); return; }
    if (!lineId) { alert('Select the man-hours rate line (role + seniority) these hours are billed against.'); return; }
    if (isNaN(h) || h <= 0 || h > 24) { alert('Enter hours between 0 and 24 (decimals allowed, e.g. 7.5 = 7h30m).'); return; }
    if (!workDate) { alert('Pick a work date.'); return; }
    const ok = editingId
      ? await updateTimesheet(editingId, { hours: h, note: note || null, work_date: workDate, contract_id: contractId, contract_line_id: lineId || null })
      : await addTimesheet({ profile_id: effectiveProfileId, contract_id: contractId, contract_line_id: lineId || null, work_date: workDate, hours: h, note: note || null });
    if (ok) resetForm();
  };

  const inputCls = "w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
            <Clock className="w-6 h-6 mr-3 text-[#3D87D3]" /> Timesheet Tracking
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Log the hours you worked per contract — decimals allowed (7.5 = 7h30m) — so client and supplier work is accurately attributable.
          </p>
        </div>
        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-2xs">
          <span className="text-xs font-bold uppercase text-slate-400">Total logged</span>
          <div className="text-right">
            <span className="font-mono font-black text-lg text-[#3D87D3] block leading-tight">{fmtHours(grandTotal)}</span>
            <span className="font-mono font-bold text-xs text-emerald-600 block">≈ €{grandCharge.toLocaleString(undefined, { maximumFractionDigits: 2 })} billable</span>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-xs font-bold uppercase text-slate-400">Employee</span>
          <select
            value={effectiveProfileId}
            onChange={e => { setActiveProfileId(e.target.value); resetForm(); }}
            className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3D87D3]"
          >
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
            ))}
          </select>
          <span className="text-[11px] text-slate-400">Viewing / editing {profile ? `${profile.first_name} ${profile.last_name}` : '…'}'s timesheet</span>
        </div>
      )}

      {/* Entry form */}
      <form onSubmit={submit} className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-extrabold text-slate-800 flex items-center">
            {editingId ? <Save className="w-4 h-4 mr-2 text-amber-500" /> : <Plus className="w-4 h-4 mr-2 text-[#3D87D3]" />}
            {editingId ? 'Edit Timesheet Entry' : 'Log Hours'}
          </span>
          {editingId && (
            <button type="button" onClick={resetForm} className="text-[11px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer">
              <X className="w-3.5 h-3.5" /> Cancel edit
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-3">
            <label className="block text-xs font-bold text-slate-700 mb-1">Contract</label>
            <select
              value={contractId}
              onChange={e => { setContractId(e.target.value); setLineId(''); }}
              className={inputCls}
              required
            >
              <option value="">Select an active contract…</option>
              {loggableContracts.map(c => (
                <option key={c.id} value={c.id}>{contractLabel(c)}</option>
              ))}
            </select>
            {loggableContracts.length === 0 && (
              <span className="text-[11px] text-amber-600 mt-1 block">No active contracts available to log against yet.</span>
            )}
          </div>
          <div className="lg:col-span-3">
            <label className="block text-xs font-bold text-slate-700 mb-1">Man-Hours Rate Line (role · seniority)</label>
            <select value={lineId} onChange={e => setLineId(e.target.value)} className={inputCls} required>
              <option value="">{contractId ? 'Select the man-hours line…' : 'Pick a contract first…'}</option>
              {manHourLines.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name} · {roleLabel(l.role)} · {String(l.seniority || 'mid').toUpperCase()} — €{Number(l.unit_price) || 0}/hr
                </option>
              ))}
            </select>
            {contractId && manHourLines.length === 0 && (
              <span className="text-[11px] text-amber-600 mt-1 block">This contract has no man-hours line. Add one in its Rate Sheet (Man-Hours & Engineering Time) first.</span>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Work Date</label>
            <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} className={inputCls} required />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Hours</label>
            <input
              type="number" step="0.25" min="0" max="24"
              value={hours}
              onChange={e => setHours(e.target.value)}
              className={`${inputCls} font-mono font-bold`}
              placeholder="e.g. 7.5"
              required
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">Decimal hours · 7.5 = 7h30m</span>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Est. Client Charge</label>
            <div className={`${inputCls} font-mono font-black text-emerald-700 bg-emerald-50/50`}>
              €{entryAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">hours × line rate</span>
          </div>
          <div className="lg:col-span-3">
            <label className="block text-xs font-bold text-slate-700 mb-1">Note <span className="font-normal text-slate-400">(optional)</span></label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} className={inputCls} placeholder="What did you work on?" />
          </div>
          <div className="lg:col-span-3 flex items-end">
            <Button type="submit" variant={editingId ? 'secondary' : 'primary'} className="w-full cursor-pointer">
              {editingId ? 'Save Changes' : 'Add Entry'}
            </Button>
          </div>
        </div>
      </form>

      {/* Entries grouped by contract */}
      {grouped.length === 0 ? (
        <div className="p-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-white">
          <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          No timesheet entries logged yet{isAdmin ? ` for ${profile?.first_name || 'this employee'}` : ''}. Add your first entry above.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([cid, entries]) => {
            const contract = contracts.find(c => c.id === cid);
            const total = entries.reduce((acc, t) => acc + (Number(t.hours) || 0), 0);
            const charge = entries.reduce((acc, t) => acc + entryCharge(t), 0);
            return (
              <div key={cid} className="rounded-2xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                  <span className="text-sm font-extrabold text-slate-800 flex items-center min-w-0">
                    <Layers className="w-4 h-4 mr-2 text-indigo-500 shrink-0" />
                    <span className="truncate">{contractLabel(contract)}</span>
                  </span>
                  <div className="text-right whitespace-nowrap">
                    <span className="font-mono font-black text-[#3D87D3] block leading-tight">{fmtHours(total)}</span>
                    <span className="font-mono font-bold text-[11px] text-emerald-600 block">€{charge.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-500 text-[10px] font-extrabold uppercase tracking-wider border-b border-slate-200">
                        <th className="py-2 px-4">Date</th>
                        <th className="py-2 px-3">Rate Line</th>
                        <th className="py-2 px-3">Hours</th>
                        <th className="py-2 px-3">Charge</th>
                        <th className="py-2 px-3">Note</th>
                        <th className="py-2 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {entries.map(t => {
                        const ln = lineFor(t);
                        return (
                          <tr key={t.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-2.5 px-4 font-mono text-slate-700">
                              {new Date(t.work_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="py-2.5 px-3">
                              {ln ? (
                                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 inline-block">
                                  {roleLabel(ln.role)} · {String(ln.seniority || 'mid').toUpperCase()} · €{Number(ln.unit_price) || 0}/hr
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">{fmtHours(Number(t.hours) || 0)}</td>
                            <td className="py-2.5 px-3 font-mono font-bold text-emerald-700 whitespace-nowrap">€{entryCharge(t).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                            <td className="py-2.5 px-3 text-slate-500 text-xs">{t.note || '—'}</td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => startEdit(t)}
                                  title="Edit entry"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#3D87D3] hover:bg-blue-50 transition-colors cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (confirm(`Delete timesheet entry for ${t.work_date} (${fmtHours(Number(t.hours) || 0)})?`)) {
                                      await deleteTimesheet(t.id);
                                      if (editingId === t.id) resetForm();
                                    }
                                  }}
                                  title="Delete entry"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingEntry && (
        <div className="flex items-center gap-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5" /> Editing {contractLabel(contracts.find(c => c.id === editingEntry.contract_id))} · {editingEntry.work_date}
        </div>
      )}
    </div>
  );
}
