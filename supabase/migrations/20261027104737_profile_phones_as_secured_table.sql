-- ==============================================================================
-- profile_phones becomes a row-level-secured table instead of a SECURITY DEFINER view.
--
-- 20260917120000 exposed admin/self phone numbers through a view with
-- security_invoker = off, because profiles.phone is not selectable by authenticated.
-- A definer view bypasses RLS on its base table and its WHERE clause is the only gate,
-- which the advisor reports as `security_definer_view` (ERROR). An invoker view cannot
-- replace it: phone is protected by a column grant, and RLS cannot hide a column, so
-- invoker semantics could only ever work by granting phone to every employee.
--
-- Instead the phone numbers live in their own table, mirrored from profiles.phone by a
-- trigger (EXECUTE revoked from users; triggers are not privilege-checked at fire time).
-- RLS on the table is the gate: an admin sees every row, an employee only their own.
-- The app keeps reading `public.profile_phones` exactly as before, so no client change.
-- ==============================================================================

DROP VIEW IF EXISTS public.profile_phones;

CREATE TABLE public.profile_phones (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone TEXT
);

COMMENT ON TABLE public.profile_phones IS
  'Phone numbers for the People directory: every row for an admin, own row for an employee. Mirrors profiles.phone via trg_sync_profile_phone; profiles.phone itself is not selectable by authenticated.';

ALTER TABLE public.profile_phones ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profile_phones FROM anon;
REVOKE ALL ON TABLE public.profile_phones FROM authenticated;
GRANT SELECT ON TABLE public.profile_phones TO authenticated;

CREATE POLICY policy_profile_phones_select ON public.profile_phones
  FOR SELECT TO authenticated
  USING (public.is_admin() OR id = public.current_profile_id());

INSERT INTO public.profile_phones (id, phone)
SELECT id, phone FROM public.profiles
ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone;

CREATE OR REPLACE FUNCTION public.sync_profile_phone() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profile_phones (id, phone) VALUES (NEW.id, NEW.phone)
  ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_phone() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_profile_phone() FROM anon;
REVOKE ALL ON FUNCTION public.sync_profile_phone() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_profile_phone() TO service_role;

DROP TRIGGER IF EXISTS trg_sync_profile_phone ON public.profiles;
CREATE TRIGGER trg_sync_profile_phone
  AFTER INSERT OR UPDATE OF phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_phone();
