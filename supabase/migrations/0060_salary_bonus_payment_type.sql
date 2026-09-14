-- 0060: A recurring monthly extra on an employee's contract can name the Dynamic Payment Type
-- it belongs to (e.g. "Mobile Allowance"), so the contract can state "this category is €X per
-- month" and the payroll drafts it generates carry that category instead of the generic
-- 'bonus' type. NULL keeps the previous generic-bonus behaviour.

ALTER TABLE public.salary_bonuses
  ADD COLUMN IF NOT EXISTS payment_type_id UUID NULL REFERENCES public.payment_types(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.salary_bonuses.payment_type_id IS
  'Optional Dynamic Payment Type (payment_types.id) this recurring extra is contractually part of. NULL = generic Bonus category.';

CREATE INDEX IF NOT EXISTS salary_bonuses_payment_type_idx ON public.salary_bonuses (payment_type_id);
