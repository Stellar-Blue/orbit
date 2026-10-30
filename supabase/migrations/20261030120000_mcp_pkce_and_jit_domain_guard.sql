-- ==============================================================================
-- MCP OAuth PKCE storage + JIT profile insert domain guard.
--
-- 1. The approve route now requires PKCE (S256) and stores the challenge with the code;
--    the token route verifies code_verifier against it. Codes issued before this have no
--    challenge and are rejected at exchange (they expire after 10 minutes anyway).
--
-- 2. Email sign-up is enabled on the Supabase project, so anyone can obtain an
--    `authenticated` session with an address they control and call PostgREST directly,
--    skipping the domain/tenant checks in /auth/callback. policy_profiles_jit_insert (0004)
--    only required auth_user_id = auth.uid(), letting such a user create a profile with any
--    work_email — including squatting a colleague's address before their first SSO login.
--    The insert must now be for the caller's own, confirmed, company email.
-- ==============================================================================

ALTER TABLE public.mcp_oauth_codes ADD COLUMN IF NOT EXISTS code_challenge TEXT;

DROP POLICY IF EXISTS policy_profiles_jit_insert ON public.profiles;
CREATE POLICY policy_profiles_jit_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_user_id = auth.uid()
    AND lower(work_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    AND lower(work_email) ~ '@stellarblue\.(eu|gr)$'
  );
