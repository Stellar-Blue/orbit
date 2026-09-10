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
