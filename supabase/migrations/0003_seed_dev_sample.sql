-- ==============================================================================
-- 0003_seed_dev_sample.sql
-- Development Sample Seed Data: 11 Fictional Employees, Teams, Contracts & Ledger
-- ONLY INTENDED FOR DEV/STAGING TESTING. NEVER APPLY TO REAL PRODUCTION DATABASE.
-- ==============================================================================

DO $$
DECLARE
    v_team_etrm UUID := gen_random_uuid();
    v_team_ems UUID := gen_random_uuid();
    v_team_cons UUID := gen_random_uuid();
    v_team_ops UUID := gen_random_uuid();

    -- Employee Profile UUIDs
    v_eleni UUID := gen_random_uuid();   -- Founder / Admin (Ops / Leadership)
    v_nikos UUID := gen_random_uuid();   -- Founder / Admin (ETRM Lead)
    v_dimitris UUID := gen_random_uuid(); -- Senior ETRM Eng (full_time)
    v_maria UUID := gen_random_uuid();    -- EMS Product Manager (full_time)
    v_yannis UUID := gen_random_uuid();   -- Senior EMS Dev (full_time)
    v_katerina UUID := gen_random_uuid(); -- Consulting Analyst (part_time Mon/Wed/Fri)
    v_giorgis UUID := gen_random_uuid();  -- ETRM Backend Dev (full_time)
    v_sofia UUID := gen_random_uuid();    -- UI/UX Design Contractor (contractor)
    v_kostas UUID := gen_random_uuid();   -- Data Engineering Contractor (contractor)
    v_alexandra UUID := gen_random_uuid();-- EMS Frontend Eng (full_time)
    v_petros UUID := gen_random_uuid();   -- Quantitative Intern (intern)

    -- Counterparty UUIDs
    v_client_depa UUID := gen_random_uuid();
    v_client_heron UUID := gen_random_uuid();
    v_supplier_aws UUID := gen_random_uuid();
    v_supplier_powerbot UUID := gen_random_uuid();

    -- Payment Type IDs
    v_pt_salary UUID;
    v_pt_contractor UUID;
    v_lt_annual UUID;
    v_lt_sick UUID;
    v_mandatory_leave UUID := gen_random_uuid();

BEGIN
    SELECT id INTO v_pt_salary FROM payment_types WHERE code = 'salary' LIMIT 1;
    SELECT id INTO v_pt_contractor FROM payment_types WHERE code = 'contractor_invoice' LIMIT 1;
    SELECT id INTO v_lt_annual FROM leave_types WHERE code = 'annual' LIMIT 1;
    SELECT id INTO v_lt_sick FROM leave_types WHERE code = 'sick' LIMIT 1;

    -- 1. Insert Teams (with NULL lead initially to prevent FK circular dependency)
    INSERT INTO teams (id, name, lead_profile_id) VALUES
    (v_team_etrm, 'Atlas ETRM Engineering', NULL),
    (v_team_ems, 'EMS & Bidding Optimizer', NULL),
    (v_team_cons, 'Energy Consulting', NULL),
    (v_team_ops, 'Operations & Leadership', NULL);

    -- 2. Insert Profiles (11 Fictional Staff)
    INSERT INTO profiles (id, auth_user_id, first_name, last_name, name_el, work_email, title, team_id, manager_id, employment_type, start_date, status, work_schedule) VALUES
    (v_eleni, gen_random_uuid(), 'Eleni', 'Founta', 'Ελένη Φούντα', 'eleni.founta@stellarblue.gr', 'Co-Founder & Chief Operations Officer', v_team_ops, NULL, 'full_time', '2023-01-10', 'active', ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]),
    (v_nikos, gen_random_uuid(), 'Nikos', 'Vassiliou', 'Νίκος Βασιλείου', 'nikos.vassiliou@stellarblue.gr', 'Co-Founder & Chief Technology Officer', v_team_etrm, NULL, 'full_time', '2023-01-10', 'active', ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]),
    (v_dimitris, gen_random_uuid(), 'Dimitris', 'Papadopoulos', 'Δημήτρης Παπαδόπουλος', 'dimitris.papadopoulos@stellarblue.gr', 'Principal ETRM Architect', v_team_etrm, v_nikos, 'full_time', '2023-03-01', 'active', ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]),
    (v_maria, gen_random_uuid(), 'Maria', 'Konstantinidou', 'Μαρία Κωνσταντινίδου', 'maria.konstantinidou@stellarblue.gr', 'EMS Lead Product Manager', v_team_ems, v_eleni, 'full_time', '2023-06-15', 'active', ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]),
    (v_yannis, gen_random_uuid(), 'Yannis', 'Anagnostou', 'Γιάννης Αναγνώστου', 'yannis.anagnostou@stellarblue.gr', 'Senior Optimization Engineer', v_team_ems, v_maria, 'full_time', '2023-09-01', 'active', ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]),
    (v_katerina, gen_random_uuid(), 'Katerina', 'Lymperis', 'Κατερίνα Λυμπέρη', 'katerina.lymperis@stellarblue.gr', 'Senior Energy Markets Analyst', v_team_cons, v_eleni, 'part_time', '2024-01-08', 'active', ARRAY['Mon','Wed','Fri']::TEXT[]),
    (v_giorgis, gen_random_uuid(), 'Giorgis', 'Makris', 'Γιώργος Μακρής', 'giorgis.makris@stellarblue.gr', 'Backend Software Engineer', v_team_etrm, v_dimitris, 'full_time', '2024-02-12', 'active', ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]),
    (v_sofia, gen_random_uuid(), 'Sofia', 'Stamatiadou', 'Σοφία Σταματιάδου', 'sofia.stamatiadou@stellarblue.gr', 'Product UI/UX Lead (Contractor)', v_team_ops, v_eleni, 'contractor', '2024-03-01', 'active', ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]),
    (v_kostas, gen_random_uuid(), 'Kostas', 'Panagiotou', 'Κώστας Παναγιώτου', 'kostas.panagiotou@stellarblue.gr', 'Data Systems Architect (Contractor)', v_team_etrm, v_nikos, 'contractor', '2024-04-15', 'active', ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]),
    (v_alexandra, gen_random_uuid(), 'Alexandra', 'Vlachou', 'Αλεξάνδρα Βλάχου', 'alexandra.vlachou@stellarblue.gr', 'Frontend Systems Engineer', v_team_ems, v_maria, 'full_time', '2024-05-20', 'active', ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]),
    (v_petros, gen_random_uuid(), 'Petros', 'Samanidis', 'Πέτρος Σαμανίδης', 'petros.samanidis@stellarblue.gr', 'Quantitative Algorithms Intern', v_team_ems, v_yannis, 'intern', '2025-01-15', 'active', ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]);

    -- 2b. Update Teams with their lead_profile_id now that profiles exist
    UPDATE teams SET lead_profile_id = v_nikos WHERE id = v_team_etrm;
    UPDATE teams SET lead_profile_id = v_maria WHERE id = v_team_ems;
    UPDATE teams SET lead_profile_id = v_eleni WHERE id = v_team_cons;
    UPDATE teams SET lead_profile_id = v_eleni WHERE id = v_team_ops;

    -- 3. Assign User Roles (Founders get Admin)
    INSERT INTO user_roles (profile_id, role) VALUES
    (v_eleni, 'admin'),
    (v_eleni, 'employee'),
    (v_nikos, 'admin'),
    (v_nikos, 'employee'),
    (v_dimitris, 'employee'),
    (v_maria, 'employee'),
    (v_yannis, 'employee'),
    (v_katerina, 'employee'),
    (v_giorgis, 'employee'),
    (v_sofia, 'employee'),
    (v_kostas, 'employee'),
    (v_alexandra, 'employee'),
    (v_petros, 'employee');

    -- 4. Insert Sensitive PII Data (Admin Only)
    INSERT INTO profile_sensitive (profile_id, afm, amka, iban, address, birth_date) VALUES
    (v_eleni, '108938291', '12048501928', 'GR1201100000000012345678901', 'Tsimiski 45, Thessaloniki 54623', '1985-04-12'),
    (v_nikos, '098231920', '08098202931', 'GR8801400000000023456789012', 'Mitropoleos 12, Thessaloniki 54624', '1982-09-08'),
    (v_dimitris, '138940291', '11028803921', 'GR4401700000000034567890123', 'Vasilissis Olgas 120, Thessaloniki 54645', '1988-02-11');

    -- 5. Salary History & Payments (Sample Ledger)
    INSERT INTO salary_history (profile_id, valid_from, valid_to, basis, gross_amount, employer_cost_pct, note) VALUES
    (v_eleni, '2026-01-01', NULL, 'monthly_gross', 5200.00, 22.29, '2026 Founder review'),
    (v_nikos, '2026-01-01', NULL, 'monthly_gross', 5200.00, 22.29, '2026 Founder review'),
    (v_dimitris, '2026-01-01', NULL, 'monthly_gross', 4100.00, 22.29, 'Senior ETRM Architect scale'),
    (v_maria, '2026-01-01', NULL, 'monthly_gross', 3900.00, 22.29, 'EMS PM scale'),
    (v_yannis, '2026-01-01', NULL, 'monthly_gross', 3600.00, 22.29, 'Optimization Eng scale'),
    (v_katerina, '2026-01-01', NULL, 'monthly_gross', 2200.00, 22.29, 'Part-time analyst scale'),
    (v_giorgis, '2026-01-01', NULL, 'monthly_gross', 2800.00, 22.29, 'Backend Eng scale'),
    (v_sofia, '2026-01-01', NULL, 'fixed_fee', 3500.00, NULL, 'Monthly contractor retainer (excl VAT)'),
    (v_kostas, '2026-01-01', NULL, 'fixed_fee', 4200.00, NULL, 'Monthly architecture retainer (excl VAT)'),
    (v_alexandra, '2026-01-01', NULL, 'monthly_gross', 2700.00, 22.29, 'Frontend Eng scale'),
    (v_petros, '2026-01-01', NULL, 'monthly_gross', 1100.00, 22.29, 'Internship stipend');

    -- Add a couple paid payments for July 2026
    IF v_pt_salary IS NOT NULL THEN
        INSERT INTO payments (profile_id, period, payment_type_id, gross, net, employer_contributions, total_cost, payment_date, status) VALUES
        (v_eleni, '2026-07', v_pt_salary, 5200.00, 3650.00, 1159.08, 6359.08, '2026-07-28', 'paid'),
        (v_nikos, '2026-07', v_pt_salary, 5200.00, 3650.00, 1159.08, 6359.08, '2026-07-28', 'paid'),
        (v_dimitris, '2026-07', v_pt_salary, 4100.00, 2880.00, 913.89, 5013.89, '2026-07-28', 'paid');
    END IF;

    -- 6. Leave Entitlements (2026) & Sample Requests
    INSERT INTO leave_entitlements (profile_id, year, entitlement_days, carried_over_days) VALUES
    (v_eleni, 2026, 22, 2),
    (v_nikos, 2026, 22, 0),
    (v_dimitris, 2026, 22, 3),
    (v_maria, 2026, 20, 1),
    (v_yannis, 2026, 20, 0),
    (v_katerina, 2026, 12, 0), -- prorated part-time
    (v_giorgis, 2026, 20, 2),
    (v_alexandra, 2026, 20, 0),
    (v_petros, 2026, 10, 0);

    IF v_lt_annual IS NOT NULL THEN
        INSERT INTO leave_requests (profile_id, leave_type_id, start_date, end_date, working_days, status, note, ergani_status) VALUES
        (v_dimitris, v_lt_annual, '2026-08-03', '2026-08-14', 10, 'approved', 'Summer holidays in Halkidiki', 'submitted'),
        (v_maria, v_lt_annual, '2026-08-10', '2026-08-21', 9, 'approved', 'August break (15th is public holiday)', 'pending'),
        (v_giorgis, v_lt_annual, '2026-09-07', '2026-09-11', 5, 'pending', 'Early September break', 'not_required');
    END IF;

    -- 7. Sample Mandatory Leave (Christmas Closure 2026)
    IF v_lt_annual IS NOT NULL THEN
        INSERT INTO mandatory_leaves (id, name, leave_type_id, start_date, end_date, status, created_by, note) VALUES
        (v_mandatory_leave, 'Christmas & New Year Closure 2026', v_lt_annual, '2026-12-28', '2026-12-31', 'published', v_eleni, 'Company-wide holiday closure between Christmas and New Year.');
        
        -- Fan-out rows for eligible staff (working days = 4)
        INSERT INTO leave_requests (profile_id, leave_type_id, start_date, end_date, working_days, status, origin, mandatory_leave_id, note, ergani_status) VALUES
        (v_dimitris, v_lt_annual, '2026-12-28', '2026-12-31', 4, 'approved', 'mandatory', v_mandatory_leave, 'Company-wide closure', 'not_required'),
        (v_yannis, v_lt_annual, '2026-12-28', '2026-12-31', 4, 'approved', 'mandatory', v_mandatory_leave, 'Company-wide closure', 'not_required');
    END IF;

    -- 8. Client & Supplier Contracts
    INSERT INTO counterparties (id, legal_name, afm, doy, country, address) VALUES
    (v_client_depa, 'DEPA Commercial S.A.', '090123891', 'FATE Athens', 'Greece', 'Marinadou 92, Athens'),
    (v_client_heron, 'Heron Energy S.A.', '099881726', 'FATE Athens', 'Greece', 'Kifissias 120, Athens'),
    (v_supplier_aws, 'Amazon Web Services EMEA SARL', 'LU26330132', 'Luxembourg', 'Luxembourg', '38 Avenue John F. Kennedy'),
    (v_supplier_powerbot, 'PowerBot GmbH', 'DE318920182', 'Munich', 'Germany', 'Karlstrasse 45, Munich');

    INSERT INTO contracts (counterparty_id, direction, reference, type, status, starts_on, ends_on, auto_renews, notice_period_days, value, currency, billing_cadence, vat_treatment, owner_profile_id, product) VALUES
    (v_client_depa, 'revenue', 'SB-ATLAS-2025-01', 'saas_subscription', 'active', '2025-01-01', '2026-12-31', TRUE, 60, 180000.00, 'EUR', 'annual', 'domestic_24', v_nikos, 'Atlas ETRM'),
    (v_client_heron, 'revenue', 'SB-EMS-2025-04', 'saas_subscription', 'active', '2025-04-01', '2026-09-30', TRUE, 60, 120000.00, 'EUR', 'quarterly', 'domestic_24', v_maria, 'EMS & Bidding Optimizer'),
    (v_supplier_aws, 'cost', 'SUP-AWS-2026', 'supplier', 'active', '2026-01-01', '2026-12-31', TRUE, 30, 24000.00, 'EUR', 'monthly', 'intra_eu_reverse_charge', v_nikos, 'Cloud Infrastructure'),
    (v_supplier_powerbot, 'cost', 'SUP-PBOT-2025', 'supplier', 'expiring', '2025-09-01', '2026-08-31', TRUE, 45, 18000.00, 'EUR', 'annual', 'intra_eu_reverse_charge', v_maria, 'Algorithm Partner Feed');

END $$;
