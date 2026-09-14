-- The "Effective-Dated Salary Ledger & Company Costs" is the single source of truth for pay:
-- base rates, contractual recurring extras and one-off bonuses all live in salary_history as
-- effective-dated ledger entries. The separate salary_bonuses table is retired.
--
-- entry_type:
--   base             → the monthly base rate / retainer (basis applies)
--   recurring_extra  → a contractual monthly extra (label + optional payment category)
--   one_time_bonus   → a single-month bonus (valid_from..valid_to = that month)
--
-- Employer-cost columns are intentionally left NULL on extras: the fully-loaded cost of an extra
-- is its amount × the employee's current base employer-cost ratio (see src/lib/compensation.ts).

ALTER TABLE public.salary_history ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'base';
ALTER TABLE public.salary_history ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE public.salary_history ADD COLUMN IF NOT EXISTS payment_type_id UUID
  REFERENCES public.payment_types(id) ON DELETE SET NULL;

ALTER TABLE public.salary_history DROP CONSTRAINT IF EXISTS salary_history_entry_type_check;
ALTER TABLE public.salary_history ADD CONSTRAINT salary_history_entry_type_check
  CHECK (entry_type IN ('base', 'recurring_extra', 'one_time_bonus'));

CREATE INDEX IF NOT EXISTS salary_history_entry_type_idx
  ON public.salary_history (profile_id, entry_type, valid_from DESC);
CREATE INDEX IF NOT EXISTS salary_history_payment_type_idx
  ON public.salary_history (payment_type_id);

COMMENT ON COLUMN public.salary_history.entry_type IS
  'base = base rate row, recurring_extra = contractual monthly extra, one_time_bonus = single-month bonus.';
COMMENT ON COLUMN public.salary_history.label IS 'Extra/bonus name (payroll draft note). NULL for base rows.';

-- ---------------------------------------------------------------------------
-- Migrate salary_bonuses rows into the ledger
-- ---------------------------------------------------------------------------
INSERT INTO public.salary_history (
  profile_id, valid_from, valid_to, basis, gross_amount, currency, note, created_at,
  entry_type, label, payment_type_id
)
SELECT
  b.profile_id,
  COALESCE(
    (b.start_period || '-01')::date,
    (b.period || '-01')::date,
    (SELECT MIN(sh.valid_from) FROM public.salary_history sh WHERE sh.profile_id = b.profile_id),
    CURRENT_DATE
  ),
  CASE
    WHEN b.end_period IS NOT NULL
      THEN ((b.end_period || '-01')::date + INTERVAL '1 month - 1 day')::date
    WHEN b.kind = 'recurring' AND b.status <> 'active'
      THEN CURRENT_DATE - 1  -- paused/inactive extras end here; re-open them from the salary editor
    WHEN b.period IS NOT NULL
      THEN ((b.period || '-01')::date + INTERVAL '1 month - 1 day')::date
    ELSE NULL
  END,
  'monthly_gross',
  b.amount,
  'EUR',
  b.note,
  b.created_at,
  CASE WHEN b.kind = 'recurring' THEN 'recurring_extra' ELSE 'one_time_bonus' END,
  b.name,
  b.payment_type_id
FROM public.salary_bonuses b
WHERE NOT EXISTS (
  -- Idempotency: never duplicate an already-migrated entry.
  SELECT 1 FROM public.salary_history sh
  WHERE sh.profile_id = b.profile_id
    AND sh.entry_type <> 'base'
    AND sh.label = b.name
    AND sh.gross_amount = b.amount
);

DROP TABLE IF EXISTS public.salary_bonuses;

-- ---------------------------------------------------------------------------
-- Employee-facing read path: own ledger rows, WITHOUT company employer-cost data
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.profiles p
  WHERE (
      (auth.uid() IS NOT NULL AND p.auth_user_id = auth.uid())
      OR (
        COALESCE(auth.jwt() ->> 'email', current_setting('request.jwt.claim.email', TRUE), '') <> ''
        AND lower(p.work_email) = lower(COALESCE(auth.jwt() ->> 'email', current_setting('request.jwt.claim.email', TRUE), ''))
      )
    )
  ORDER BY (p.auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

COMMENT ON FUNCTION public.current_profile_id() IS
  'Profile id of the calling authenticated user (own row only), or NULL when unauthenticated.';

-- Security-definer view: returns ONLY the caller's own rows and ONLY non-sensitive columns
-- (no employer_cost_amount / employer_cost_pct / employer_cost_multiplier).
CREATE OR REPLACE VIEW public.my_compensation
WITH (security_invoker = off) AS
SELECT
  sh.id, sh.profile_id, sh.valid_from, sh.valid_to, sh.basis, sh.gross_amount, sh.currency,
  sh.note, sh.created_at, sh.entry_type, sh.label, sh.payment_type_id
FROM public.salary_history sh
WHERE sh.profile_id = public.current_profile_id();

COMMENT ON VIEW public.my_compensation IS
  'Caller''s own remuneration ledger (base + extras + one-off bonuses) with company cost fields withheld.';

REVOKE ALL ON public.my_compensation FROM anon, public;
GRANT SELECT ON public.my_compensation TO authenticated;
