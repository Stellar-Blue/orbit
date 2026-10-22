import { addDays, format, parseISO } from 'date-fns';
import type { PublicHoliday } from './types';

/**
 * Working-day counting shared by the leave pages. Previously each page rolled its own loop and the
 * "Record Leave for Employee" modal compared the DB's 3-letter schedule codes ('Mon') against full
 * weekday names ('Monday'), so every employee showed 0 calculated days.
 */

/** The canonical weekday codes stored in `profiles.work_schedule` (0001_initial_schema default). */
export const DEFAULT_WORK_SCHEDULE = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const DAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Old rows/fallbacks may hold 'Monday' instead of 'Mon' — normalise before comparing. */
export function resolveWorkSchedule(schedule?: string[] | null): string[] {
  if (!schedule || schedule.length === 0) return DEFAULT_WORK_SCHEDULE;
  const codes = schedule
    .map(day => {
      const code = String(day).trim().slice(0, 3).toLowerCase();
      return DAY_CODES.find(c => c.toLowerCase() === code) || '';
    })
    .filter(Boolean);
  return codes.length ? codes : DEFAULT_WORK_SCHEDULE;
}

/** ISO `yyyy-MM-dd` dates of public holidays, ready to hand to `countWorkingDays`. */
export function holidayDates(holidays?: Pick<PublicHoliday, 'date'>[] | null): string[] {
  return (holidays || []).map(h => h.date);
}

/**
 * Should a leave's stored `working_days` be recounted because its dates moved?
 *
 * Editing the dates of a leave does not change the stored day count, so the balance keeps being
 * deducted by the OLD total — a range shortened from 5 days to 2 still cost 5, and one lengthened
 * from 2 to 5 still cost 2 (that is how a 05/01–07/01 leave ended up costing 1 day).
 *
 * - `origin: 'mandatory'` rows are owned by the company closure, never recounted here.
 * - An explicit `workingDays` means the caller already decided, so it always wins.
 */
export function needsWorkingDaysRecount(params: {
  prevStart?: string | null;
  prevEnd?: string | null;
  nextStart?: string | null;
  nextEnd?: string | null;
  explicitWorkingDays?: number;
  origin?: string | null;
}): boolean {
  const { prevStart, prevEnd, nextStart, nextEnd, explicitWorkingDays, origin } = params;
  if (explicitWorkingDays !== undefined) return false;
  if (origin === 'mandatory') return false;
  if (!prevStart || !prevEnd || !nextStart || !nextEnd) return false;
  return nextStart !== prevStart || nextEnd !== prevEnd;
}

/**
 * Inclusive count of scheduled working days between two `yyyy-MM-dd` dates, skipping weekends
 * (days off the schedule) and any date in `excludedDates` (holidays, mandatory closures, …).
 */
export function countWorkingDays(
  startISO: string,
  endISO: string,
  schedule?: string[] | null,
  excludedDates: Iterable<string> = [],
): number {
  if (!startISO || !endISO || startISO > endISO) return 0;

  const first = parseISO(startISO);
  if (Number.isNaN(first.getTime())) return 0;

  const codes = new Set(resolveWorkSchedule(schedule));
  const excluded = new Set(excludedDates);

  let count = 0;
  for (let day = first; ; day = addDays(day, 1)) {
    const iso = format(day, 'yyyy-MM-dd');
    if (iso > endISO) break;
    if (codes.has(DAY_CODES[day.getDay()]) && !excluded.has(iso)) count++;
  }
  return count;
}

/**
 * How many of a leave's deducted days fall inside one calendar year.
 *
 * A leave row's `working_days` is the total for its WHOLE range, so a range that crosses
 * 31 December has to be split by the year each deducted day actually falls in. Attributing the
 * whole total to `start_date`'s year is what made the 31/12→02/01 Christmas closure (2 working
 * days: 31 Dec and 2 Jan) deduct both days from 2025 and nothing from 2026.
 *
 * The stored total was counted by walking the range from the start and taking the scheduled,
 * non-excluded days — so the deducted days are the FIRST `workingDays` qualifying days. This
 * re-walks in the same order and buckets them by year.
 *
 * A range sitting entirely inside `year` returns `workingDays` untouched, which keeps every
 * existing single-year value exactly as it was (including admin-adjusted rows whose stored
 * total does not match the schedule).
 */
export function deductedDaysInYear(params: {
  start: string;
  end: string;
  workingDays: number;
  year: number;
  schedule?: string[] | null;
  /** Skip a day entirely (holidays, plus company closures for personal leave). */
  isExcludedDate?: (iso: string) => boolean;
}): number {
  const { start, end, workingDays, year, isExcludedDate } = params;
  const budget = Number(workingDays) || 0;
  if (!start || !end || start > end || budget <= 0) return 0;

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (end < yearStart || start > yearEnd) return 0;
  // Fast path: the whole leave is inside this year, so the stored total is the answer.
  if (start >= yearStart && end <= yearEnd) return budget;

  const first = parseISO(start);
  if (Number.isNaN(first.getTime())) return 0;

  const codes = new Set(resolveWorkSchedule(params.schedule));

  let consumed = 0;
  let inYear = 0;
  for (let day = first; consumed < budget; day = addDays(day, 1)) {
    const iso = format(day, 'yyyy-MM-dd');
    if (iso > end) break;
    if (!codes.has(DAY_CODES[day.getDay()])) continue;
    if (isExcludedDate?.(iso)) continue;
    consumed++;
    if (day.getFullYear() === year) inYear++;
  }
  return inYear;
}

/** Statuses whose days are already eaten out of the allowance. */
const DEDUCTED_STATUSES = ['approved', 'in_progress', 'taken'];

/**
 * Ids of the company closures that may deduct anything. A draft or cancelled closure is register
 * history: its leftover fan-out rows used to keep eating everyone's allowance until an admin
 * noticed the pool did not add up.
 */
export function publishedClosureIds(closures: { id: string; status: string }[]): Set<string> {
  return new Set(closures.filter(c => c.status === 'published').map(c => c.id));
}

/**
 * Does this company-closure (mandatory) row still deduct from the allowance?
 *
 * Only rows of a published closure count. Rows an admin detached by hand never deduct, and legacy
 * rows with no closure link are honoured as-is.
 */
export function mandatoryRowDeducts(
  row: { origin?: string | null; detached?: boolean | null; status: string; mandatory_leave_id?: string | null },
  liveClosureIds: ReadonlySet<string>,
): boolean {
  if (row.origin !== 'mandatory' || row.detached) return false;
  if (!DEDUCTED_STATUSES.includes(row.status)) return false;
  return !row.mandatory_leave_id || liveClosureIds.has(row.mandatory_leave_id);
}
