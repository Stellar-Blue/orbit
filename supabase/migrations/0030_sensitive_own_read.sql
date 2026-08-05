-- 0030: employees may read their own sensitive/financial profile data (view-only; edits stay admin-side)

CREATE POLICY policy_sensitive_own_read ON public.profile_sensitive
  FOR SELECT TO authenticated
  USING (profile_id = (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid()));
