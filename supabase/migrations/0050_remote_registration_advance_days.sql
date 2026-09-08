-- 0050: Company-wide advance-registration notice for remote work declarations.
-- Employees must register remote days at least registration_advance_days calendar
-- days before the work date. 0 = rule disabled. Applies company-wide (not per-employee).
ALTER TABLE public.remote_policies
  ADD COLUMN IF NOT EXISTS registration_advance_days INTEGER NOT NULL DEFAULT 0;
