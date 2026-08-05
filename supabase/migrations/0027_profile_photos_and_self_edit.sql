-- 0027: Slack status visibility in People + self-service profile editing + profile photos

-- 1. employee_integrations: authenticated users may READ all rows (People directory shows
--    connection status) but never token_ref. Column-level grants keep the vault ref server-only.
DROP POLICY IF EXISTS policy_employee_integrations_own_read ON public.employee_integrations;
CREATE POLICY policy_employee_integrations_read ON public.employee_integrations
  FOR SELECT TO authenticated USING (true);

GRANT SELECT (
  id, profile_id, provider, external_user_id, status, auto_reply_opt_in,
  auto_reply_template, last_set_status_text, last_set_status_emoji, last_set_expiration_ts,
  connected_at, last_synced_at, revoked_at, created_at
) ON public.employee_integrations TO authenticated;

-- 2. Self-service profile editing (limited columns only; role/team/salary stay admin-side)
CREATE POLICY policy_profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

GRANT UPDATE (first_name, last_name, name_el, title, photo_url) ON public.profiles TO authenticated;

-- 3. Profile photo storage bucket (public read, authenticated write to own folder)
INSERT INTO storage.buckets (id, name, public) VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY policy_profile_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY policy_profile_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY policy_profile_photos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
