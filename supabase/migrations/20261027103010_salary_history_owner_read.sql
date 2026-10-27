-- ==============================================================================
-- salary_history needs the own-row read policy its view depends on.
--
-- 20261027101759 made public.my_compensation a security-invoker view, so the
-- `WHERE profile_id = current_profile_id()` it applies is now backed by RLS on
-- salary_history instead of definer rights. 20260918120000 was supposed to provide
-- policy_salary_employee_select, but that file was never applied here: the live table
-- only carried the two admin policies, which would have left every employee with an
-- empty compensation ledger.
--
-- This is the same predicate the view uses, so an employee sees exactly their own
-- rows and nothing else. Admin access is unchanged.
-- ==============================================================================

DROP POLICY IF EXISTS policy_salary_employee_select ON public.salary_history;
CREATE POLICY policy_salary_employee_select ON public.salary_history
  FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());
