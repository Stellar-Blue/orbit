-- 0036: Timesheet v2 — roles, seniorities, rate cards, projects, work items, time entries
-- Implements §13 of orbit-timesheet-requirements.md (foundations + projects + entry model).
-- Supersedes the v1 contract_timesheets / catalog man-hours approach for billing.

-- 1. Job roles & seniority levels (admin-managed data, not enums)
CREATE TABLE IF NOT EXISTS public.job_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seniority_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  rank INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Effective-dated profile role history (promotion inserts a row, never edits)
CREATE TABLE IF NOT EXISTS public.profile_role_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_role_id UUID NOT NULL REFERENCES public.job_roles(id),
  seniority_id UUID NOT NULL REFERENCES public.seniority_levels(id),
  valid_from DATE NOT NULL,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_role_history_profile_idx ON public.profile_role_history (profile_id, valid_from);

-- 3. Rate cards: named, effective-dated (role × seniority) -> hourly/daily rate
CREATE TABLE IF NOT EXISTS public.rate_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  valid_from DATE,
  valid_to DATE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rate_card_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_card_id UUID NOT NULL REFERENCES public.rate_cards(id) ON DELETE CASCADE,
  job_role_id UUID NOT NULL REFERENCES public.job_roles(id),
  seniority_id UUID NOT NULL REFERENCES public.seniority_levels(id),
  hourly_rate NUMERIC(10,2),
  daily_rate NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rate_card_id, job_role_id, seniority_id)
);
CREATE INDEX IF NOT EXISTS rate_card_entries_card_idx ON public.rate_card_entries (rate_card_id);

-- 4. Projects (delivery unit; contract may be null => internal) & work items (features)
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NULL REFERENCES public.contracts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  code TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','completed','archived')),
  owner_profile_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  default_billable BOOLEAN NOT NULL DEFAULT true,
  budget_hours NUMERIC(10,2),
  budget_value NUMERIC(14,2),
  starts_on DATE,
  ends_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_contract_idx ON public.projects (contract_id);

CREATE TABLE IF NOT EXISTS public.work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'feature' CHECK (kind IN ('feature','epic','task','workstream')),
  linear_issue_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','blocked')),
  budget_hours NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_items_project_idx ON public.work_items (project_id);

-- 5. Project assignments (the role performed on that engagement, not the person's title)
CREATE TABLE IF NOT EXISTS public.project_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_role_id UUID NOT NULL REFERENCES public.job_roles(id),
  seniority_id UUID NOT NULL REFERENCES public.seniority_levels(id),
  rate_override NUMERIC(10,2),
  valid_from DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, profile_id)
);

-- 6. Time entries: effort allocation at day granularity, minutes integer
CREATE TABLE IF NOT EXISTS public.time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_item_id UUID NULL REFERENCES public.work_items(id) ON DELETE SET NULL,
  note TEXT,
  billable BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','locked')),
  -- snapshots, set at approval (billable + approved only; unrated => NULL rate, flagged)
  job_role_id UUID NULL REFERENCES public.job_roles(id),
  seniority_id UUID NULL REFERENCES public.seniority_levels(id),
  billing_rate NUMERIC(10,2),
  rate_source TEXT,
  cost_rate NUMERIC(10,2),
  currency TEXT NOT NULL DEFAULT 'EUR',
  submitted_at TIMESTAMPTZ,
  decided_by UUID NULL REFERENCES public.profiles(id),
  decided_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  invoice_id UUID NULL REFERENCES public.invoices(id) ON DELETE SET NULL,
  anomaly_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, work_date, project_id, work_item_id)
);
CREATE INDEX IF NOT EXISTS time_entries_profile_idx ON public.time_entries (profile_id, work_date);
CREATE INDEX IF NOT EXISTS time_entries_project_idx ON public.time_entries (project_id, work_date);
CREATE INDEX IF NOT EXISTS time_entries_status_idx ON public.time_entries (status);

-- 7. Monthly periods (open/close locking)
CREATE TABLE IF NOT EXISTS public.timesheet_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period TEXT NOT NULL UNIQUE, -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by UUID NULL REFERENCES public.profiles(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Profile: optional contracted weekly hours (enables per-person capacity utilization)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS contracted_weekly_hours NUMERIC(4,1);

-- 9. RLS
ALTER TABLE public.job_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seniority_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_role_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_card_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_periods ENABLE ROW LEVEL SECURITY;

-- Config + catalog tables: everyone reads, admins write
CREATE POLICY policy_job_roles_select ON public.job_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_job_roles_admin ON public.job_roles FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY policy_seniority_select ON public.seniority_levels FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_seniority_admin ON public.seniority_levels FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY policy_projects_select ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_projects_admin ON public.projects FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY policy_work_items_select ON public.work_items FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_work_items_admin ON public.work_items FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Rate cards & role history are financial/career config: admins only
CREATE POLICY policy_rate_cards_select ON public.rate_cards FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY policy_rate_cards_admin ON public.rate_cards FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY policy_rate_card_entries_select ON public.rate_card_entries FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY policy_rate_card_entries_admin ON public.rate_card_entries FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY policy_profile_role_history_select ON public.profile_role_history FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY policy_profile_role_history_admin ON public.profile_role_history FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Assignments: visible to the assigned person + admins; only admins write
CREATE POLICY policy_project_assignments_select ON public.project_assignments
  FOR SELECT TO authenticated USING (is_admin() OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid()));
CREATE POLICY policy_project_assignments_admin ON public.project_assignments
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Time entries: employees see + manage their own draft/rejected rows; admins manage all
CREATE POLICY policy_time_entries_select ON public.time_entries
  FOR SELECT TO authenticated USING (is_admin() OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid()));
CREATE POLICY policy_time_entries_insert ON public.time_entries
  FOR INSERT TO authenticated WITH CHECK (
    is_admin() OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
  );
CREATE POLICY policy_time_entries_update ON public.time_entries
  FOR UPDATE TO authenticated
  USING (is_admin() OR (
    profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
    AND status IN ('draft','rejected','submitted')
  ))
  WITH CHECK (is_admin() OR (
    profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
    AND status IN ('draft','rejected','submitted')
  ));
CREATE POLICY policy_time_entries_delete ON public.time_entries
  FOR DELETE TO authenticated USING (is_admin() OR (
    profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
    AND status IN ('draft','rejected','submitted')
  ));

-- Periods: everyone reads; admins close/reopen
CREATE POLICY policy_timesheet_periods_select ON public.timesheet_periods FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_timesheet_periods_admin ON public.timesheet_periods FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- 10. Seed default roles, seniorities, and a default rate card
DO $$
DECLARE
  v_role_engineer UUID; v_role_ba UUID; v_role_pm UUID; v_role_ds UUID; v_role_qa UUID; v_role_designer UUID; v_role_consultant UUID;
  v_sen_junior UUID; v_sen_mid UUID; v_sen_senior UUID; v_sen_principal UUID;
  v_card UUID;
BEGIN
  -- Roles
  INSERT INTO job_roles (name, sort_order) VALUES ('Engineer', 10) ON CONFLICT (name) DO NOTHING;
  INSERT INTO job_roles (name, sort_order) VALUES ('Business Analyst', 20) ON CONFLICT (name) DO NOTHING;
  INSERT INTO job_roles (name, sort_order) VALUES ('Project Manager', 30) ON CONFLICT (name) DO NOTHING;
  INSERT INTO job_roles (name, sort_order) VALUES ('Data Scientist', 40) ON CONFLICT (name) DO NOTHING;
  INSERT INTO job_roles (name, sort_order) VALUES ('QA', 50) ON CONFLICT (name) DO NOTHING;
  INSERT INTO job_roles (name, sort_order) VALUES ('Designer', 60) ON CONFLICT (name) DO NOTHING;
  INSERT INTO job_roles (name, sort_order) VALUES ('Consultant', 70) ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_role_engineer FROM job_roles WHERE name='Engineer';
  SELECT id INTO v_role_ba FROM job_roles WHERE name='Business Analyst';
  SELECT id INTO v_role_pm FROM job_roles WHERE name='Project Manager';
  SELECT id INTO v_role_ds FROM job_roles WHERE name='Data Scientist';
  SELECT id INTO v_role_qa FROM job_roles WHERE name='QA';
  SELECT id INTO v_role_designer FROM job_roles WHERE name='Designer';
  SELECT id INTO v_role_consultant FROM job_roles WHERE name='Consultant';

  -- Seniorities
  INSERT INTO seniority_levels (name, rank) VALUES ('Junior', 1) ON CONFLICT (name) DO NOTHING;
  INSERT INTO seniority_levels (name, rank) VALUES ('Mid', 2) ON CONFLICT (name) DO NOTHING;
  INSERT INTO seniority_levels (name, rank) VALUES ('Senior', 3) ON CONFLICT (name) DO NOTHING;
  INSERT INTO seniority_levels (name, rank) VALUES ('Principal', 4) ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_sen_junior FROM seniority_levels WHERE name='Junior';
  SELECT id INTO v_sen_mid FROM seniority_levels WHERE name='Mid';
  SELECT id INTO v_sen_senior FROM seniority_levels WHERE name='Senior';
  SELECT id INTO v_sen_principal FROM seniority_levels WHERE name='Principal';

  -- Default rate card (mirrors the v1 man-hours rates so v1 data remains consistent)
  IF NOT EXISTS (SELECT 1 FROM rate_cards WHERE name = 'Standard') THEN
    INSERT INTO rate_cards (name, currency, is_default, notes)
    VALUES ('Standard', 'EUR', true, 'Default list rates (hourly). Edit in Settings → Timesheets.')
    RETURNING id INTO v_card;

    INSERT INTO rate_card_entries (rate_card_id, job_role_id, seniority_id, hourly_rate, daily_rate) VALUES
      (v_card, v_role_engineer,   v_sen_junior, 45.00, 360.00),
      (v_card, v_role_engineer,   v_sen_mid,    75.00, 600.00),
      (v_card, v_role_engineer,   v_sen_senior, 120.00, 960.00),
      (v_card, v_role_engineer,   v_sen_principal, 150.00, 1200.00),
      (v_card, v_role_ba,         v_sen_junior, 40.00, 320.00),
      (v_card, v_role_ba,         v_sen_mid,    65.00, 520.00),
      (v_card, v_role_ba,         v_sen_senior, 100.00, 800.00),
      (v_card, v_role_pm,         v_sen_junior, 45.00, 360.00),
      (v_card, v_role_pm,         v_sen_mid,    75.00, 600.00),
      (v_card, v_role_pm,         v_sen_senior, 110.00, 880.00),
      (v_card, v_role_ds,         v_sen_junior, 50.00, 400.00),
      (v_card, v_role_ds,         v_sen_mid,    80.00, 640.00),
      (v_card, v_role_ds,         v_sen_senior, 125.00, 1000.00),
      (v_card, v_role_qa,         v_sen_junior, 35.00, 280.00),
      (v_card, v_role_qa,         v_sen_mid,    55.00, 440.00),
      (v_card, v_role_qa,         v_sen_senior, 85.00, 680.00),
      (v_card, v_role_designer,   v_sen_junior, 40.00, 320.00),
      (v_card, v_role_designer,   v_sen_mid,    65.00, 520.00),
      (v_card, v_role_designer,   v_sen_senior, 100.00, 800.00),
      (v_card, v_role_consultant, v_sen_junior, 40.00, 320.00),
      (v_card, v_role_consultant, v_sen_mid,    70.00, 560.00),
      (v_card, v_role_consultant, v_sen_senior, 110.00, 880.00);
  END IF;
END $$;
