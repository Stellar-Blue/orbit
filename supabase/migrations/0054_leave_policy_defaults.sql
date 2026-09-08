-- ==============================================================================
-- 0054: Configurable company default for annual leave entitlement.
-- leave_entitlements already stores the ACTUAL per-employee per-year allowance
-- (entitlement_days, editable). This adds the org-wide DEFAULT used when an
-- employee has no per-year record (and as a starting point for new records),
-- so varied allowances (tenure, mid-year joiners) are handled per employee/year.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.leave_policy (
  id BOOLEAN PRIMARY KEY DEFAULT true,          -- singleton row
  default_annual_days NUMERIC NOT NULL DEFAULT 22 CHECK (default_annual_days >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL
);

INSERT INTO public.leave_policy (id, default_annual_days)
VALUES (true, 22)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.leave_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_leave_policy_select ON public.leave_policy;
CREATE POLICY policy_leave_policy_select ON public.leave_policy
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS policy_leave_policy_admin ON public.leave_policy;
CREATE POLICY policy_leave_policy_admin ON public.leave_policy
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_policy TO authenticated;
