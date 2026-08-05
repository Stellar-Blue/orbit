-- 0033: salary_history.employer_cost_multiplier — the client has always written this field;
-- the column was missing, so every salary record insert failed silently (RLS-era swallowed errors).

ALTER TABLE public.salary_history ADD COLUMN IF NOT EXISTS employer_cost_multiplier NUMERIC(6, 2);
