-- ==============================================================================
-- 0065: the ledger speaks the payroll vocabulary — net → gross → full company cost.
--
-- The ledger column `gross_amount` holds what the employee actually receives (net), and the
-- figure previously shown as "Fully-Loaded Cost" (net + employer cost) is the gross. The
-- accountant's total company cost is a separate number that is not always known yet, so it gets
-- its own nullable column to be filled in later.
--
--   net                = salary_history.gross_amount          (existing column, unchanged)
--   gross              = net + employer_cost_amount           (derived, see src/lib/compensation.ts)
--   full_company_cost  = accountant's total, optional         (new column here)
--
-- Deliberately NOT exposed to the employee-facing `my_compensation` view: company cost is
-- internal economics, exactly like employer_cost_amount.
-- ==============================================================================

ALTER TABLE public.salary_history ADD COLUMN IF NOT EXISTS full_company_cost NUMERIC NULL;

COMMENT ON COLUMN public.salary_history.full_company_cost IS
  'Optional total company cost per month as billed by the accountant. Net lives in gross_amount, gross is derived (net + employer cost). NULL until the figure is known.';
