-- ==============================================================================
-- Employees must be able to read their OWN payments ledger.
--
-- `policy_payments_employee_select` (0008) matched on `profiles.auth_user_id = auth.uid()`
-- alone. `auth_user_id` is only written on the first successful OAuth callback, and while 0063
-- revoked the table-wide UPDATE grant on `profiles` that JIT link failed silently — so most
-- directory profiles carry no `auth_user_id` (10 of 15 here). Those employees saw an empty
-- "Confirmed Payment History" even though their paid rows exist, because every other
-- employee-facing read resolves the caller through current_profile_id(): leave/remote (0063),
-- salary via the my_compensation view (0062), profile_sensitive (0066). `payments` was the
-- only one left behind, which is exactly why payments broke while the rest of the app worked.
--
-- `current_profile_id()` (0062) resolves by `auth_user_id` OR by the verified JWT email — the
-- same rule the client uses to pick the caller's profile. Admin access is unchanged
-- (policy_payments_admin still applies). `salary_history` carries the identical 0008 defect and
-- is fixed here too, even though employees currently read the my_compensation view instead.
-- ==============================================================================

DROP POLICY IF EXISTS policy_payments_employee_select ON public.payments;
CREATE POLICY policy_payments_employee_select ON public.payments
  FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id() AND status = 'paid');

DROP POLICY IF EXISTS policy_salary_employee_select ON public.salary_history;
CREATE POLICY policy_salary_employee_select ON public.salary_history
  FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());
