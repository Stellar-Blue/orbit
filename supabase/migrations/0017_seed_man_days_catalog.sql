-- Migration: 0017_seed_man_days_catalog.sql
-- Description: Seed the Man-Days Adhoc Work price scheme into Per-Asset & Tiered Optimization Engines module

DO $$
DECLARE
    v_mod_asset UUID;
BEGIN
    SELECT id INTO v_mod_asset FROM catalog_modules WHERE name = 'Per-Asset & Tiered Optimization Engines' LIMIT 1;
    IF v_mod_asset IS NOT NULL THEN
        INSERT INTO catalog_items (module_id, name, default_unit_price, unit_label, default_frequency, active)
        SELECT v_mod_asset, 'Man-Days Adhoc Work', 1200.00, 'man-days', 'monthly', true
        WHERE NOT EXISTS (
            SELECT 1 FROM catalog_items WHERE module_id = v_mod_asset AND name = 'Man-Days Adhoc Work'
        );
    END IF;
END $$;
