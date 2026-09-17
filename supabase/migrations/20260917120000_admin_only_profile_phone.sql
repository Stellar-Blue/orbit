-- 20260917: profiles.phone becomes admin/self-only PII.
--
-- Background: `profiles` was readable in full by every signed-in user (policy_profiles_select
-- USING (true)) and 0001:406 granted ALL on all tables, so an employee could fetch a colleague's
-- phone number straight from the API even though the People directory UI hides it.
--
-- Follows the 0063 pattern used for employee_integrations: a column grant only narrows anything
-- AFTER the table-level grant is revoked. PostgREST then omits the ungranted column from
-- `select=*` and rejects an explicit `select=phone` with 42501.
--
-- The phone value stays reachable for an admin (all rows) and for the employee (own row) through
-- `profile_phones`, which the client merges into the profiles state.

REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, auth_user_id, first_name, last_name, name_el, work_email, title, team_id, manager_id,
  employment_type, start_date, end_date, status, photo_url, work_schedule, created_at,
  onboarding_completed_at, seniority_level, contracted_weekly_hours, slack_required
) ON public.profiles TO authenticated;

-- security_invoker = off (the default before PG17, stated explicitly) so the view can read the
-- revoked column as its owner; the WHERE clause is the only gate, hence the real is_admin().
CREATE OR REPLACE VIEW public.profile_phones
WITH (security_invoker = off) AS
  SELECT id, phone
  FROM public.profiles
  WHERE public.is_admin() OR id = public.current_profile_id();

COMMENT ON VIEW public.profile_phones IS
  'Phone numbers for the People directory: every row for an admin, own row for an employee. profiles.phone is not selectable by authenticated directly.';

REVOKE ALL ON public.profile_phones FROM anon;
GRANT SELECT ON public.profile_phones TO authenticated;
