-- 0040: Remote quota may count approved leave toward the limit
-- When counts_leave is ON, approved leave days in the period are added to the employee's
-- remote-day usage. E.g. quota 2/week + 3 approved leave days that week => quota used,
-- so no remote can be declared that week.
ALTER TABLE public.remote_policies
  ADD COLUMN IF NOT EXISTS counts_leave BOOLEAN NOT NULL DEFAULT false;
