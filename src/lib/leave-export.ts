import type { LeaveRequest, LeaveStatus, LeaveType, Profile } from './types';

/**
 * Shared pieces of the leave "Export deducted days" report, used by both the employee page
 * (`/leave`) and the admin control center (`/company-leave`) so the two exports cannot drift.
 *
 * Vocabulary: a leave "overlaps" the export window when any of its days fall inside it, so a
 * leave straddling a month boundary still shows up in both months.
 */

export type LeaveExportPeriod = 'full_year' | 'ytd' | 'month';

export interface LeaveExportFilters {
  year: number;
  period: LeaveExportPeriod;
  /** 1–12. Only read when `period === 'month'`. */
  month: number;
  /** Export only decided, deducted absences instead of every status. */
  approvedOnly: boolean;
  /** Export only employees whose profile is still active. */
  activeOnly: boolean;
}

/** Decided absences. Pending / rejected / cancelled / expired leaves never deduct a quota. */
export const APPROVED_LEAVE_STATUSES: LeaveStatus[] = ['approved', 'in_progress', 'taken'];

export const LEAVE_EXPORT_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const DETAILED_LEDGER_HEADERS = [
  'Employee Name', 'Work Email', 'Start Date', 'End Date',
  'Leave Category / Type', 'Deducted Working Days', 'Status', 'Origin', 'Note / Reason',
];

const pad = (n: number) => String(n).padStart(2, '0');
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Inclusive ISO window the report covers. `today` is injectable so "up to today" stays testable. */
export function leaveExportWindow(f: LeaveExportFilters, today: Date = new Date()) {
  const y = f.year;
  if (f.period === 'ytd') {
    const yearStart = new Date(y, 0, 1);
    const yearEnd = new Date(y, 11, 31);
    const end = today < yearStart ? yearEnd : today > yearEnd ? yearEnd : today;
    return { from: `${y}-01-01`, to: isoLocal(end), label: `Year to date (01/01/${y} → ${isoLocal(end)})` };
  }
  if (f.period === 'month') {
    const m = Math.min(12, Math.max(1, f.month));
    const lastDay = new Date(y, m, 0).getDate();
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}`, label: `Single month (${LEAVE_EXPORT_MONTHS[m - 1]} ${y})` };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Full year ${y}` };
}

/** Human-readable summary of every active filter, written into the report so the file explains itself.
 *  `employees: false` drops the employee-dimension clause (personal reports have no such choice). */
export function leaveExportScopeLabel(
  f: LeaveExportFilters,
  today: Date = new Date(),
  opts: { employees?: boolean } = {},
) {
  const parts = [
    leaveExportWindow(f, today).label,
    f.approvedOnly ? 'approved & deducted only' : 'all statuses',
  ];
  if (opts.employees !== false) {
    parts.push(f.activeOnly ? 'active employees only' : 'all employees');
  }
  return parts.join(' · ');
}

/** Leaves overlapping the window, honouring the status and active-employee filters. */
export function filterLeaveExport(
  leaves: LeaveRequest[],
  f: LeaveExportFilters,
  profiles: Profile[],
  today: Date = new Date(),
): LeaveRequest[] {
  const { from, to } = leaveExportWindow(f, today);
  const activeIds = new Set(profiles.filter(p => p.status === 'active').map(p => p.id));
  return leaves.filter(r =>
    r.start_date <= to
    && r.end_date >= from
    && (!f.approvedOnly || APPROVED_LEAVE_STATUSES.includes(r.status))
    && (!f.activeOnly || activeIds.has(r.profile_id))
  );
}

export function leaveExportEmployees(profiles: Profile[], activeOnly: boolean): Profile[] {
  return activeOnly ? profiles.filter(p => p.status === 'active') : profiles;
}

export interface LeaveExportGroup {
  profile?: Profile;
  name: string;
  email: string;
  leaves: LeaveRequest[];
  totalDays: number;
}

export type LeaveDaysOf = (req: LeaveRequest) => number;

export const workingDaysOf: LeaveDaysOf = req => Number(req.working_days || 0);

/** One contiguous block per employee, ordered by surname, newest leave first inside the block. */
export function groupLeavesByEmployee(
  leaves: LeaveRequest[],
  profiles: Profile[],
  daysOf: LeaveDaysOf = workingDaysOf,
): LeaveExportGroup[] {
  const byId = new Map(profiles.map(p => [p.id, p]));
  const bucket = new Map<string, LeaveRequest[]>();
  leaves.forEach(r => {
    const list = bucket.get(r.profile_id);
    if (list) list.push(r);
    else bucket.set(r.profile_id, [r]);
  });

  const groups: LeaveExportGroup[] = [];
  bucket.forEach((rows, id) => {
    const p = byId.get(id);
    const sorted = rows.slice().sort((a, b) => b.start_date.localeCompare(a.start_date));
    groups.push({
      profile: p,
      name: p ? `${p.first_name} ${p.last_name}` : 'Unknown Employee',
      email: p?.work_email || '',
      leaves: sorted,
      totalDays: sorted.reduce((sum, r) => sum + daysOf(r), 0),
    });
  });

  // HR reads these reports by surname; unknown employees fall back to whatever name we have.
  const sortKey = (g: LeaveExportGroup) => g.profile ? `${g.profile.last_name} ${g.profile.first_name}` : g.name;
  return groups.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export function leaveCategoryName(req: LeaveRequest, leaveTypes: LeaveType[]) {
  const lt = leaveTypes.find(t => t.id === req.leave_type_id);
  return lt ? (lt.name_en || lt.name_el) : (req.origin === 'mandatory' ? 'Mandatory Company Closure' : 'Regular Leave');
}

/**
 * Detailed deductions ledger as rows: the employee name/email are written once per employee block
 * (leaves are grouped per employee instead of repeating the name on every row), and the sheet has
 * no title banner — row 1 is `DETAILED_LEDGER_HEADERS`.
 */
export function detailedLedgerAoa(
  groups: LeaveExportGroup[],
  leaveTypes: LeaveType[],
  daysOf: LeaveDaysOf = workingDaysOf,
): (string | number)[][] {
  const rows: (string | number)[][] = [];
  groups.forEach(g => {
    g.leaves.forEach((req, i) => {
      rows.push([
        i === 0 ? g.name : '',
        i === 0 ? g.email : '',
        req.start_date,
        req.end_date,
        leaveCategoryName(req, leaveTypes),
        daysOf(req),
        req.status.toUpperCase(),
        req.origin.toUpperCase(),
        req.note || 'Standard absence record',
      ]);
    });
  });
  return rows;
}
