-- 0037: Project role/seniority forecast — predicted man-hours per (role × seniority)
-- Optional planning data per project: how many hours each role/seniority combo is
-- predicted to consume on the engagement.

CREATE TABLE IF NOT EXISTS public.project_role_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  job_role_id UUID NOT NULL REFERENCES public.job_roles(id),
  seniority_id UUID NOT NULL REFERENCES public.seniority_levels(id),
  forecast_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, job_role_id, seniority_id)
);
CREATE INDEX IF NOT EXISTS project_role_forecasts_project_idx ON public.project_role_forecasts (project_id);

ALTER TABLE public.project_role_forecasts ENABLE ROW LEVEL SECURITY;

-- Planning/costing data (reveals staffing & seniority mix): admins only, like rate cards.
DROP POLICY IF EXISTS policy_project_role_forecasts_select ON public.project_role_forecasts;
CREATE POLICY policy_project_role_forecasts_select ON public.project_role_forecasts
  FOR SELECT TO authenticated USING (is_admin());
DROP POLICY IF EXISTS policy_project_role_forecasts_admin ON public.project_role_forecasts;
CREATE POLICY policy_project_role_forecasts_admin ON public.project_role_forecasts
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
