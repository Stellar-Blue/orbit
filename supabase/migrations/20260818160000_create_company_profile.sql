CREATE TABLE company_profile (
  id integer PRIMARY KEY CHECK (id = 1),
  name text NOT NULL,
  vat_number text,
  logo_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY;

-- Allow public read access so the login screen can load branding
CREATE POLICY "Enable read access for all users"
ON public.company_profile
AS PERMISSIVE FOR SELECT
TO public
USING (true);

-- Allow admins to update the profile
CREATE POLICY "Enable update for admins"
ON public.company_profile
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- Seed initial data based on user request
INSERT INTO company_profile (id, name, vat_number, logo_url)
VALUES (1, 'StellarBlue', '802309756', '/icon.png')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  vat_number = EXCLUDED.vat_number,
  logo_url = EXCLUDED.logo_url;

-- Remove company_afm from aade_sync_state
ALTER TABLE aade_sync_state DROP COLUMN IF EXISTS company_afm;
