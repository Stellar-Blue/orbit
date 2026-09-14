-- ==============================================================================
-- 0064: finish what 0063 started.
--
-- 0063 dropped only the policies it knew by name. The live database also carried two
-- permissive SELECT policies on `user_roles` that were never committed to this repo
-- (`policy_user_roles_read_all`, `policy_user_roles_select`, both USING (true)), and RLS
-- ORs policies together, so 0063's stated outcome — "Dropping policy_user_roles_headless_mcp
-- also removes the only SELECT any non-admin had on this table" — did not hold: any
-- authenticated employee could still list every role row.
--
-- Same class of leftover on mcp_tool_calls: 0063's note says it "keeps the admin read +
-- authenticated insert from 0012", but that insert policy was created TO public, so an
-- anonymous caller holding the client-side publishable key could write audit rows.
-- ==============================================================================

-- Employee role rows are only ever needed for the caller themselves (auth-context builds the
-- role map for the People directory, which is admin-only), so own-row read is the whole story.
DROP POLICY IF EXISTS policy_user_roles_read_all ON public.user_roles;
DROP POLICY IF EXISTS policy_user_roles_select ON public.user_roles;

-- Keep policy_user_roles_own_read (own row OR admin) and the admin ALL policies from 0023/0063.

-- Audit traces are written by the MCP endpoint, which is always authenticated (session or
-- bearer token) — never by an anonymous caller.
ALTER POLICY "Authenticated sessions can record mcp tool calls" ON public.mcp_tool_calls
  TO authenticated;
