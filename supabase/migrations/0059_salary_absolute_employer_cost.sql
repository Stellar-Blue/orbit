-- 0059: Salary records carry an absolute employer cost (€), entered by hand.
-- Why: one multiplier per person is inaccurate — employer contributions and VAT
-- treatment differ from employee to employee. The admin now enters the gross and
-- the full company cost directly; multiplier/pct stay only as a legacy fallback.

ALTER TABLE public.salary_history
  ADD COLUMN IF NOT EXISTS employer_cost_amount NUMERIC(12, 2);

COMMENT ON COLUMN public.salary_history.employer_cost_amount IS
  'Absolute monthly employer cost in EUR (full company cost minus gross). Supersedes employer_cost_multiplier / employer_cost_pct when set.';

-- Backfill existing rows from the legacy multiplier / percentage so today's
-- numbers stay exactly the same until an admin enters the real cost.
UPDATE public.salary_history
SET employer_cost_amount = ROUND(
      gross_amount * (
        COALESCE(
          employer_cost_multiplier,
          CASE WHEN employer_cost_pct IS NOT NULL THEN 1 + (employer_cost_pct / 100.0) END,
          CASE WHEN basis IN ('fixed_fee', 'fee') THEN 1.0 ELSE 1.24 END
        ) - 1
      ), 2
    )
WHERE employer_cost_amount IS NULL;
