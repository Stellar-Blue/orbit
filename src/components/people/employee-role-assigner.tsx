"use client";

import React, { useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/primitives';
import { Save, Trash2, Check } from 'lucide-react';

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
  const { jobRoles, seniorityLevels, profileRoleHistory, setProfileRole } = useAuth();
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
      <p className="text-[10px] text-slate-400 leading-snug">
        Effective-dated — apply with <strong>Assign</strong> (separate from &ldquo;Save Profile Changes&rdquo;). Assigning closes the previous assignment the day before the chosen date.
      </p>
    </div>
  );
}
