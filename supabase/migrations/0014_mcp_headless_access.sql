-- ==============================================================================
-- MIGRATION 0014: MCP HEADLESS OPERATOR ACCESS & RLS ALLOWANCE
-- ==============================================================================
-- Ensures machine-to-machine API queries via Bearer OAuth access tokens are not silently rejected
-- by Postgres Row Level Security when executing without human browser session cookies (anon / service_role).
-- Note: Corporate Admin authorization and token expiration are strictly validated in Next.js backend middleware prior to query execution.

-- 1. Counterparty Registry
DROP POLICY IF EXISTS policy_counterparties_headless_mcp ON counterparties;
CREATE POLICY policy_counterparties_headless_mcp ON counterparties FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- 2. Commercial Contracts & Schedules
DROP POLICY IF EXISTS policy_contracts_headless_mcp ON contracts;
CREATE POLICY policy_contracts_headless_mcp ON contracts FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS policy_contract_schedule_headless_mcp ON contract_schedule;
CREATE POLICY policy_contract_schedule_headless_mcp ON contract_schedule FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- 3. Invoices & Financial Archives
DROP POLICY IF EXISTS policy_invoices_headless_mcp ON invoices;
CREATE POLICY policy_invoices_headless_mcp ON invoices FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS policy_invoice_documents_headless_mcp ON invoice_documents;
CREATE POLICY policy_invoice_documents_headless_mcp ON invoice_documents FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS policy_invoice_payments_headless_mcp ON invoice_payments;
CREATE POLICY policy_invoice_payments_headless_mcp ON invoice_payments FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS policy_invoice_allocations_headless_mcp ON invoice_allocations;
CREATE POLICY policy_invoice_allocations_headless_mcp ON invoice_allocations FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS policy_invoice_categories_headless_mcp ON invoice_categories;
CREATE POLICY policy_invoice_categories_headless_mcp ON invoice_categories FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- 4. MCP Infrastructure & OAuth Token Registries
DROP POLICY IF EXISTS policy_mcp_idempotency_headless_mcp ON mcp_idempotency;
CREATE POLICY policy_mcp_idempotency_headless_mcp ON mcp_idempotency FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS policy_mcp_tool_calls_headless_mcp ON mcp_tool_calls;
CREATE POLICY policy_mcp_tool_calls_headless_mcp ON mcp_tool_calls FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS policy_mcp_oauth_codes_headless_mcp ON mcp_oauth_codes;
CREATE POLICY policy_mcp_oauth_codes_headless_mcp ON mcp_oauth_codes FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS policy_mcp_oauth_tokens_headless_mcp ON mcp_oauth_tokens;
CREATE POLICY policy_mcp_oauth_tokens_headless_mcp ON mcp_oauth_tokens FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- 5. Profiles & User Roles (Role Checking for Bearer token validation)
DROP POLICY IF EXISTS policy_profiles_headless_mcp ON profiles;
CREATE POLICY policy_profiles_headless_mcp ON profiles FOR SELECT TO anon, authenticated, service_role USING (true);

DROP POLICY IF EXISTS policy_user_roles_headless_mcp ON user_roles;
CREATE POLICY policy_user_roles_headless_mcp ON user_roles FOR SELECT TO anon, authenticated, service_role USING (true);
