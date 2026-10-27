import { addDays, addMonths, addYears, eachDayOfInterval, format, isValid, startOfWeek } from 'date-fns';

/**
 * Pure date maths behind the app's date picker: parsing what a person actually types, turning a
 * `YYYY-MM-DD` into the DD/MM/YYYY the rest of Orbit displays, and building the calendar grid.
 * Kept free of React so the behaviours the picker relies on can be verified without a browser.
 */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_MONTH = /^\d{4}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day as `YYYY-MM-DD` (never via toISOString, which shifts west of UTC). */
export function isoFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` → local midnight Date, or null for anything unusable. */
export function dateFromIso(iso?: string | null): Date | null {
  if (!iso) return null;
  const raw = String(iso).trim().slice(0, 10);
  if (!ISO_DATE.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** `YYYY-MM-DD` → `DD/MM/YYYY` for the input; empty stays empty. */
export function formatDisplayDate(iso?: string | null): string {
  const date = dateFromIso(iso);
  return date ? format(date, 'dd/MM/yyyy') : '';
}

/** `YYYY-MM` → `MM/YYYY` for the month picker. */
export function formatDisplayMonth(iso?: string | null): string {
  const raw = String(iso || '').trim();
  if (!ISO_MONTH.test(raw)) return '';
  const [year, month] = raw.split('-');
  return `${month}/${year}`;
}

function buildDate(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const fullYear = year < 100 ? 2000 + year : year;
  const date = new Date(fullYear, month - 1, day);
  // Round-trip the parts so 31/02 or 00/10 can never silently roll into another day.
  if (date.getFullYear() !== fullYear || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return isoFromDate(date);
}

/**
 * Everything a person is likely to type: 07/08/2026, 7-8-26, 2026-08-07, 07082026, `today`, `+7`,
 * `-3d`. Anything else returns null so the field can show an error instead of guessing.
 */
export function parseDateText(raw: string, today: Date = new Date()): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  if (text === 'today' || text === 'now' || text === 'σήμερα') return isoFromDate(today);

  const relative = /^([+-])\s*(\d{1,4})\s*d?$/.exec(text);
  if (relative) {
    const days = Number(relative[2]) * (relative[1] === '-' ? -1 : 1);
    return isoFromDate(addDays(today, days));
  }

  const dayFirst = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (dayFirst) return buildDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));

  const yearFirst = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(text);
  if (yearFirst) return buildDate(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));

  const compact = /^(\d{2})(\d{2})(\d{4})$/.exec(text);
  if (compact) return buildDate(Number(compact[3]), Number(compact[2]), Number(compact[1]));

  return null;
}

/** `08/2026`, `2026-08`, `8/26` → `YYYY-MM`. */
export function parseMonthText(raw: string, today: Date = new Date()): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (text === 'today' || text === 'now' || text === 'σήμερα') return isoFromDate(today).slice(0, 7);

  const relative = /^([+-])\s*(\d{1,3})\s*m?$/.exec(text);
  if (relative) {
    const months = Number(relative[2]) * (relative[1] === '-' ? -1 : 1);
    return format(addMonths(new Date(today.getFullYear(), today.getMonth(), 1), months), 'yyyy-MM');
  }

  const monthFirst = /^(\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (monthFirst) {
    const month = Number(monthFirst[1]);
    const year = Number(monthFirst[2]) < 100 ? 2000 + Number(monthFirst[2]) : Number(monthFirst[2]);
    if (month < 1 || month > 12) return null;
    return `${String(year).padStart(4, '0')}-${pad(month)}`;
  }

  const yearFirst = /^(\d{4})[/\-.](\d{1,2})$/.exec(text);
  if (yearFirst) {
    const month = Number(yearFirst[2]);
    if (month < 1 || month > 12) return null;
    return `${yearFirst[1]}-${pad(month)}`;
  }

  return null;
}

/** Keeps a typed date inside the field's allowed range; null means "not allowed". */
export function clampToRange(iso: string, min?: string | null, max?: string | null): string | null {
  if (!ISO_DATE.test(iso)) return null;
  if (min && ISO_DATE.test(min) && iso < min) return null;
  if (max && ISO_DATE.test(max) && iso > max) return null;
  return iso;
}

export const isBeforeIso = (a?: string | null, b?: string | null) => !!a && !!b && a < b;
export const isAfterIso = (a?: string | null, b?: string | null) => !!a && !!b && a > b;

/** True when the date can be picked at all (min/max aware). */
export function isSelectableIso(iso: string, min?: string | null, max?: string | null): boolean {
  return clampToRange(iso, min, max) !== null;
}

/** Moves a date by whole days, keeping it inside min/max when they are set. */
export function shiftIsoDate(
  iso: string,
  days: number,
  min?: string | null,
  max?: string | null
): string | null {
  const date = dateFromIso(iso) ?? new Date();
  return clampToRange(isoFromDate(addDays(date, days)), min, max);
}

export function shiftIsoMonth(isoMonth: string, months: number): string {
  const date = dateFromIso(`${isoMonth}-01`) ?? new Date();
  return format(addMonths(date, months), 'yyyy-MM');
}

export function shiftIsoYear(isoMonth: string, years: number): string {
  const date = dateFromIso(`${isoMonth}-01`) ?? new Date();
  return format(addYears(date, years), 'yyyy-MM');
}

/** First day of the month a `YYYY-MM-DD` falls in. */
export function monthOfIsoDate(iso: string): string {
  return iso.slice(0, 7);
}

export function isoMonthFromDate(date: Date): string {
  return format(date, 'yyyy-MM');
}

/** `October 2026` — calendar header label. */
export function monthLabel(isoMonth: string): string {
  const date = dateFromIso(`${isoMonth}-01`);
  return date ? format(date, 'MMMM yyyy') : '';
}

/**
 * Six weeks of `YYYY-MM-DD` covering the month, starting on Monday. Six rows keep the calendar a
 * constant height so the popover never jumps between months.
 */
export function monthMatrix(isoMonth: string): string[] {
  const first = dateFromIso(`${isoMonth}-01`);
  if (!first) return [];
  const gridStart = startOfWeek(first, { weekStartsOn: 1 });
  return Array.from({ length: 42 }, (_, index) => isoFromDate(addDays(gridStart, index)));
}

/** ISO weekday initials, Monday first — the calendar's column headers. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The twelve `YYYY-MM` months of a year, for the month grid. */
export function yearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${pad(index + 1)}`);
}

/** `Mon 7 Sep` — the hover/announcement label of a calendar cell. */
export function dayLabel(iso: string): string {
  const date = dateFromIso(iso);
  return date ? format(date, 'EEE d MMM') : '';
}

/** Whole days between two ISO dates (negative when `to` is earlier). */
export function daysBetweenIso(from: string, to: string): number | null {
  const start = dateFromIso(from);
  const end = dateFromIso(to);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** Inclusive list of days between two ISO dates, used by range previews. */
export function isoDaysBetween(from: string, to: string, cap = 400): string[] {
  const start = dateFromIso(from);
  const end = dateFromIso(to);
  if (!start || !end || end < start) return [];
  return eachDayOfInterval({ start, end }).slice(0, cap).map(isoFromDate);
}

/** Validates a hand-typed month stays inside the allowed range. */
export function clampMonthToRange(isoMonth: string, min?: string | null, max?: string | null): string | null {
  if (!ISO_MONTH.test(isoMonth)) return null;
  if (min && ISO_MONTH.test(min) && isoMonth < min) return null;
  if (max && ISO_MONTH.test(max) && isoMonth > max) return null;
  return isoMonth;
}

/** Exported for callers that want the same strict check the parser uses. */
export const isValidIsoDate = (iso?: string | null) => dateFromIso(iso) !== null && isValid(dateFromIso(iso) as Date);
