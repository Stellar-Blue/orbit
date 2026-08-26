-- Harden is_admin(): close the empty-email match and pin the search_path.
--
-- The previous definition resolved the caller's email with
--   COALESCE(auth.jwt() ->> 'email', current_setting('request.jwt.claim.email', true), '')
-- and compared it directly to profiles.work_email. When the JWT carries no email
-- claim that expression is '', so any profile row with work_email = '' matched and
-- handed its role to the caller. Empty is now treated as "no email", which can
-- never match.
--
-- SECURITY DEFINER functions should also pin search_path so the tables they
-- reference cannot be shadowed by a caller-controlled schema.
--
-- Admins are unaffected: they match on auth_user_id, which is set at sign-in.

CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  claim_email text;
BEGIN
  claim_email := NULLIF(
    LOWER(COALESCE(auth.jwt() ->> 'email', current_setting('request.jwt.claim.email', true), '')),
    ''
  );

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.profile_id
    WHERE (
      (auth.uid() IS NOT NULL AND p.auth_user_id = auth.uid())
      OR (claim_email IS NOT NULL AND LOWER(p.work_email) = claim_email)
    )
    AND ur.role = 'admin'
  );
END;
$function$;
