"use client";

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/primitives';
import { Save, Trash2 } from 'lucide-react';

/**
 * Assigns an employee a job role + seniority (effective-dated) via profile_role_history.
 * Shows the current assignment and lets an admin change or clear it.
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

  const [roleId, setRoleId] = useState<string>(current?.job_role_id || '');
  const [senId, setSenId] = useState<string>(current?.seniority_id || '');
  const [validFrom, setValidFrom] = useState<string>(today);

  const roleName = current ? jobRoles.find(r => r.id === current.job_role_id)?.name : undefined;
  const senName = current ? seniorityLevels.find(s => s.id === current.seniority_id)?.name : undefined;

  const save = async () => {
    if (!roleId || !senId) { alert('Pick both a role and a seniority.'); return; }
    await setProfileRole(profileId, roleId, senId, validFrom);
  };
  const clear = async () => {
    if (confirm("Remove this employee's role assignment? (history is kept)")) await setProfileRole(profileId, null, null, today);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-500">
          Current: {current ? <span className="text-slate-800 font-bold">{roleName || 'Role'} · {senName || 'Seniority'}</span> : <span className="text-slate-400 italic">Unassigned</span>}
        </span>
        {current && (
          <button onClick={clear} className="text-[10px] font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1 cursor-pointer"><Trash2 className="w-3 h-3" /> Unassign</button>
        )}
      </div>
      <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
        <select value={roleId} onChange={e => setRoleId(e.target.value)} className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs" title="Job role">
          <option value="">Role…</option>
          {jobRoles.filter(r => r.active).sort((a, b) => a.sort_order - b.sort_order).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={senId} onChange={e => setSenId(e.target.value)} className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs" title="Seniority">
          <option value="">Seniority…</option>
          {seniorityLevels.filter(s => s.active).sort((a, b) => a.rank - b.rank).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} className="bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs" title="Effective date" />
        <Button variant="primary" size="sm" onClick={save} className={`cursor-pointer ${compact ? '' : 'sm:col-span-3'}`}><Save className="w-3 h-3 mr-1" /> Assign</Button>
      </div>
    </div>
  );
}
