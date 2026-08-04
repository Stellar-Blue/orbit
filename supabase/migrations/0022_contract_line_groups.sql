-- Migration: 0022_contract_line_groups.sql
-- Description: Introduce named contract line groups carrying a shared minimum monthly floor.
-- The floor applies to the COMBINED total of the group's line items per month (not per line).

-- 1. Create contract_line_groups table
CREATE TABLE IF NOT EXISTS contract_line_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    min_monthly_charge NUMERIC(14,2) NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_line_groups_contract_id ON contract_line_groups(contract_id);

-- 2. Link contract_lines to a group (floor now lives on the group, not the line)
ALTER TABLE contract_lines
ADD COLUMN IF NOT EXISTS group_id UUID NULL REFERENCES contract_line_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contract_lines_group_id ON contract_lines(group_id);

-- 3. Migrate any existing per-line minimum charges into single-line groups (preserves behavior)
DO $$
DECLARE
    r RECORD;
    v_group_id UUID;
BEGIN
    FOR r IN
        SELECT id, contract_id, name, min_monthly_charge
        FROM contract_lines
        WHERE min_monthly_charge IS NOT NULL AND min_monthly_charge > 0
          AND (group_id IS NULL)
    LOOP
        INSERT INTO contract_line_groups (id, contract_id, name, min_monthly_charge, sort_order)
        VALUES (gen_random_uuid(), r.contract_id, COALESCE(r.name, 'Minimum Floor'), r.min_monthly_charge, 0)
        RETURNING id INTO v_group_id;

        UPDATE contract_lines SET group_id = v_group_id, min_monthly_charge = NULL WHERE id = r.id;
    END LOOP;
END $$;

-- 4. Enable Row Level Security (RLS) with the same access model as contract_lines
ALTER TABLE contract_line_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_contract_line_groups_select ON contract_line_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_contract_line_groups_admin ON contract_line_groups FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
