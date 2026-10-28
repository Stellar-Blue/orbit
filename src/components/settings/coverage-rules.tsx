"use client";

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, Button, Badge } from '@/components/ui/primitives';
import { notifySuccess } from '@/lib/validation-modal';
import { Users, Plus, Trash2, Edit2, X, Save, ShieldAlert, Globe, Info } from 'lucide-react';
import type { CoverageGroup } from '@/lib/types';

interface RuleForm {
  id?: string;
  name: string;
  scope_type: 'team' | 'custom';
  team_id: string;
  max_remote: string;
  max_leave: string;
  memberIds: string[];
  active: boolean;
}

const emptyForm = (): RuleForm => ({
  name: '',
  scope_type: 'team',
  team_id: '',
  max_remote: '1',
  max_leave: '',
  memberIds: [],
  active: true,
});

const capText = (value: number | null, noun: string) =>
  value === null || value === undefined ? `${noun}: no limit` : `${noun}: max ${value}/day`;

/**
 * Admin console for coverage rules — "not everyone from the same group away at once".
 *
 * Each rule targets a Team (membership follows the team) or a hand-picked list of people,
 * and caps how many of them may be remote and/or on leave on the same calendar day.
 * Enforcement lives in the remote and leave flows; this card only owns the configuration.
 */
export function CoverageRulesCard() {
  const { teams, profiles, coverageGroups, coverageGroupMembers, saveCoverageGroup, deleteCoverageGroup } = useAuth();

  const [form, setForm] = useState<RuleForm | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const employees = useMemo(
    () => profiles.filter(p => p.employment_type !== 'contractor').sort((a, b) => a.last_name.localeCompare(b.last_name)),
    [profiles]
  );

  const membersOf = (groupId: string) => coverageGroupMembers.filter(m => m.group_id === groupId);
  const teamName = (teamId: string | null) => teams.find(t => t.id === teamId)?.name || 'Unknown team';

  // A team can only carry one rule (DB unique constraint) — don't offer teams already used.
  const availableTeams = teams.filter(t => t.id === form?.team_id || !coverageGroups.some(g => g.team_id === t.id));

  const openCreate = () => setForm(emptyForm());

  const openEdit = (group: CoverageGroup) => setForm({
    id: group.id,
    name: group.name,
    scope_type: group.scope_type,
    team_id: group.team_id || '',
    max_remote: group.max_remote_per_day === null || group.max_remote_per_day === undefined ? '' : String(group.max_remote_per_day),
    max_leave: group.max_leave_per_day === null || group.max_leave_per_day === undefined ? '' : String(group.max_leave_per_day),
    memberIds: membersOf(group.id).map(m => m.profile_id),
    active: group.active,
  });

  const parseCap = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = parseInt(trimmed, 10);
    return Number.isNaN(n) ? null : Math.max(0, n);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) {
      alert('VALIDATION ERROR: Give the coverage rule a name.');
      return;
    }
    if (form.scope_type === 'team' && !form.team_id) {
      alert('VALIDATION ERROR: Pick the team this rule applies to.');
      return;
    }
    if (form.scope_type === 'custom' && form.memberIds.length === 0) {
      alert('VALIDATION ERROR: Pick at least one person for this group.');
      return;
    }
    const maxRemote = parseCap(form.max_remote);
    const maxLeave = parseCap(form.max_leave);
    if (maxRemote === null && maxLeave === null) {
      alert('VALIDATION ERROR: Set at least one cap — remote and/or leave. Leave a cap empty to not restrict that kind of absence.');
      return;
    }

    setIsSaving(true);
    const ok = await saveCoverageGroup({
      id: form.id,
      name: form.name.trim(),
      scope_type: form.scope_type,
      team_id: form.scope_type === 'team' ? form.team_id : null,
      max_remote_per_day: maxRemote,
      max_leave_per_day: maxLeave,
      active: form.active,
      memberIds: form.scope_type === 'custom' ? form.memberIds : [],
    });
    setIsSaving(false);
    if (ok) {
      notifySuccess(form.id ? 'Coverage rule updated.' : 'Coverage rule created.');
      setForm(null);
    }
  };

  const handleDelete = async (group: CoverageGroup) => {
    if (!window.confirm(`Delete the coverage rule "${group.name}"? Absences already recorded are not affected.`)) return;
    const ok = await deleteCoverageGroup(group.id);
    if (ok) {
      if (form?.id === group.id) setForm(null);
      notifySuccess('Coverage rule deleted.');
    }
  };

  return (
    <Card
      title="Team Coverage Rules"
      subtitle="Stop a whole group being away at once — cap how many of them can be remote or on leave on the same day"
      className="shadow-xs border-slate-200"
      action={
        !form && (
          <Button type="button" variant="primary" size="sm" onClick={openCreate} className="cursor-pointer">
            <Plus className="w-3.5 h-3.5 mr-1.5" /> New Rule
          </Button>
        )
      }
    >
      <div className="space-y-5 pt-2">
        <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-900 flex items-start space-x-3">
          <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-extrabold">How coverage rules are enforced</p>
            <p className="text-indigo-900/90 leading-relaxed">
              A rule counts the people already away on a date and blocks the next declaration or request that
              would go over the cap. Employees can ask an admin for an exception, and admins can always record
              absences directly. Company mandatory closures never count toward a leave cap.
            </p>
          </div>
        </div>

        {coverageGroups.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-slate-300 text-xs text-slate-500 space-y-1">
            <ShieldAlert className="w-8 h-8 mx-auto text-slate-300" />
            <p className="font-bold text-slate-600">No coverage rules yet</p>
            <p>Add one to guarantee a minimum crew stays available every day.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {coverageGroups.map(group => (
              <div key={group.id} className={`p-4 rounded-2xl border bg-white shadow-2xs flex items-start justify-between gap-4 flex-wrap ${group.active ? 'border-slate-200/90' : 'border-slate-200 bg-slate-50/70'}`}>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-sm text-slate-900">{group.name}</span>
                    {group.scope_type === 'team' ? (
                      <Badge variant="info" className="text-[10px] px-1.5 py-0">
                        <Globe className="w-3 h-3 mr-1" /> Team · {teamName(group.team_id)}
                      </Badge>
                    ) : (
                      <Badge variant="neutral" className="text-[10px] px-1.5 py-0">
                        <Users className="w-3 h-3 mr-1" /> {membersOf(group.id).length} selected
                      </Badge>
                    )}
                    {!group.active && <Badge variant="warning" className="text-[10px] px-1.5 py-0">Paused</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-600 flex-wrap">
                    <span>{capText(group.max_remote_per_day, 'Remote')}</span>
                    <span className="text-slate-300">•</span>
                    <span>{capText(group.max_leave_per_day, 'Leave')}</span>
                  </div>
                  {group.scope_type === 'custom' && (
                    <p className="text-[11px] text-slate-400">
                      {membersOf(group.id)
                        .map(m => { const p = profiles.find(pr => pr.id === m.profile_id); return p ? `${p.first_name} ${p.last_name}` : null; })
                        .filter(Boolean)
                        .join(', ') || 'No members'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button type="button" variant="secondary" size="sm" className="cursor-pointer" onClick={() => openEdit(group)}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button type="button" variant="danger" size="sm" className="cursor-pointer" onClick={() => handleDelete(group)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {form && (
          <form onSubmit={handleSubmit} className="p-5 rounded-2xl border-2 border-indigo-200 bg-indigo-50/30 space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-900">
                {form.id ? 'Edit coverage rule' : 'New coverage rule'}
              </span>
              <button type="button" onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 tracking-wide mb-1.5">Rule name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Engineering minimum crew"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2f6fa3]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 tracking-wide mb-1.5">Group</label>
                <div className="flex items-center gap-2">
                  <select
                    value={form.scope_type}
                    onChange={e => setForm({ ...form, scope_type: e.target.value as 'team' | 'custom', team_id: '' })}
                    className="px-3 py-2 border border-slate-300 rounded-xl bg-white text-xs font-semibold text-slate-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2f6fa3]"
                  >
                    <option value="team">A team</option>
                    <option value="custom">Selected people</option>
                  </select>
                  {form.scope_type === 'team' && (
                    <select
                      value={form.team_id}
                      onChange={e => setForm({ ...form, team_id: e.target.value })}
                      className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-xl bg-white text-xs font-semibold text-slate-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2f6fa3]"
                    >
                      <option value="">Choose a team…</option>
                      {availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
            </div>

            {form.scope_type === 'custom' && (
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 tracking-wide mb-1.5">
                  Members ({form.memberIds.length} selected)
                </label>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-300 bg-white divide-y divide-slate-100">
                  {employees.map(p => {
                    const checked = form.memberIds.includes(p.id);
                    return (
                      <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setForm({
                            ...form,
                            memberIds: checked ? form.memberIds.filter(id => id !== p.id) : [...form.memberIds, p.id]
                          })}
                          className="accent-[#2f6fa3]"
                        />
                        <span className="font-semibold text-slate-800">{p.first_name} {p.last_name}</span>
                        <span className="text-slate-400 ml-auto">{p.team?.name || 'No team'}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 tracking-wide mb-1.5">
                  Max remote per day
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.max_remote}
                  onChange={e => setForm({ ...form, max_remote: e.target.value })}
                  placeholder="No limit"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2f6fa3]"
                />
                <p className="text-[10px] text-slate-500 mt-1">Leave empty for no remote restriction.</p>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 tracking-wide mb-1.5">
                  Max on leave per day
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.max_leave}
                  onChange={e => setForm({ ...form, max_leave: e.target.value })}
                  placeholder="No limit"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2f6fa3]"
                />
                <p className="text-[10px] text-slate-500 mt-1">Pending requests count too. Mandatory closures never do.</p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={e => setForm({ ...form, active: e.target.checked })}
                className="accent-[#2f6fa3]"
              />
              Rule active (pausing it stops enforcement without losing the configuration)
            </label>

            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={isSaving} className="cursor-pointer">
                <Save className="w-3.5 h-3.5 mr-1.5" /> {isSaving ? 'Saving…' : form.id ? 'Update rule' : 'Create rule'}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setForm(null)} className="cursor-pointer">
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
