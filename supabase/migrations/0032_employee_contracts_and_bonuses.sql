-- 0032: employee contracts + salary bonuses (automatic payroll building blocks)

CREATE TABLE IF NOT EXISTS public.employee_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contract_type TEXT NOT NULL DEFAULT 'indefinite' CHECK (contract_type IN ('indefinite', 'fixed_term', 'contractor')),
  title TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  notice_days INT NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'terminated')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_contracts_profile_idx ON public.employee_contracts (profile_id);

CREATE TABLE IF NOT EXISTS public.salary_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'recurring' CHECK (kind IN ('recurring', 'one_time')),
  frequency TEXT CHECK (frequency IN ('monthly', 'quarterly', 'annual')),
  start_period TEXT, -- YYYY-MM for recurring bonuses
  end_period TEXT,   -- YYYY-MM (null = open-ended)
  period TEXT,       -- YYYY-MM for one-time bonuses
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'expired', 'inactive')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salary_bonuses_profile_idx ON public.salary_bonuses (profile_id);

ALTER TABLE public.employee_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_bonuses ENABLE ROW LEVEL SECURITY;

-- Admin-only management (mirrors salary_history RLS posture)
CREATE POLICY policy_contracts_admin ON public.employee_contracts
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY policy_bonuses_admin ON public.salary_bonuses
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
