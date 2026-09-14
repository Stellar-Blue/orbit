-- ==============================================================================
-- 0068: turn on Realtime for the tables the UI shows.
--
-- The grid sync uses `postgres_changes` over the Realtime WebSocket: when a row changes, every
-- connected client reloads the slice that row belongs to. Nothing was published before this
-- (`supabase_realtime` was empty), so the invoices subscription that existed in auth-context
-- never actually fired.
--
-- Two things are needed per table:
--   1. membership in the `supabase_realtime` publication  → the WAL is streamed to clients;
--   2. REPLICA IDENTITY FULL → UPDATE/DELETE payloads carry the whole old row, which the
--      Realtime authorization layer needs to evaluate the RLS policy of each subscriber.
--      Without it those events can be dropped for RLS-protected tables.
--
-- Delivery itself still obeys RLS — publishing a table does not hand anyone extra rows.
-- `mcp_oauth_tokens`, `mcp_idempotency` and `mcp_tool_calls` are deliberately left unpublished:
-- they are MCP internals, not UI state.
-- ==============================================================================

DO $$
DECLARE
    v_table TEXT;
    v_tables TEXT[] := ARRAY[
        -- people & access
        'profiles', 'user_roles', 'profile_sensitive', 'profile_role_history', 'teams',
        'job_roles', 'seniority_levels',
        -- pay & leave
        'salary_history', 'payments', 'payment_types', 'payment_document_types',
        'employee_contracts', 'leave_types', 'leave_requests', 'leave_entitlements',
        'mandatory_leaves', 'public_holidays', 'leave_policy',
        -- remote work
        'remote_days', 'remote_patterns', 'remote_policies', 'remote_amendments',
        'remote_quota_requests',
        -- time & delivery
        'contract_timesheets', 'time_entries', 'timesheet_periods',
        'projects', 'work_items', 'project_assignments', 'project_role_forecasts',
        'rate_cards', 'rate_card_entries',
        -- commercial
        'counterparties', 'counterparty_contacts', 'counterparty_roles',
        'counterparty_tiers', 'counterparty_tier_history', 'counterparty_tier_overrides',
        'tier_model_versions', 'roles', 'attio_links', 'attio_events',
        'contracts', 'contract_lines', 'contract_line_groups', 'contract_schedule',
        'catalog_modules', 'catalog_items',
        -- invoicing & budgeting
        'invoice_categories', 'invoice_documents', 'invoice_payments', 'invoice_allocations',
        'invoice_links', 'invoices',
        'budgets', 'budget_lines', 'budget_categories', 'recurring_commitments',
        -- settings & integrations
        'integration_settings', 'integration_exemptions', 'employee_integrations',
        'company_profile'
    ];
BEGIN
    FOREACH v_table IN ARRAY v_tables
    LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE NOTICE 'Skipping %: table does not exist', v_table;
            CONTINUE;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
        END IF;

        EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_table);
    END LOOP;
END;
$$;
