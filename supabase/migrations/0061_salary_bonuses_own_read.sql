-- Employees may read their OWN contractual recurring extras / bonuses so the personal
-- "Active Remuneration Structure" card can list them as benefits. Read-only, own row only:
-- writes stay admin-only, and no other employee's rows (or any company cost field) are exposed.
-- `salary_bonuses` carries no employer-cost columns, so a self-read here leaks nothing internal.
DROP POLICY IF EXISTS policy_bonuses_own_read ON public.salary_bonuses;

CREATE POLICY policy_bonuses_own_read ON public.salary_bonuses
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = auth.uid())
    OR profile_id = (
      SELECT p.id FROM public.profiles p
      WHERE lower(p.work_email) = lower(COALESCE(
        (auth.jwt() ->> 'email'),
        current_setting('request.jwt.claim.email', true),
        ''
      ))
    )
  );

COMMENT ON POLICY policy_bonuses_own_read ON public.salary_bonuses IS
  'Self-read of own recurring extras/bonuses (benefits list on /compensation). No write access.';
