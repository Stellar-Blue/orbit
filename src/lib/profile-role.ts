import { JobRole, ProfileRoleHistory, SeniorityLevel } from './types';

/**
 * A person's job role + seniority in force on a given date, resolved from the
 * effective-dated `profile_role_history` (the single source of truth — the legacy
 * `profiles.seniority_level` field is gone). Latest `valid_from` wins.
 */
export function resolveCurrentRole(
  history: ProfileRoleHistory[],
  profileId: string,
  jobRoles: JobRole[],
  seniorityLevels: SeniorityLevel[],
  onDate = new Date().toISOString().slice(0, 10)
): { role: string; seniority: string } | null {
  const row = history
    .filter(h => h.profile_id === profileId && h.valid_from <= onDate && (!h.valid_to || h.valid_to >= onDate))
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
  if (!row) return null;
  return {
    role: jobRoles.find(r => r.id === row.job_role_id)?.name || 'Role',
    seniority: seniorityLevels.find(s => s.id === row.seniority_id)?.name || 'Seniority',
  };
}

/**
 * How a person is labelled under their name: "Role · Seniority" from the effective-dated history,
 * falling back to their employment type when nothing is assigned yet. Replaces the legacy
 * `profiles.title` (which defaulted to a meaningless "Team Member").
 */
export function roleLabel(
  profile: { id: string; employment_type?: string | null },
  history: ProfileRoleHistory[],
  jobRoles: JobRole[],
  seniorityLevels: SeniorityLevel[]
): string {
  const current = resolveCurrentRole(history, profile.id, jobRoles, seniorityLevels);
  if (current) return `${current.role} · ${current.seniority}`;
  return (profile.employment_type || '').replace(/_/g, ' ') || '—';
}
