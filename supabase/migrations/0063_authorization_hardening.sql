-- ==============================================================================
-- 0063: Authorization hardening.
--
-- Until now the admin/employee split lived only in the browser: auth-context.tsx
-- gates most queries behind `isAdmin ? select(*) : empty`, while the matching RLS
-- policies were `USING (true)`. Any authenticated employee could read every
-- contract, invoice, budget and colleague leave request straight from PostgREST.
-- Three holes needed no login at all:
--   * 0014 granted `anon` (the public key in the client bundle) FOR ALL on the
--     financial tables and the MCP OAuth token store;
--   * the `invoices` and `contract-documents` storage buckets were public, and
--     their policies omitted the TO clause, so anon could also delete objects;
--   * policy_user_roles_jit_insert let any user insert their own 'admin' role
--     (the 0023 guard trigger only fires BEFORE UPDATE OR DELETE).
--
-- The authorization model mirrors the client gating in auth-context.tsx:375-400 —
-- admin-only where the client sends `empty` to employees, own-row where it sends
-- `.eq('profile_id', ...)`, unrestricted where it loads for everyone.
--
-- This file is written to be authoritative rather than incremental: for every
-- table it hardens it drops ALL pre-existing policies before creating the
-- intended set. Several tables (remote_days, remote_patterns, mandatory_leaves)
-- have RLS enabled in 0001 but no policy anywhere in this repo, yet the app reads
-- and writes them in production, so policies exist in the live database that were
-- never committed. A blind `DROP POLICY IF EXISTS <known name>` would leave those
-- in place and they would OR straight back in.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Helpers
-- ------------------------------------------------------------------------------

-- is_admin() is SECURITY DEFINER with no search_path, which is a hijack waiting to
-- happen. The work_email branch matched on request.jwt.claim.email, a GUC PostgREST
-- deprecated; it returns NULL, so only the auth_user_id branch ever did anything.
-- 0057 already moved to auth.jwt() ->> 'email' elsewhere.
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.profile_id
        WHERE (p.auth_user_id = auth.uid()
               OR lower(p.work_email) = lower(COALESCE(auth.jwt() ->> 'email', '')))
          AND ur.role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

-- The own-row policies below use public.current_profile_id(), defined in 0062.

-- Drops every policy on a table so the sets created below are the complete truth.
CREATE OR REPLACE FUNCTION public.drop_all_policies(p_table TEXT) RETURNS VOID AS $$
DECLARE
    v_policy_name TEXT;
BEGIN
    FOR v_policy_name IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = p_table
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', v_policy_name, p_table);
    END LOOP;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

-- ------------------------------------------------------------------------------
-- 2. Admin-only tables
--
-- Everything the client hides from employees with `isAdmin ? ... : emptyRes`.
-- This removes the 0014 anon grants, the `FOR ALL USING (true)` policies with no
-- TO clause in 0011 / 0007 / 0041 / 20260819114400 (which applied to `public`,
-- i.e. anon), and the `auth.role() = 'authenticated'` policies in the budgeting
-- module and 0047.
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'counterparties', 'contracts', 'contract_lines', 'contract_line_groups',
        'contract_schedule', 'counterparty_contacts', 'counterparty_roles',
        'catalog_modules', 'catalog_items',
        'attio_links', 'attio_events', 'attio_outbox',
        'invoices', 'invoice_documents', 'invoice_payments', 'invoice_allocations',
        'invoice_links',
        'budgets', 'budget_lines', 'budget_categories', 'recurring_commitments',
        'aade_sync_state', 'aade_documents', 'aade_cancellations',
        'mcp_idempotency', 'mcp_oauth_codes'
    ]
    LOOP
        -- The repo and the live database have drifted before, so a table named here may
        -- not exist. Skip loudly rather than failing the whole migration.
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE NOTICE 'Skipping %: table does not exist', v_table;
            CONTINUE;
        END IF;

        PERFORM public.drop_all_policies(v_table);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
            'policy_' || v_table || '_admin', v_table
        );
    END LOOP;
END;
$$;

-- mcp_oauth_tokens keeps the admin-own read/delete from 0013; only the anon grant goes.
DROP POLICY IF EXISTS policy_mcp_oauth_tokens_headless_mcp ON public.mcp_oauth_tokens;

-- mcp_tool_calls keeps the admin read + authenticated insert from 0012.
DROP POLICY IF EXISTS policy_mcp_tool_calls_headless_mcp ON public.mcp_tool_calls;

-- ------------------------------------------------------------------------------
-- 3. Tables every employee legitimately reads, but only admins may write
--
-- These are loaded unconditionally by auth-context.tsx, so SELECT stays open to
-- authenticated users. 0047 handed every employee INSERT/UPDATE/DELETE on `roles`.
-- ------------------------------------------------------------------------------

SELECT public.drop_all_policies('roles');
CREATE POLICY policy_roles_select ON public.roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_roles_admin ON public.roles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Category names are labels, not financial data, and auth-context.tsx loads them for
-- everyone alongside the admin-gated invoice tables.
SELECT public.drop_all_policies('invoice_categories');
CREATE POLICY policy_invoice_categories_select ON public.invoice_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_invoice_categories_admin ON public.invoice_categories
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Slack/Outlook configuration, minus the secrets, which 0025 keeps in the vault. Every
-- employee's onboarding gate reads this (auth-context.tsx:427), so SELECT stays open;
-- only writes narrow to admins, and they go through the API route's service role anyway.
SELECT public.drop_all_policies('integration_settings');
CREATE POLICY policy_integration_settings_read ON public.integration_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_integration_settings_admin ON public.integration_settings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

SELECT public.drop_all_policies('mandatory_leaves');
CREATE POLICY policy_mandatory_leaves_select ON public.mandatory_leaves
  FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_mandatory_leaves_admin ON public.mandatory_leaves
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- 4. Own-row tables
-- ------------------------------------------------------------------------------

-- leave_requests is the gap 0057 left behind: it fixed leave_entitlements but
-- policy_leave_select (0001:432) still let every employee read every colleague's
-- leave, reasons included.
SELECT public.drop_all_policies('leave_requests');
CREATE POLICY policy_leave_select ON public.leave_requests
  FOR SELECT TO authenticated
  USING (public.is_admin() OR profile_id = public.current_profile_id());
CREATE POLICY policy_leave_insert ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR profile_id = public.current_profile_id());
CREATE POLICY policy_leave_update ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR profile_id = public.current_profile_id())
  WITH CHECK (public.is_admin() OR profile_id = public.current_profile_id());
CREATE POLICY policy_leave_delete ON public.leave_requests
  FOR DELETE TO authenticated
  USING (public.is_admin() OR profile_id = public.current_profile_id());

-- remote_days / remote_patterns have RLS enabled in 0001 with no committed policy.
-- The rule guard trigger from 0057 stays in force on top of these.
DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['remote_days', 'remote_patterns']
    LOOP
        PERFORM public.drop_all_policies(v_table);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
            'USING (public.is_admin() OR profile_id = public.current_profile_id()) '
            'WITH CHECK (public.is_admin() OR profile_id = public.current_profile_id())',
            'policy_' || v_table || '_own', v_table
        );
    END LOOP;
END;
$$;

-- Employees raise remote amendment and quota requests for themselves; only admins
-- decide them. Both tables were FOR ALL USING (true) with no TO clause, so anon
-- could read and write them.
DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['remote_amendments', 'remote_quota_requests']
    LOOP
        PERFORM public.drop_all_policies(v_table);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
            'USING (public.is_admin() OR profile_id = public.current_profile_id())',
            'policy_' || v_table || '_select', v_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
            'WITH CHECK (public.is_admin() OR profile_id = public.current_profile_id())',
            'policy_' || v_table || '_insert', v_table
        );
        -- Approving or rejecting a request is an admin decision.
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
            'USING (public.is_admin()) WITH CHECK (public.is_admin())',
            'policy_' || v_table || '_decide', v_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
            'USING (public.is_admin())',
            'policy_' || v_table || '_delete', v_table
        );
    END LOOP;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Privilege escalation on user_roles
--
-- policy_user_roles_jit_insert (0004:20) let any authenticated user insert their
-- own role row with ANY role, admin included. guard_admin_role_changes (0023) is
-- BEFORE UPDATE OR DELETE, so INSERT was unguarded. JIT provisioning only ever
-- needs to seed a non-admin role; admin grants go through the service-role path.
--
-- Dropping policy_user_roles_headless_mcp also removes the only SELECT any
-- non-admin had on this table, and auth-context.tsx:377 loads user_roles for
-- everyone, so an explicit own-row read replaces it.
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS policy_user_roles_headless_mcp ON public.user_roles;

DROP POLICY IF EXISTS policy_user_roles_jit_insert ON public.user_roles;
CREATE POLICY policy_user_roles_jit_insert ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id() AND role <> 'admin');

DROP POLICY IF EXISTS policy_user_roles_own_read ON public.user_roles;
CREATE POLICY policy_user_roles_own_read ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.is_admin() OR profile_id = public.current_profile_id());

-- profiles keeps policy_profiles_select (directory reads); only the anon grant goes.
DROP POLICY IF EXISTS policy_profiles_headless_mcp ON public.profiles;

-- ------------------------------------------------------------------------------
-- 6. Column grants
--
-- 0001:406 does GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated and
-- nothing ever revoked it, so the column grants in 0027 narrowed nothing: an
-- employee could rewrite their own status, employment_type, manager_id, team_id,
-- start_date and work_schedule through policy_profiles_self_update. A column
-- grant only restricts after a revoke.
-- ------------------------------------------------------------------------------

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (first_name, last_name, name_el, title, photo_url, phone)
  ON public.profiles TO authenticated;

REVOKE SELECT ON public.employee_integrations FROM authenticated;
GRANT SELECT (
  id, profile_id, provider, external_user_id, status, auto_reply_opt_in,
  auto_reply_template, last_set_status_text, last_set_status_emoji,
  last_set_expiration_ts, connected_at, last_synced_at, revoked_at, created_at
) ON public.employee_integrations TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. Storage
--
-- Both buckets were created public (0006:15, 0011:98). Supabase serves every
-- object in a public bucket from /storage/v1/object/public/<bucket>/<path> with
-- no key and no session, so every invoice PDF and signed contract was readable by
-- anyone on the internet. Their policies also omitted TO, so anon could upload
-- and delete. profile-photos stays public and untouched: it holds nothing
-- sensitive and 0027 already scopes writes to the caller's own folder.
-- ------------------------------------------------------------------------------

UPDATE storage.buckets SET public = false WHERE id IN ('invoices', 'contract-documents');

DROP POLICY IF EXISTS "Enable invoice file uploads" ON storage.objects;
DROP POLICY IF EXISTS "Enable invoice file access" ON storage.objects;
DROP POLICY IF EXISTS "Enable invoice file deletions" ON storage.objects;
DROP POLICY IF EXISTS "Enable contract document uploads" ON storage.objects;
DROP POLICY IF EXISTS "Enable contract document access" ON storage.objects;
DROP POLICY IF EXISTS "Enable contract document modifications" ON storage.objects;
DROP POLICY IF EXISTS "Enable contract document deletions" ON storage.objects;

CREATE POLICY policy_invoice_files_admin ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'invoices' AND public.is_admin())
  WITH CHECK (bucket_id = 'invoices' AND public.is_admin());

CREATE POLICY policy_contract_files_admin ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'contract-documents' AND public.is_admin())
  WITH CHECK (bucket_id = 'contract-documents' AND public.is_admin());

DROP FUNCTION IF EXISTS public.drop_all_policies(TEXT);
