-- Migration: 0024_counterparty_tiering.sql
-- Description: Configurable counterparty tiering (client & supplier models).
-- Configurable scoring model: metric catalog with weights + bands -> weighted score 0-100
-- -> tier via min_score thresholds (Tier 1 = highest). Versioned config, per-counterparty
-- tier state with explainable breakdowns, full history with causes, and manual overrides.

-- 1. Versioned model configuration (immutable rows; one active per model)
CREATE TABLE IF NOT EXISTS tier_model_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model TEXT NOT NULL CHECK (model IN ('client', 'supplier')),
    tier_count INTEGER NOT NULL CHECK (tier_count BETWEEN 2 AND 10),
    config JSONB NOT NULL,
    created_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    active BOOLEAN DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tier_model_active ON tier_model_versions(model) WHERE active;
CREATE INDEX IF NOT EXISTS idx_tier_model_versions_model ON tier_model_versions(model);

-- 2. Current tier state per counterparty (tier_index NULL = Unrated)
CREATE TABLE IF NOT EXISTS counterparty_tiers (
    counterparty_id UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
    model TEXT NOT NULL CHECK (model IN ('client', 'supplier')),
    tier_index INTEGER NULL,
    tier_count INTEGER NOT NULL,
    score NUMERIC(8,2) NULL,
    breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    model_version_id UUID NULL REFERENCES tier_model_versions(id) ON DELETE SET NULL,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (counterparty_id, model)
);

CREATE INDEX IF NOT EXISTS idx_counterparty_tiers_model_tier ON counterparty_tiers(model, tier_index);
CREATE INDEX IF NOT EXISTS idx_counterparty_tiers_cp ON counterparty_tiers(counterparty_id);

-- 3. Tier history (domain audit log; labels stored as index + count, never a string)
CREATE TABLE IF NOT EXISTS counterparty_tier_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    counterparty_id UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
    model TEXT NOT NULL CHECK (model IN ('client', 'supplier')),
    old_tier_index INTEGER NULL,
    new_tier_index INTEGER NULL,
    old_tier_count INTEGER NULL,
    new_tier_count INTEGER NULL,
    old_score NUMERIC(8,2) NULL,
    new_score NUMERIC(8,2) NULL,
    cause TEXT NOT NULL CHECK (cause IN ('data_change', 'config_change', 'override')),
    model_version_id UUID NULL REFERENCES tier_model_versions(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tier_history_cp ON counterparty_tier_history(counterparty_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tier_history_model ON counterparty_tier_history(model);

-- 4. Manual overrides (pin a tier with mandatory reason + optional expiry; null index clears)
CREATE TABLE IF NOT EXISTS counterparty_tier_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    counterparty_id UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
    model TEXT NOT NULL CHECK (model IN ('client', 'supplier')),
    tier_index INTEGER NULL,
    reason TEXT NOT NULL,
    expires_on DATE NULL,
    created_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tier_overrides_cp ON counterparty_tier_overrides(counterparty_id);

-- 5. Seed the v1 active client model (starter: money now, money committed, relationship depth)
INSERT INTO tier_model_versions (id, model, tier_count, config, active)
VALUES (
    '00000000-0000-4000-8000-00000000c101',
    'client',
    4,
    '{
      "metrics": {
        "active_arr": {
          "enabled": true, "weight": 40,
          "bands": [
            { "min": null, "max": 10000, "points": 0 },
            { "min": 10000, "max": 50000, "points": 40 },
            { "min": 50000, "max": 100000, "points": 70 },
            { "min": 100000, "max": null, "points": 100 }
          ]
        },
        "committed_remaining": {
          "enabled": true, "weight": 30,
          "bands": [
            { "min": null, "max": 25000, "points": 0 },
            { "min": 25000, "max": 100000, "points": 40 },
            { "min": 100000, "max": 250000, "points": 70 },
            { "min": 250000, "max": null, "points": 100 }
          ]
        },
        "tenure_months": {
          "enabled": true, "weight": 15,
          "bands": [
            { "min": null, "max": 3, "points": 0 },
            { "min": 3, "max": 12, "points": 40 },
            { "min": 12, "max": 24, "points": 70 },
            { "min": 24, "max": null, "points": 100 }
          ]
        },
        "product_breadth": {
          "enabled": true, "weight": 15,
          "bands": [
            { "min": null, "max": 1, "points": 40 },
            { "min": 1, "max": 2, "points": 70 },
            { "min": 2, "max": null, "points": 100 }
          ]
        },
        "active_contracts": {
          "enabled": false, "weight": 10,
          "bands": [
            { "min": null, "max": 1, "points": 0 },
            { "min": 1, "max": 3, "points": 50 },
            { "min": 3, "max": null, "points": 100 }
          ]
        },
        "lifetime_invoiced": {
          "enabled": false, "weight": 10,
          "bands": [
            { "min": null, "max": 25000, "points": 0 },
            { "min": 25000, "max": 100000, "points": 40 },
            { "min": 100000, "max": 250000, "points": 70 },
            { "min": 250000, "max": null, "points": 100 }
          ]
        },
        "payment_behavior": {
          "enabled": false, "weight": 20,
          "bands": [
            { "min": null, "max": 0.5, "points": 0 },
            { "min": 0.5, "max": 0.8, "points": 50 },
            { "min": 0.8, "max": null, "points": 100 }
          ]
        },
        "growth_yoy": {
          "enabled": false, "weight": 10,
          "bands": [
            { "min": null, "max": 0, "points": 0 },
            { "min": 0, "max": 0.25, "points": 40 },
            { "min": 0.25, "max": 1, "points": 70 },
            { "min": 1, "max": null, "points": 100 }
          ]
        },
        "avg_contract_term": {
          "enabled": false, "weight": 10,
          "bands": [
            { "min": null, "max": 6, "points": 0 },
            { "min": 6, "max": 12, "points": 40 },
            { "min": 12, "max": 24, "points": 70 },
            { "min": 24, "max": null, "points": 100 }
          ]
        },
        "supplier_spend_annual": {
          "enabled": false, "weight": 40,
          "bands": [
            { "min": null, "max": 10000, "points": 0 },
            { "min": 10000, "max": 50000, "points": 40 },
            { "min": 50000, "max": 100000, "points": 70 },
            { "min": 100000, "max": null, "points": 100 }
          ]
        }
      },
      "tiers": [
        { "min_score": 85, "color": "#0f766e", "description": "Strategic accounts" },
        { "min_score": 65, "color": "#2563eb", "description": "Core recurring clients" },
        { "min_score": 40, "color": "#7c3aed", "description": "Standard accounts" },
        { "min_score": 0, "color": "#64748b", "description": "Long tail" }
      ]
    }'::jsonb,
    true
)
ON CONFLICT DO NOTHING;

-- 6. RLS: tiering is admin-only (counterparties are already an admin-only area)
ALTER TABLE tier_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparty_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparty_tier_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparty_tier_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_tier_models_admin ON tier_model_versions FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY policy_counterparty_tiers_admin ON counterparty_tiers FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY policy_tier_history_admin ON counterparty_tier_history FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY policy_tier_overrides_admin ON counterparty_tier_overrides FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
