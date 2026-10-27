-- ==============================================================================
-- my_compensation becomes a security-invoker view.
--
-- 0062 created it WITH (security_invoker = off) so it could read salary_history and
-- return the caller's own ledger rows without exposing the employer_cost_* columns.
-- Definer semantics mean the view runs as its owner (postgres), which bypasses RLS on
-- salary_history: the view's WHERE clause was the only row filter, and Supabase's
-- `security_definer_view` lint flags exactly that.
--
-- 20260918120000 already recreated policy_salary_employee_select as
-- `profile_id = public.current_profile_id()` — the same predicate the view applies —
-- so invoker semantics return the same rows: RLS narrows salary_history to the
-- caller's own rows and the view's WHERE clause still applies on top of it.
-- authenticated keeps the table-level SELECT granted in 0001, which is what an
-- invoker view needs to read its base table.
-- ==============================================================================

ALTER VIEW public.my_compensation SET (security_invoker = on);
