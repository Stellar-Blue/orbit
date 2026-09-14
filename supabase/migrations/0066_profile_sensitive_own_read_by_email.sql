-- ==============================================================================
-- 0066: employees must be able to read their OWN banking / tax record.
--
-- `policy_sensitive_own_read` (0030) matched on `profiles.auth_user_id = auth.uid()` alone.
-- `auth_user_id` is only written on the first successful OAuth callback, and while 0063 had
-- revoked the table-wide UPDATE grant on `profiles` that JIT write failed silently — today only
-- 4 of 14 directory profiles carry an `auth_user_id`. The other employees therefore could not
-- read their own row, so /profile and the compensation card rendered "Not configured" for their
-- own IBAN even though the value is on file.
--
-- `current_profile_id()` (0062) resolves the caller by `auth_user_id` OR by the verified JWT
-- email, which is the same rule the client uses to pick the caller's profile. Admin access is
-- unchanged: the admin ALL policies from 0018/0028 still apply.
-- ==============================================================================

DROP POLICY IF EXISTS policy_sensitive_own_read ON public.profile_sensitive;

CREATE POLICY policy_sensitive_own_read ON public.profile_sensitive
  FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id());
