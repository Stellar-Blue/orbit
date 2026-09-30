/**
 * Automatic carry-over of unused leave into the next year.
 *
 * The company policy (singleton `leave_policy`) decides how much may move and whether it
 * expires; everything here is pure so the calculation can be checked without a database.
 *
 * Carried-over days are always taken from the IMMEDIATELY PRECEDING year's remainder, never
 * from a chain of older years — that is what the business asks for ("count the closed year's
 * remaining leaves"), and it keeps an employee's pot from compounding silently.
 *
 * This module also owns the expiring-pot rules: the due date, how loudly to warn about it, and
 * which last-minute bookings to create so an unused pot is not simply forfeited.
 */

import { resolveWorkSchedule } from './leave-days';

const DAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface CarryoverPolicy {
  /** Cap on days moved into the next year. `null` = uncapped, `0` = no carry-over at all. */
  maxCarryoverDays: number | null;
  /** Months into the new year that carried days stay usable (3 = 31 March). `null` = never expires. */
  expiryMonths: number | null;
}

/** Uncapped and never expiring — nothing is forfeited until an admin says otherwise. */
export const DEFAULT_CARRYOVER_POLICY: CarryoverPolicy = { maxCarryoverDays: null, expiryMonths: null };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What was left of a closed year: granted (plus carry-in) minus what was actually used. */
export function remainingOfYear(params: { entitlement: number; carriedIn: number; used: number }): number {
  const { entitlement, carriedIn, used } = params;
  const left = (Number(entitlement) || 0) + (Number(carriedIn) || 0) - (Number(used) || 0);
  return Number.isFinite(left) ? round2(left) : 0;
}

/**
 * Days to carry into the next year, after the policy.
 * A year that was overspent (or exactly used up) carries nothing — a deficit is never carried.
 */
export function carryoverDays(remaining: number, policy: CarryoverPolicy = DEFAULT_CARRYOVER_POLICY): number {
  const left = Number(remaining);
  if (!Number.isFinite(left) || left <= 0) return 0;
  const cap = policy.maxCarryoverDays;
  const capped = cap === null || cap === undefined ? left : Math.min(left, Number(cap));
  return Math.max(0, round2(capped));
}

/**
 * Last day the carried-over days may be used, e.g. `2026-03-31` for a 3-month policy on 2026.
 * `null` when the policy sets no expiry.
 */
export function carryoverExpiryDate(year: number, policy: CarryoverPolicy = DEFAULT_CARRYOVER_POLICY): string | null {
  const months = policy.expiryMonths;
  if (months === null || months === undefined) return null;
  const m = Math.min(12, Math.max(1, Math.trunc(Number(months))));
  if (!Number.isFinite(m) || !Number.isFinite(year)) return null;
  // Day 0 of month index `m` in UTC = last day of month `m`. UTC keeps the date stable in
  // any timezone (the app runs in Athens, UTC+2/+3).
  const d = new Date(Date.UTC(year, m, 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Has a carried-over pot expired by `todayIso` (`yyyy-MM-dd`)? No date = never expires. */
export function carryoverExpired(expiresOn: string | null | undefined, todayIso: string): boolean {
  if (!expiresOn || !todayIso) return false;
  return todayIso > expiresOn;
}

/**
 * Can a year's carry-over be known yet? Only once the year BEFORE it has finished — a running
 * year's remainder still changes, so nothing can be carried out of it.
 */
export function previousYearHasClosed(year: number, todayIso: string): boolean {
  const currentYear = Number((todayIso || '').slice(0, 4));
  if (!Number.isFinite(currentYear) || currentYear <= 0) return false;
  return year - 1 < currentYear;
}

// ---------------------------------------------------------------------------------------------
// Due date: warning + automatic booking of whatever is left when time runs out
// ---------------------------------------------------------------------------------------------

export type CarryoverWarningLevel = 'none' | 'approaching' | 'urgent' | 'expired';

/** Days left before a warning turns urgent ("use them now"). */
export const CARRYOVER_URGENT_DAYS = 14;

export const DEFAULT_WARNING_MONTHS = 3;

/** `2026-03-31` minus 3 months → `2025-12-31`. Days are clamped to the end of the shorter month. */
export function minusMonths(isoDate: string, months: number): string | null {
  if (!isoDate || !Number.isFinite(months)) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  const total = y * 12 + (m - 1) - months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12 + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(d, lastDay))}`;
}

/** Whole days from `fromIso` to `toIso` (negative once the deadline has passed). */
export function daysUntil(fromIso: string, toIso: string): number | null {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * How loudly to warn about an expiring carry-over pot.
 * `warningMonths` (default 3) is the window the employee is told about it in.
 */
export function carryoverWarningLevel(
  expiresOn: string | null | undefined,
  todayIso: string,
  warningMonths: number = DEFAULT_WARNING_MONTHS,
): CarryoverWarningLevel {
  if (!expiresOn || !todayIso) return 'none';
  if (carryoverExpired(expiresOn, todayIso)) return 'expired';
  const from = minusMonths(expiresOn, warningMonths);
  if (!from || todayIso < from) return 'none';
  const left = daysUntil(todayIso, expiresOn);
  return left !== null && left <= CARRYOVER_URGENT_DAYS ? 'urgent' : 'approaching';
}

/** Working days between two dates (inclusive) on which the employee could actually book leave. */
export function bookableDays(
  fromIso: string,
  toIso: string,
  schedule: string[] | null | undefined,
  excludedDates: Iterable<string> = [],
): string[] {
  if (!fromIso || !toIso || fromIso > toIso) return [];
  const codes = new Set(resolveWorkSchedule(schedule));
  const excluded = new Set(excludedDates);
  const out: string[] = [];
  const start = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    const iso = d.toISOString().slice(0, 10);
    if (!codes.has(DAY_CODES[d.getUTCDay()]) || excluded.has(iso)) continue;
    out.push(iso);
  }
  return out;
}

/**
 * Dates to book automatically so an expiring carry-over pot is not simply lost.
 *
 * The pot is only booked once the employee can no longer take the days themselves: when what is
 * left of it is at least the number of working days remaining until the due date. At that point
 * EVERY remaining working day before the deadline is booked (the "last business days until this
 * date"), which is the most that can still be saved.
 *
 * Returns [] while there is still time, when nothing is left to book, or once the deadline has
 * passed. `excludedDates` must include public holidays, company closures AND days the employee
 * already has leave on, so a booking can never collide with an existing request.
 */
export function autoCarryoverBookingPlan(params: {
  remainingCarried: number;
  dueOn: string | null | undefined;
  todayIso: string;
  schedule?: string[] | null;
  excludedDates?: Iterable<string>;
}): string[] {
  const { remainingCarried, dueOn, todayIso, schedule, excludedDates } = params;
  const remaining = Math.floor(Number(remainingCarried) || 0);
  if (remaining <= 0 || !dueOn || !todayIso) return [];
  if (dueOn < todayIso) return []; // deadline already passed — the pot is gone, do not invent leave
  const available = bookableDays(todayIso, dueOn, schedule, excludedDates);
  if (available.length === 0) return [];
  // Still room to take them voluntarily. Only act when the days can no longer all be taken.
  if (remaining < available.length) return [];
  return available;
}

/**
 * Group booked dates into rows: consecutive CALENDAR days only.
 * A gap (weekend, holiday, or a day the employee is already on leave) starts a new row, so a
 * generated row can never overlap an existing leave request and trip the overlap trigger.
 */
export function groupAdjacentDays(days: string[]): string[][] {
  const groups: string[][] = [];
  for (const day of days) {
    const last = groups[groups.length - 1];
    if (last && daysUntil(last[last.length - 1], day) === 1) last.push(day);
    else groups.push([day]);
  }
  return groups;
}
