-- ==============================================================================
-- 0005_remote_policies_settings.sql
-- Configure company settings table for remote policies with dynamic period types
-- ==============================================================================

ALTER TABLE remote_policies 
  ADD COLUMN IF NOT EXISTS max_days INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS period_type TEXT NOT NULL DEFAULT 'month' CHECK (period_type IN ('week', 'month', 'quarter', 'year'));

-- Ensure RLS policies exist for remote_policies
DROP POLICY IF EXISTS policy_remote_policies_read ON remote_policies;
DROP POLICY IF EXISTS policy_remote_policies_admin ON remote_policies;
DROP POLICY IF EXISTS policy_remote_policies_all ON remote_policies;
DROP POLICY IF EXISTS policy_remote_policies_select ON remote_policies;
DROP POLICY IF EXISTS policy_remote_policies_modify ON remote_policies;

CREATE POLICY policy_remote_policies_select ON remote_policies FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_remote_policies_modify ON remote_policies FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed initial company-wide policy record if none exists
INSERT INTO remote_policies (id, scope_type, scope_id, max_days_per_month, max_days, period_type)
SELECT gen_random_uuid(), 'company', NULL, 8, 8, 'month'
WHERE NOT EXISTS (SELECT 1 FROM remote_policies WHERE scope_type = 'company');
