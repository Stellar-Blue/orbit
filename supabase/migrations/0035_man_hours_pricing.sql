-- 0035: Man-Hours pricing (rate card) + timesheet ↔ contract-line linking
--
-- Adds a "Man-Hours & Engineering Time" pricing category whose items carry a role
-- and a seniority level (junior/mid/senior) with an hourly rate. Timesheets link to
-- a man-hours contract line, and the next-invoice charge is hours × rate per line.

-- 1. Catalog items: mark man-hours items + role/seniority tags
ALTER TABLE public.catalog_items
  ADD COLUMN IF NOT EXISTS pricing_kind TEXT NOT NULL DEFAULT 'unit' CHECK (pricing_kind IN ('unit', 'man_hours')),
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS seniority TEXT CHECK (seniority IN ('junior', 'mid', 'senior') OR seniority IS NULL);

-- 2. Contract lines: snapshot whether a line is man-hours + its role/seniority
ALTER TABLE public.contract_lines
  ADD COLUMN IF NOT EXISTS line_kind TEXT NOT NULL DEFAULT 'unit' CHECK (line_kind IN ('unit', 'man_hours')),
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS seniority TEXT CHECK (seniority IN ('junior', 'mid', 'senior') OR seniority IS NULL);

-- 3. Timesheets: link each logged entry to the man-hours line it was worked against
ALTER TABLE public.contract_timesheets
  ADD COLUMN IF NOT EXISTS contract_line_id UUID NULL REFERENCES public.contract_lines(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS contract_timesheets_line_idx ON public.contract_timesheets (contract_line_id);

-- 4. Profiles: employee seniority level used to resolve man-hours billing rates
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS seniority_level TEXT NOT NULL DEFAULT 'mid' CHECK (seniority_level IN ('junior', 'mid', 'senior'));

-- 5. Seed the Man-Hours rate card (role × level hourly rates)
DO $$
DECLARE
  v_mod UUID;
BEGIN
  SELECT id INTO v_mod FROM catalog_modules WHERE name = 'Man-Hours & Engineering Time' LIMIT 1;
  IF v_mod IS NULL THEN
    INSERT INTO catalog_modules (name, sort_order, active)
    VALUES ('Man-Hours & Engineering Time', 40, true)
    RETURNING id INTO v_mod;
  END IF;

  INSERT INTO catalog_items (module_id, name, default_unit_price, unit_label, default_frequency, active, pricing_kind, role, seniority)
  SELECT v_mod, t.name, t.price, 'hour', 'monthly', true, 'man_hours', t.role, t.seniority
  FROM (VALUES
    ('Junior Engineer',          45.00,  'engineer',        'junior'),
    ('Mid Engineer',             75.00,  'engineer',        'mid'),
    ('Senior Engineer',          120.00, 'engineer',        'senior'),
    ('Junior Consultant',        40.00,  'consultant',      'junior'),
    ('Mid Consultant',           70.00,  'consultant',      'mid'),
    ('Senior Consultant',        110.00, 'consultant',      'senior'),
    ('Junior Product Designer',  40.00,  'designer',        'junior'),
    ('Mid Product Designer',     65.00,  'designer',        'mid'),
    ('Senior Product Designer',  100.00, 'designer',        'senior'),
    ('Junior Project Manager',   45.00,  'project_manager', 'junior'),
    ('Mid Project Manager',      75.00,  'project_manager', 'mid'),
    ('Senior Project Manager',   110.00, 'project_manager', 'senior'),
    ('Junior Data Scientist',    50.00,  'data_scientist',  'junior'),
    ('Mid Data Scientist',       80.00,  'data_scientist',  'mid'),
    ('Senior Data Scientist',    125.00, 'data_scientist',  'senior'),
    ('Junior DevOps Engineer',   45.00,  'devops',          'junior'),
    ('Mid DevOps Engineer',      75.00,  'devops',          'mid'),
    ('Senior DevOps Engineer',   115.00, 'devops',          'senior')
  ) AS t(name, price, role, seniority)
  WHERE NOT EXISTS (
    SELECT 1 FROM catalog_items WHERE module_id = v_mod AND name = t.name
  );
END $$;
