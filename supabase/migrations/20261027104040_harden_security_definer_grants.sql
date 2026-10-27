-- ==============================================================================
-- Narrow EXECUTE on the remaining SECURITY DEFINER functions anon/authenticated
-- could reach (the advisor's anon_/authenticated_security_definer_function_executable
-- findings, minus the vault wrappers fixed in 20261027103754).
--
-- Same root cause as 0070: Supabase's `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
-- FUNCTIONS TO anon, authenticated` puts an explicit grant on every function created
-- in `public`, which `REVOKE ... FROM PUBLIC` does not remove.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. merge_counterparties — destructive, and it has no internal authorization check.
--    It reassigns contacts/contracts/invoices and deletes the source row. The only
--    caller is POST /api/counterparties/merge, which verifies the admin session and
--    then calls it with the service-role client.
-- ------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.merge_counterparties(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_counterparties(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.merge_counterparties(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.merge_counterparties(uuid, uuid) TO service_role;

-- ------------------------------------------------------------------------------
-- 2. fanout_mandatory_leaves — inserts approved mandatory leave rows for any profile
--    and never checks who is asking. Its only callers are the two SECURITY DEFINER
--    profile triggers below, which run as the function owner, and it is never called
--    from the client.
-- ------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.fanout_mandatory_leaves(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fanout_mandatory_leaves(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fanout_mandatory_leaves(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fanout_mandatory_leaves(uuid) TO service_role;

-- ------------------------------------------------------------------------------
-- 3. admin_delete_profile — guarded by is_admin() internally, and the client calls it
--    directly (src/lib/auth-context.tsx), so authenticated keeps EXECUTE. anon has no
--    reason to reach it.
-- ------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_delete_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_profile(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_profile(uuid) TO service_role;

-- ------------------------------------------------------------------------------
-- 4. Trigger / event-trigger functions. Postgres rejects direct invocation of a
--    function returning `trigger`/`event_trigger`, and EXECUTE is only checked when
--    the trigger is created, so existing triggers keep firing unchanged. No role needs
--    the grant, so drop it entirely.
-- ------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.audit_trigger_func() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_trigger_func() FROM anon;
REVOKE ALL ON FUNCTION public.audit_trigger_func() FROM authenticated;

REVOKE ALL ON FUNCTION public.guard_admin_role_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_admin_role_changes() FROM anon;
REVOKE ALL ON FUNCTION public.guard_admin_role_changes() FROM authenticated;

REVOKE ALL ON FUNCTION public.trg_fanout_mandatory_on_new_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_fanout_mandatory_on_new_profile() FROM anon;
REVOKE ALL ON FUNCTION public.trg_fanout_mandatory_on_new_profile() FROM authenticated;

REVOKE ALL ON FUNCTION public.trg_fanout_mandatory_on_profile_eligibility() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_fanout_mandatory_on_profile_eligibility() FROM anon;
REVOKE ALL ON FUNCTION public.trg_fanout_mandatory_on_profile_eligibility() FROM authenticated;

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.audit_trigger_func() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_admin_role_changes() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_fanout_mandatory_on_new_profile() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_fanout_mandatory_on_profile_eligibility() TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

-- ------------------------------------------------------------------------------
-- 5. Deliberately unchanged:
--    * is_admin() and current_profile_id() are evaluated *as the querying role* by
--      every RLS policy (114 authenticated policies, plus three {public} policies on
--      mcp_oauth_tokens/mcp_tool_calls), so anon and authenticated must keep EXECUTE.
--      They only report the caller's own identity / admin flag.
--    * coverage_load() is the coverage screen's aggregate of who is away; it is
--      authenticated-only already (0070) and returns no data an employee cannot
--      already see on that page.
-- ------------------------------------------------------------------------------
