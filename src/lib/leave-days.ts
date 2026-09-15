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
