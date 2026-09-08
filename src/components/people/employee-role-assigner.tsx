"use client";

import React, { useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Button, Badge } from '@/components/ui/primitives';
import { Save, Trash2, Check, X, Pencil } from 'lucide-react';

/**
 * Assigns an employee a job role + seniority (effective-dated) via profile_role_history.
 * Shows the current assignment and lets an admin change or clear it.
 *
 * This widget is rendered inside the People profile <form>, so Assign/Unassign are
 * explicitly type="button" (and Enter is suppressed) — they must NEVER submit the
 * surrounding profile form. Role & seniority live in profile_role_history and are
 * applied by "Assign" here, not by "Save Profile Changes".
 */
export function EmployeeRoleAssigner({ profileId, compact = false }: { profileId: string; compact?: boolean }) {
  const { jobRoles, seniorityLevels, profileRoleHistory, setProfileRole, updateProfileRoleHistory, deleteProfileRoleHistory } = useAuth();
  const today = new Date().toISOString().slice(0, 10);

  const current = useMemo(() => {
    const rows = profileRoleHistory
      .filter(h => h.profile_id === profileId)
      .filter(h => h.valid_from <= today && (!h.valid_to || h.valid_to >= today))
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from));
    return rows[0] || null;
  }, [profileRoleHistory, profileId, today]);

  // Until the admin edits something, the controls mirror the STORED current assignment
  // (draft-over-current). This keeps them correct even if `current` changes async or after a save.
  const [draft, setDraft] = useState<{ roleId?: string; senId?: string; validFrom?: string }>({});
  const roleId = draft.roleId ?? current?.job_role_id ?? '';
  const senId = draft.senId ?? current?.seniority_id ?? '';
  const validFrom = draft.validFrom ?? today;

  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const roleName = current ? jobRoles.find(r => r.id === current.job_role_id)?.name : undefined;
  const senName = current ? seniorityLevels.find(s => s.id === current.seniority_id)?.name : undefined;
  const roleLabel = (rid?: string) => jobRoles.find(r => r.id === rid)?.name;
  const senLabel = (sid?: string) => seniorityLevels.find(s => s.id === sid)?.name;

  // Full effective-dated history, newest first (all rows — so anything can be fixed/deleted).
  const history = useMemo(() => profileRoleHistory
    .filter(h => h.profile_id === profileId)
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))
    .map(h => ({
      row: h,
      id: h.id,
      roleName: roleLabel(h.job_role_id) || 'Role',
      senName: senLabel(h.seniority_id) || '—',
      isCurrent: current?.id === h.id,
    })), [profileRoleHistory, profileId, current, jobRoles, seniorityLevels]);

  const showFlash = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 3500);
  };

  const save = async () => {
    if (!roleId || !senId) { alert('Pick both a role and a seniority.'); return; }
    // No-op: this exact assignment is already the current one — don't rewrite history.
    if (current && current.job_role_id === roleId && current.seniority_id === senId) {
      setDraft({});
      showFlash('That is already the current assignment.');
      return;
    }
    setBusy(true);
    const ok = await setProfileRole(profileId, roleId, senId, validFrom);
    setBusy(false);
    if (ok) {
      setDraft({}); // fall back to `current`, which now reflects the new assignment
      showFlash(`Assigned from ${validFrom}.`);
    }
  };
  const clear = async () => {
    if (!confirm("Remove this employee's role assignment? (history is kept)")) return;
    setBusy(true);
    const ok = await setProfileRole(profileId, null, null, today);
    setBusy(false);
    if (ok) {
      setDraft({});
      showFlash('Assignment cleared.');
    }
  };

  // Inline row editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ roleId: string; senId: string; validFrom: string; validTo: string }>({ roleId: '', senId: '', validFrom: '', validTo: '' });

  const beginEdit = (h: (typeof history)[number]) => {
    setEditingId(h.id);
    setEdit({ roleId: h.row.job_role_id, senId: h.row.seniority_id, validFrom: h.row.valid_from, validTo: h.row.valid_to || '' });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!edit.roleId || !edit.senId) { alert('Pick both a role and a seniority.'); return; }
    if (edit.validTo && edit.validTo < edit.validFrom) { alert('End date cannot be before start date.'); return; }
    const ok = await updateProfileRoleHistory(editingId, {
      job_role_id: edit.roleId,
      seniority_id: edit.senId,
      valid_from: edit.validFrom,
      valid_to: edit.validTo ? edit.validTo : null,
    });
    if (ok) { setEditingId(null); showFlash('History entry updated.'); }
  };

  const removeRow = async (h: (typeof history)[number]) => {
    if (!confirm(`Delete this history entry (${h.roleName} · ${h.senName}, ${h.row.valid_from} → ${h.row.valid_to || 'present'})? This cannot be undone.`)) return;
    const ok = await deleteProfileRoleHistory(h.id);
    if (ok) { if (editingId === h.id) setEditingId(null); showFlash('History entry deleted.'); }
  };

  const roleOptions = (includeId?: string) => jobRoles
    .filter(r => r.active || r.id === includeId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(r => <option key={r.id} value={r.id}>{r.name}</option>);
  const senOptions = (includeId?: string) => seniorityLevels
    .filter(s => s.active || s.id === includeId)
    .sort((a, b) => a.rank - b.rank)
    .map(s => <option key={s.id} value={s.id}>{s.name}</option>);

  return (
    // Enter inside this widget must never submit the surrounding profile form.
    <div className="space-y-2" onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-500">
          Current: {current ? <span className="text-slate-800 font-bold">{roleName || 'Role'} · {senName || 'Seniority'}</span> : <span className="text-slate-400 italic">Unassigned</span>}
        </span>
        {current && (
          <button type="button" onClick={clear} disabled={busy} className="text-[10px] font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1 cursor-pointer disabled:opacity-50"><Trash2 className="w-3 h-3" /> Unassign</button>
        )}
      </div>
      <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
        <select value={roleId} onChange={e => setDraft(d => ({ ...d, roleId: e.target.value }))} className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs" title="Job role">
          <option value="">Role…</option>
          {jobRoles.filter(r => r.active).sort((a, b) => a.sort_order - b.sort_order).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={senId} onChange={e => setDraft(d => ({ ...d, senId: e.target.value }))} className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs" title="Seniority">
          <option value="">Seniority…</option>
          {seniorityLevels.filter(s => s.active).sort((a, b) => a.rank - b.rank).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={validFrom} onChange={e => setDraft(d => ({ ...d, validFrom: e.target.value }))} className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs" title="Effective date" />
        <Button type="button" variant="primary" size="sm" disabled={busy} onClick={save} className={`cursor-pointer disabled:opacity-50 ${compact ? '' : 'sm:col-span-3'}`}>
          {busy ? (<><Save className="w-3 h-3 mr-1 animate-pulse" /> Saving…</>) : (<><Save className="w-3 h-3 mr-1" /> Assign</>)}
        </Button>
      </div>
      {flash && (
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 animate-in fade-in">
          <Check className="w-3 h-3 shrink-0" /> {flash}
        </div>
      )}
      {history.length > 0 && (
        <div className="border-t border-slate-200 pt-2 mt-1">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center justify-between">
            <span>Assignment history ({history.length})</span>
            {editingId && <span className="text-[10px] font-bold normal-case text-[#3D87D3]">editing…</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="text-slate-400 uppercase text-[9px] font-extrabold">
                  <th className="py-1 pr-2 text-left font-extrabold">Role · Seniority</th>
                  <th className="py-1 px-2 text-left font-extrabold">From</th>
                  <th className="py-1 px-2 text-left font-extrabold">To</th>
                  <th className="py-1 pl-2 text-right font-extrabold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map(h => h.id === editingId ? (
                  <tr key={h.id} className="bg-sky-50/50">
                    <td className="py-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <select value={edit.roleId} onChange={e => setEdit(x => ({ ...x, roleId: e.target.value }))} className="w-full bg-white border border-slate-300 rounded px-1.5 py-1 text-[11px] min-w-0" title="Role">
                          <option value="">Role…</option>
                          {roleOptions(h.row.job_role_id)}
                        </select>
                        <select value={edit.senId} onChange={e => setEdit(x => ({ ...x, senId: e.target.value }))} className="w-full bg-white border border-slate-300 rounded px-1.5 py-1 text-[11px] min-w-0" title="Seniority">
                          <option value="">Seniority…</option>
                          {senOptions(h.row.seniority_id)}
                        </select>
                      </div>
                    </td>
                    <td className="py-1 px-2">
                      <input type="date" value={edit.validFrom} onChange={e => setEdit(x => ({ ...x, validFrom: e.target.value }))} className="w-full bg-white border border-slate-300 rounded px-1 py-1 text-[11px] font-mono" title="Valid from" />
                    </td>
                    <td className="py-1 px-2">
                      <input type="date" value={edit.validTo} onChange={e => setEdit(x => ({ ...x, validTo: e.target.value }))} className="w-full bg-white border border-slate-300 rounded px-1 py-1 text-[11px] font-mono" placeholder="present" title="Empty = still active (present)" />
                    </td>
                    <td className="py-1 pl-2 text-right whitespace-nowrap">
                      <button type="button" onClick={saveEdit} className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 hover:text-emerald-800 px-1.5 py-1 cursor-pointer" title="Save"><Check className="w-3.5 h-3.5" /> Save</button>
                      <button type="button" onClick={() => setEditingId(null)} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-600 px-1.5 py-1 cursor-pointer" title="Cancel"><X className="w-3.5 h-3.5" /> Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={h.id} className={h.isCurrent ? 'bg-emerald-50/40' : ''}>
                    <td className="py-1.5 pr-2">
                      <span className="font-semibold text-slate-800">{h.roleName} · {h.senName}</span>
                      {h.isCurrent && <Badge variant="success" className="ml-1.5 text-[8px] px-1.5">CURRENT</Badge>}
                    </td>
                    <td className="py-1.5 px-2 font-mono text-slate-600 whitespace-nowrap">{h.row.valid_from}</td>
                    <td className="py-1.5 px-2 font-mono text-slate-600 whitespace-nowrap">{h.row.valid_to || <span className="text-emerald-700 font-bold">present</span>}</td>
                    <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                      <button type="button" onClick={() => beginEdit(h)} className="inline-flex items-center text-slate-400 hover:text-[#3D87D3] px-1 py-0.5 cursor-pointer" title="Edit entry"><Pencil className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => removeRow(h)} className="inline-flex items-center text-slate-400 hover:text-rose-600 px-1 py-0.5 cursor-pointer" title="Delete entry"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {history.length === 0 && (
        <p className="text-[10px] text-slate-400">No assignments yet — use Assign above to add the first one.</p>
      )}
      <p className="text-[10px] text-slate-400 leading-snug">
        Effective-dated: use <strong>Assign</strong> to add a new current role (it closes the previous open entry the day before the chosen date). Use the pencil/trash icons in the table to edit or delete any history entry. Leave an end date empty (&ldquo;present&rdquo;) for an ongoing entry.
      </p>
    </div>
  );
}
