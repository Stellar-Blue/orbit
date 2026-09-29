-- ==============================================================================
-- 0070: coverage_load must not be callable by anon.
--
-- 0069 revoked EXECUTE from PUBLIC before granting it to `authenticated`, but Supabase
-- installs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon`
-- on a new project, so the function also carried an explicit grant to `anon` that only a
-- named REVOKE removes. coverage_load is SECURITY DEFINER and returns who is away on a
-- given day, so anonymous callers must not reach it.
--
-- Same class of hole 0063 fixed for `FOR ALL USING (true)` policies with no TO clause.
-- ==============================================================================

REVOKE ALL ON FUNCTION public.coverage_load(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.coverage_load(UUID, DATE, DATE) TO authenticated;
