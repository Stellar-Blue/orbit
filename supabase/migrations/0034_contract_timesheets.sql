-- 0034: Per-contract employee timesheets
-- Each employee logs hours (including minutes, stored as fractional hours) worked per
-- contract. One row per (profile, contract, day); re-saving the same day+contract upserts.

CREATE TABLE IF NOT EXISTS public.contract_timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  hours NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (hours >= 0 AND hours <= 24),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, contract_id, work_date)
);

CREATE INDEX IF NOT EXISTS contract_timesheets_profile_idx ON public.contract_timesheets (profile_id, work_date);
CREATE INDEX IF NOT EXISTS contract_timesheets_contract_idx ON public.contract_timesheets (contract_id, work_date);

ALTER TABLE public.contract_timesheets ENABLE ROW LEVEL SECURITY;

-- Everyone can read (directory/team visibility, same as leave/remote days); employees
-- write only their own rows; admins manage all.
DROP POLICY IF EXISTS policy_timesheets_select ON public.contract_timesheets;
CREATE POLICY policy_timesheets_select ON public.contract_timesheets
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS policy_timesheets_insert ON public.contract_timesheets;
CREATE POLICY policy_timesheets_insert ON public.contract_timesheets
  FOR INSERT TO authenticated WITH CHECK (
    is_admin() OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS policy_timesheets_update ON public.contract_timesheets;
CREATE POLICY policy_timesheets_update ON public.contract_timesheets
  FOR UPDATE TO authenticated
  USING (is_admin() OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid()))
  WITH CHECK (is_admin() OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS policy_timesheets_delete ON public.contract_timesheets;
CREATE POLICY policy_timesheets_delete ON public.contract_timesheets
  FOR DELETE TO authenticated
  USING (is_admin() OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid()));
