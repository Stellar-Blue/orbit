-- ==============================================================================
-- 0057: Security hardening for remote-work rules + leave entitlements reads.
--  (a) remote_policies is ADMIN-WRITE-ONLY. Any authenticated user could previously
--      change the company quota / counts_leave / registration_advance_days, i.e.
--      disable the company's own advance-notice rule.
--  (b) Enforce the remote rules SERVER-SIDE (they were client/UI-only):
--      non-admins cannot write a past remote day, nor a day inside the company's
--      advance-registration window. 'office' writes are always allowed.
--  (c) leave_entitlements: restrict SELECT to admins + the employee's own rows
--      (previously every authenticated user could read everyone's annual allowance).
-- ==============================================================================

-- (a) remote_policies: admin writes only
DROP POLICY IF EXISTS policy_remote_policies_modify ON public.remote_policies;

-- (b) remote_days rule guard
CREATE OR REPLACE FUNCTION public.guard_remote_day_rules() RETURNS trigger AS $$
DECLARE
  adv INT := 0;
BEGIN
  -- 'office' writes and admins are never blocked (admins may fix past records).
  IF NEW.mode = 'office' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(registration_advance_days, 0) INTO adv
  FROM public.remote_policies
  WHERE scope_type = 'company'
  LIMIT 1;
  adv := COALESCE(adv, 0);

  IF NEW.date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Past remote days are locked: only administrators can change past remote days.';
  END IF;
  IF adv > 0 AND NEW.date < CURRENT_DATE + make_interval(days => adv) THEN
    RAISE EXCEPTION 'Remote work must be registered at least % day(s) in advance.', adv;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_remote_day_rules ON public.remote_days;
CREATE TRIGGER trg_guard_remote_day_rules
  BEFORE INSERT OR UPDATE ON public.remote_days
  FOR EACH ROW EXECUTE FUNCTION public.guard_remote_day_rules();

-- (c) leave_entitlements: own/admin reads only
DROP POLICY IF EXISTS policy_leave_entitlements_read_all ON public.leave_entitlements;
CREATE POLICY policy_leave_entitlements_read_all ON public.leave_entitlements
  FOR SELECT TO authenticated
  USING (
    is_admin() OR profile_id IN (
      SELECT p.id FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
         OR lower(p.work_email) = lower(
              COALESCE(auth.jwt() ->> 'email',
                       current_setting('request.jwt.claim.email', true),
                       '')
            )
    )
  );
