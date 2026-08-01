-- ==============================================================================
-- MIGRATION 0010: FIRST-CLASS COUNTERPARTIES & ATTIO INTEGRATION
-- ==============================================================================
-- 1. Extend counterparties table with VIES, identity, and sync metadata
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS trade_name TEXT;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS vat_valid BOOLEAN DEFAULT TRUE;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS vat_checked_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS registration_number TEXT;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS website_domain TEXT;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' NOT NULL;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT FALSE;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS sync_to_attio BOOLEAN DEFAULT TRUE;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Migrate existing afm to vat_number where applicable
UPDATE counterparties SET vat_number = afm WHERE afm IS NOT NULL AND vat_number IS NULL;

-- 2. Identity & deduplication: Natural key (country, vat_number) where active
CREATE UNIQUE INDEX IF NOT EXISTS idx_counterparties_country_vat 
ON counterparties (country, vat_number) 
WHERE vat_number IS NOT NULL AND status = 'active';

-- 3. Counterparty contacts
CREATE TABLE IF NOT EXISTS counterparty_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    counterparty_id UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT,
    attio_person_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE counterparty_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS policy_counterparty_contacts_all ON counterparty_contacts;
CREATE POLICY policy_counterparty_contacts_all ON counterparty_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Attio Integration: Links, Inbound Events Review Queue, Outbox
CREATE TABLE IF NOT EXISTS attio_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    counterparty_id UUID UNIQUE REFERENCES counterparties(id) ON DELETE CASCADE,
    attio_record_id TEXT UNIQUE NOT NULL,
    attio_object TEXT DEFAULT 'companies',
    link_status TEXT CHECK (link_status IN ('linked', 'pending_review', 'unlinked')) DEFAULT 'linked',
    linked_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ DEFAULT NOW(),
    last_inbound_at TIMESTAMPTZ DEFAULT NOW(),
    last_outbound_at TIMESTAMPTZ DEFAULT NOW(),
    orbit_arr NUMERIC(15,2) DEFAULT 0,
    orbit_active_contracts INTEGER DEFAULT 0,
    orbit_next_renewal DATE
);
ALTER TABLE attio_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS policy_attio_links_all ON attio_links;
CREATE POLICY policy_attio_links_all ON attio_links FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS attio_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attio_event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    status TEXT CHECK (status IN ('processed', 'skipped', 'failed', 'pending_review')) DEFAULT 'pending_review',
    error TEXT
);
ALTER TABLE attio_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS policy_attio_events_all ON attio_events;
CREATE POLICY policy_attio_events_all ON attio_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS attio_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    counterparty_id UUID REFERENCES counterparties(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER DEFAULT 0,
    next_retry_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT CHECK (status IN ('pending', 'processing', 'delivered', 'failed')) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE attio_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS policy_attio_outbox_all ON attio_outbox;
CREATE POLICY policy_attio_outbox_all ON attio_outbox FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Seed & Enrich Counterparties Data
DO $$
DECLARE
    v_cp_depa UUID;
    v_cp_heron UUID;
    v_cp_aws UUID;
    v_cp_powerbot UUID;
    v_cp_volue UUID := gen_random_uuid();
    v_cp_eunice_jv UUID := gen_random_uuid();
    v_admin UUID;
BEGIN
    SELECT id INTO v_admin FROM profiles ORDER BY created_at LIMIT 1;
    SELECT id INTO v_cp_depa FROM counterparties WHERE legal_name LIKE '%DEPA%' LIMIT 1;
    SELECT id INTO v_cp_heron FROM counterparties WHERE legal_name LIKE '%Heron%' LIMIT 1;
    SELECT id INTO v_cp_aws FROM counterparties WHERE legal_name LIKE '%Amazon%' LIMIT 1;
    SELECT id INTO v_cp_powerbot FROM counterparties WHERE legal_name LIKE '%PowerBot%' LIMIT 1;

    -- Update existing seed counterparties with metadata
    IF v_cp_depa IS NOT NULL THEN
        UPDATE counterparties SET trade_name = 'DEPA Commercial', vat_number = 'EL090123891', website_domain = 'depa.gr', sync_to_attio = TRUE WHERE id = v_cp_depa;
        INSERT INTO attio_links (counterparty_id, attio_record_id, link_status, orbit_arr, orbit_active_contracts, orbit_next_renewal)
        VALUES (v_cp_depa, 'attio_rec_01_depa', 'linked', 180000.00, 1, '2026-12-31') ON CONFLICT (counterparty_id) DO NOTHING;
        
        INSERT INTO counterparty_contacts (counterparty_id, name, email, phone, role, attio_person_id)
        VALUES (v_cp_depa, 'Konstantinos Vasileiou', 'k.vasileiou@depa.gr', '+30 210 333 4444', 'VP of Energy Trading & Procurement', 'attio_person_01') ON CONFLICT DO NOTHING;
    END IF;

    IF v_cp_heron IS NOT NULL THEN
        UPDATE counterparties SET trade_name = 'Heron Energy', vat_number = 'EL099881726', website_domain = 'heron.gr', sync_to_attio = TRUE WHERE id = v_cp_heron;
        INSERT INTO attio_links (counterparty_id, attio_record_id, link_status, orbit_arr, orbit_active_contracts, orbit_next_renewal)
        VALUES (v_cp_heron, 'attio_rec_02_heron', 'linked', 120000.00, 1, '2026-09-30') ON CONFLICT (counterparty_id) DO NOTHING;
        
        INSERT INTO counterparty_contacts (counterparty_id, name, email, phone, role, attio_person_id)
        VALUES (v_cp_heron, 'Elvira Alexopoulou', 'e.alexopoulou@heron.gr', '+30 210 555 7777', 'Head of ETRM Operations', 'attio_person_02') ON CONFLICT DO NOTHING;
    END IF;

    IF v_cp_aws IS NOT NULL THEN
        UPDATE counterparties SET trade_name = 'AWS EMEA', vat_number = 'LU26330132', website_domain = 'aws.amazon.com', sync_to_attio = FALSE WHERE id = v_cp_aws;
        -- Supplying entity only, sync_to_attio = FALSE as per best practices in guide
    END IF;

    IF v_cp_powerbot IS NOT NULL THEN
        UPDATE counterparties SET trade_name = 'PowerBot', vat_number = 'DE318920182', website_domain = 'powerbot-trading.com', sync_to_attio = TRUE WHERE id = v_cp_powerbot;
        INSERT INTO attio_links (counterparty_id, attio_record_id, link_status, orbit_arr, orbit_active_contracts, orbit_next_renewal)
        VALUES (v_cp_powerbot, 'attio_rec_04_powerbot', 'linked', 18000.00, 1, '2026-08-31') ON CONFLICT (counterparty_id) DO NOTHING;
    END IF;

    -- Insert Volue AS (Demonstrating derived role BOTH: both Client & Supplier)
    INSERT INTO counterparties (id, legal_name, trade_name, vat_number, country, address, website_domain, status, is_internal, sync_to_attio)
    VALUES (v_cp_volue, 'Volue AS', 'Volue Energy & Market Solutions', 'NO915835947', 'Norway', 'Chr. Kroghs gate 16, Oslo', 'volue.com', 'active', FALSE, TRUE)
    ON CONFLICT DO NOTHING;

    IF EXISTS (SELECT 1 FROM counterparties WHERE id = v_cp_volue) THEN
        INSERT INTO attio_links (counterparty_id, attio_record_id, link_status, orbit_arr, orbit_active_contracts, orbit_next_renewal)
        VALUES (v_cp_volue, 'attio_rec_05_volue', 'linked', 85000.00, 2, '2027-03-31') ON CONFLICT (counterparty_id) DO NOTHING;

        INSERT INTO counterparty_contacts (counterparty_id, name, email, phone, role, attio_person_id)
        VALUES (v_cp_volue, 'Lars Lindqvist', 'lars.lindqvist@volue.com', '+47 22 00 11 22', 'Chief Commercial Officer', 'attio_person_05') ON CONFLICT DO NOTHING;

        -- Insert a revenue deal and a supplier deal for Volue
        INSERT INTO contracts (counterparty_id, direction, reference, type, status, starts_on, ends_on, auto_renews, notice_period_days, value, currency, billing_cadence, vat_treatment, owner_profile_id, product)
        VALUES 
        (v_cp_volue, 'revenue', 'SB-VOLUE-REV-2026', 'saas_subscription', 'active', '2026-04-01', '2027-03-31', TRUE, 60, 120000.00, 'EUR', 'quarterly', 'intra_eu_reverse_charge', v_admin, 'Atlas ETRM API & Algo License'),
        (v_cp_volue, 'cost', 'SB-VOLUE-SUP-2026', 'supplier', 'active', '2026-01-01', '2026-12-31', TRUE, 45, 35000.00, 'EUR', 'annual', 'intra_eu_reverse_charge', v_admin, 'PowerBot Algorithmic Feed Partnership')
        ON CONFLICT DO NOTHING;
    END IF;

    -- Insert Eunice JV (Internal Related Entity)
    INSERT INTO counterparties (id, legal_name, trade_name, vat_number, doy, country, address, website_domain, status, is_internal, sync_to_attio)
    VALUES (v_cp_eunice_jv, 'StellarBlue Eunice JV Single Member P.C.', 'Eunice JV', 'EL801928475', 'FATE Athens', 'Greece', 'Leof. Kifisias 280, Chalandri', 'eunice-energy.com', 'active', TRUE, FALSE)
    ON CONFLICT DO NOTHING;

    -- Seed sample Attio Inbound Webhook Event in Review Queue (Mytileneos created in Attio)
    INSERT INTO attio_events (attio_event_id, event_type, status, payload)
    VALUES (
        'evt_attio_mytilineos_99',
        'record.created',
        'pending_review',
        '{"record_id": "attio_rec_09_mytilineos", "object": "companies", "name": "Mytilineos Energy & Metals S.A.", "domain": "mytilineos.com", "country": "Greece", "vat_guess": "EL094077151", "owner": "Sales Team"}'
    ) ON CONFLICT DO NOTHING;
END $$;
