import { SalaryRecord } from '@/lib/types';

type CostFields = Pick<SalaryRecord, 'gross_amount' | 'employer_cost_amount' | 'employer_cost_multiplier' | 'employer_cost_pct'>;

/**
 * Ratio applied to a gross amount to obtain the fully-loaded company cost.
 *
 * Prefers the hand-entered absolute employer cost (employer_cost_amount) because
 * a single multiplier is inaccurate per person. Falls back to the legacy
 * multiplier / percentage so historical rows keep their numbers.
 */
export function employerCostRatio(sal: CostFields): number {
  const gross = Number(sal.gross_amount) || 0;
  if (sal.employer_cost_amount !== null && sal.employer_cost_amount !== undefined && gross > 0) {
    return Math.max(1, (gross + Number(sal.employer_cost_amount)) / gross);
  }
  if (sal.employer_cost_multiplier !== null && sal.employer_cost_multiplier !== undefined) {
    return Number(sal.employer_cost_multiplier);
  }
  if (sal.employer_cost_pct !== null && sal.employer_cost_pct !== undefined) {
    return Number((1 + sal.employer_cost_pct / 100).toFixed(4));
  }
  return 1.24;
}

/** Fully-loaded monthly cost of a salary record (gross + employer cost). */
export function loadedMonthlyCost(sal: CostFields): number {
  const gross = Number(sal.gross_amount) || 0;
  return Number((gross * employerCostRatio(sal)).toFixed(2));
}

/* ---------------------------------------------------------------------------
 * Ledger entry helpers.
 *
 * The Effective-Dated Salary Ledger stores base rates, contractual recurring extras and one-off
 * bonuses in the same table, so EVERY lookup for "this person's salary" must filter to base rows —
 * otherwise an open-ended extra is picked up as if it were the base rate.
 * ------------------------------------------------------------------------- */

/** True for base-rate rows (also treats legacy rows without entry_type as base). */
export const isBaseSalary = (s: SalaryRecord) => !s.entry_type || s.entry_type === 'base';

/** True for contractual monthly extras (the employee's benefits). */
export const isRecurringExtra = (s: SalaryRecord) => s.entry_type === 'recurring_extra';

/** True for single-month bonuses. */
export const isOneTimeBonus = (s: SalaryRecord) => s.entry_type === 'one_time_bonus';

/** Employer-cost ratio of an employee's current base rate (extras inherit it). */
export function baseEmployerCostRatio(salaries: SalaryRecord[], profileId: string): number {
  const base = salaries.find(s => s.profile_id === profileId && isBaseSalary(s) && !s.valid_to);
  return base ? employerCostRatio(base) : 1.24;
}

/** Fully-loaded monthly cost of an extra/bonus: its amount × the employee's base ratio. */
export function loadedExtraCost(salaries: SalaryRecord[], profileId: string, amount: number): number {
  return Number((amount * baseEmployerCostRatio(salaries, profileId)).toFixed(2));
}

/** All non-base ledger entries (extras + one-off bonuses) for one employee, oldest first. */
export function extrasFor(salaries: SalaryRecord[], profileId: string): SalaryRecord[] {
  return salaries
    .filter(s => s.profile_id === profileId && !isBaseSalary(s))
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from));
}
