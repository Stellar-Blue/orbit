-- Migration: 0009_modular_pricing_schema_and_seed.sql
-- Description: Implement Modular Contract Pricing (Version 1) schema, RLS policies, and seed Atlas ETRM rate sheet catalog.

-- 1. Extend contracts table with terms and discounting
ALTER TABLE contracts
ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS term_years INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS service_start_date DATE NULL;

-- 2. Create catalog_modules table
CREATE TABLE IF NOT EXISTS catalog_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create catalog_items table
CREATE TABLE IF NOT EXISTS catalog_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES catalog_modules(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    default_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    unit_label TEXT NOT NULL DEFAULT 'unit',
    default_frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (default_frequency IN ('monthly', 'quarterly', 'annual', 'one_time')),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create contract_lines table (stores copied snapshot values per Section 6)
CREATE TABLE IF NOT EXISTS contract_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    catalog_item_id UUID NULL REFERENCES catalog_items(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    unit_price NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    quantity NUMERIC(14,2) NOT NULL DEFAULT 1.00,
    unit_label TEXT NOT NULL DEFAULT 'unit',
    frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'annual', 'one_time')),
    note TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create contract_schedule table (month-by-month revenue schedule)
CREATE TABLE IF NOT EXISTS contract_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    period TEXT NOT NULL, -- Format YYYY-MM
    amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_contract_period UNIQUE (contract_id, period)
);

CREATE INDEX IF NOT EXISTS idx_contract_schedule_period ON contract_schedule(period);
CREATE INDEX IF NOT EXISTS idx_contract_lines_contract_id ON contract_lines(contract_id);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE catalog_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_schedule ENABLE ROW LEVEL SECURITY;

-- RLS Policies for catalog_modules & catalog_items
CREATE POLICY policy_catalog_modules_select ON catalog_modules FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_catalog_modules_admin ON catalog_modules FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY policy_catalog_items_select ON catalog_items FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_catalog_items_admin ON catalog_items FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- RLS Policies for contract_lines & contract_schedule (aligning with contracts read/admin edit access)
CREATE POLICY policy_contract_lines_select ON contract_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_contract_lines_admin ON contract_lines FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY policy_contract_schedule_select ON contract_schedule FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_contract_schedule_admin ON contract_schedule FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- 7. Seed the Atlas ETRM modular catalog rate sheet
DO $$
DECLARE
    v_mod_flat UUID := gen_random_uuid();
    v_mod_asset UUID := gen_random_uuid();
    v_mod_services UUID := gen_random_uuid();
BEGIN
    -- Insert Modules
    INSERT INTO catalog_modules (id, name, sort_order, active) VALUES
    (v_mod_flat, 'Flat ETRM Modules & Subscriptions', 10, true),
    (v_mod_asset, 'Per-Asset & Tiered Optimization Engines', 20, true),
    (v_mod_services, 'Professional Services & On-boarding', 30, true);

    -- Insert Items for Flat Modules (Summing to exactly €11,850.00/mo at qty=1 for verification)
    INSERT INTO catalog_items (module_id, name, default_unit_price, unit_label, default_frequency, active) VALUES
    (v_mod_flat, 'Core ETRM Platform License', 5000.00, 'flat', 'monthly', true),
    (v_mod_flat, 'Invoice Generation & Billing', 1000.00, 'flat', 'monthly', true),
    (v_mod_flat, 'Trading Desk Integration Engine', 2000.00, 'flat', 'monthly', true),
    (v_mod_flat, 'Risk Management & VaR Suite', 1500.00, 'flat', 'monthly', true),
    (v_mod_flat, 'Regulatory Reporting (REMIT/EMIR)', 1200.00, 'flat', 'monthly', true),
    (v_mod_flat, 'Automated Settlement Reconciliation', 650.00, 'flat', 'monthly', true),
    (v_mod_flat, 'DAM Forecasting', 500.00, 'zone', 'monthly', true);

    -- Insert Items for Per-Asset & Tiered Engines (Summing to exactly €28,100.00/mo at standard test set quantities)
    INSERT INTO catalog_items (module_id, name, default_unit_price, unit_label, default_frequency, active) VALUES
    (v_mod_asset, 'PV Park Optimization (per MW)', 5.00, 'MW', 'monthly', true),
    (v_mod_asset, 'PV dispatch 1–50 band', 30.00, 'assets', 'monthly', true),
    (v_mod_asset, 'PV dispatch 50–200 band', 20.00, 'assets', 'monthly', true),
    (v_mod_asset, 'PV Production Forecasting (per MW)', 3.00, 'MW', 'monthly', true),
    (v_mod_asset, 'PV Production Forecasting (per asset)', 10.00, 'assets', 'monthly', true),
    (v_mod_asset, 'Wind Park Optimization (per MW)', 6.00, 'MW', 'monthly', true),
    (v_mod_asset, 'Battery (BESS) Dispatch Engine (per MW)', 15.00, 'MW', 'monthly', true),
    (v_mod_asset, 'Algorithmic Intraday Trading (per MWh/h)', 28.00, 'MWh/h', 'monthly', true);

    -- Insert Items for One-time Professional Services
    INSERT INTO catalog_items (module_id, name, default_unit_price, unit_label, default_frequency, active) VALUES
    (v_mod_services, 'Implementation & Configuration Setup', 20000.00, 'project', 'one_time', true),
    (v_mod_services, 'Dedicated Training & Workshop Days', 1200.00, 'day', 'one_time', true),
    (v_mod_services, 'Custom API Integration Services', 1500.00, 'day', 'one_time', true);
END $$;
