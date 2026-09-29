import { eachDayOfInterval, format, parseISO } from 'date-fns';
import type { CoverageGroup, CoverageGroupMember, CoverageLoadRow } from './types';

/**
 * Coverage rules — "not everyone from the same group away at once".
 *
 * A coverage group caps how many of its members may be out on the same calendar day,
 * independently for remote work and for leave. The rule is enforced:
 *   - before an employee declares a remote day (single declare + pattern auto-fill),
 *   - before an employee files a leave request,
 *   - as a warning when an admin approves a leave request.
 *
 * Non-admins cannot read colleagues' leave/remote rows (RLS, migration 0063), so per-day
 * counts come from the SECURITY DEFINER RPC `coverage_load`. Everything in this module is
 * pure: callers hand it the RPC rows and get violations back.
 */

export type CoverageKind = 'remote' | 'leave';

export interface CoverageViolation {
  group: CoverageGroup;
  kind: CoverageKind;
  day: string;
  /** Group members OTHER than the acting employee already out that day. */
  others: number;
  /** Configured cap for this group + kind. */
  cap: number;
  /** Names reported by coverage_load for that day. */
  names: string[];
}

/** Raw shape returned by the `coverage_load` RPC. */
interface RawCoverageLoadRow {
  day: string;
  remote_count: number | string;
  leave_count: number | string;
  remote_names: string | null;
  leave_names: string | null;
}

/** The cap this group applies to `kind`, or null when it does not restrict it. */
export function coverageCap(group: CoverageGroup, kind: CoverageKind): number | null {
  if (!group.active) return null;
  const cap = kind === 'remote' ? group.max_remote_per_day : group.max_leave_per_day;
  return cap === null || cap === undefined ? null : Number(cap);
}

/** Groups with a configured cap for this kind — the only ones worth asking the RPC about. */
export function groupsWithCap(groups: CoverageGroup[], kind: CoverageKind): CoverageGroup[] {
  return (groups || []).filter(g => coverageCap(g, kind) !== null);
}

export function isMemberOfGroup(profileId: string, group: CoverageGroup, members: CoverageGroupMember[]): boolean {
  if (group.scope_type !== 'custom') return false;
  return (members || []).some(m => m.group_id === group.id && m.profile_id === profileId);
}

/**
 * Groups that contain this employee AND restrict `kind`.
 * Team-backed groups resolve membership from the profile's current team_id.
 */
export function coverageGroupsForProfile(
  profileId: string,
  teamId: string | null | undefined,
  groups: CoverageGroup[],
  members: CoverageGroupMember[],
  kind: CoverageKind,
): CoverageGroup[] {
  return groupsWithCap(groups, kind).filter(g =>
    g.scope_type === 'team'
      ? !!teamId && g.team_id === teamId
      : isMemberOfGroup(profileId, g, members)
  );
}

export function toCoverageLoadRows(raw: RawCoverageLoadRow[] | null | undefined): CoverageLoadRow[] {
  return (raw || []).map(r => ({
    day: String(r.day).slice(0, 10),
    remote_count: Number(r.remote_count) || 0,
    leave_count: Number(r.leave_count) || 0,
    remote_names: r.remote_names || null,
    leave_names: r.leave_names || null,
  }));
}

/** Inclusive list of yyyy-MM-dd days — the window handed to coverage_load. */
export function expandDateRange(fromIso: string, toIso: string): string[] {
  if (!fromIso || !toIso || fromIso > toIso) return [];
  return eachDayOfInterval({ start: parseISO(fromIso), end: parseISO(toIso) })
    .map(d => format(d, 'yyyy-MM-dd'));
}

/**
 * Days in `rows` where the employee adding one `kind` day would break the cap.
 *
 * `selfCountedDates` are days the employee is ALREADY counted on (an existing remote row for
 * that date) — the RPC count includes them, so they are removed before the check.
 */
export function findCoverageViolations(args: {
  group: CoverageGroup;
  kind: CoverageKind;
  rows: CoverageLoadRow[];
  selfCountedDates?: Set<string>;
}): CoverageViolation[] {
  const { group, kind, rows, selfCountedDates } = args;
  const cap = coverageCap(group, kind);
  if (cap === null) return [];

  const violations: CoverageViolation[] = [];
  for (const row of rows || []) {
    const counted = kind === 'remote' ? row.remote_count : row.leave_count;
    const names = (kind === 'remote' ? row.remote_names : row.leave_names) || '';
    const others = Math.max(0, counted - (selfCountedDates?.has(row.day) ? 1 : 0));
    if (others + 1 > cap) {
      violations.push({
        group,
        kind,
        day: row.day,
        others,
        cap,
        names: names ? names.split(', ').filter(Boolean) : [],
      });
    }
  }
  return violations;
}

/** One-line explanation used in dialogs and notes. */
export function describeViolation(v: CoverageViolation): string {
  const noun = v.kind === 'remote' ? 'remote' : 'on leave';
  const who = v.names.length ? ` (${v.names.join(', ')})` : '';
  return `${v.group.name} coverage rule: at most ${v.cap} can be ${v.kind === 'remote' ? 'remote' : 'on leave'} per day — ${v.others} already ${noun} on ${v.day}${who}.`;
}

/** Compact label for a day that was silently demoted to office during a bulk auto-fill. */
export function coverageOfficeNote(v: CoverageViolation): string {
  return `Office (${v.group.name} coverage cap of ${v.cap} ${v.kind === 'remote' ? 'remote' : 'on leave'} per day reached)`;
}

/** First violation of the day, if any — convenience for single-date checks. */
export function violationOnDay(violations: CoverageViolation[], day: string): CoverageViolation | null {
  return (violations || []).find(v => v.day === day) || null;
}
