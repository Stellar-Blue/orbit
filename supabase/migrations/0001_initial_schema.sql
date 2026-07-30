-- ==============================================================================
-- 0001_initial_schema.sql
-- StellarBlue Internal Tool (Orbit) - Core Schema, RLS Policies & Audit Triggers
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TEAMS & PROFILES
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    lead_profile_id UUID NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    name_el TEXT NOT NULL,
    work_email TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    manager_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    employment_type TEXT NOT NULL CHECK (employment_type IN ('full_time', 'part_time', 'contractor', 'intern')),
    start_date DATE NOT NULL,
    end_date DATE NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'departed')),
    photo_url TEXT NULL,
    work_schedule TEXT[] NOT NULL DEFAULT ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri']::TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE teams ADD CONSTRAINT fk_team_lead FOREIGN KEY (lead_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS profile_sensitive (
    profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    afm TEXT NULL,
    amka TEXT NULL,
    ama_efka TEXT NULL,
    iban TEXT NULL,
    address TEXT NULL,
    birth_date DATE NULL,
    id_number TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('employee', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_role UNIQUE(profile_id, role)
);

-- 2. COMPENSATION & PAYMENT LEDGER (Dynamic Payment Types)
CREATE TABLE IF NOT EXISTS payment_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name_el TEXT NOT NULL,
    name_en TEXT NOT NULL,
    is_statutory BOOLEAN NOT NULL DEFAULT FALSE,
    is_recurring_monthly BOOLEAN NOT NULL DEFAULT TRUE,
    default_period_month INTEGER NULL CHECK (default_period_month BETWEEN 1 AND 12),
    default_multiplier NUMERIC NULL,
    applies_to TEXT[] NOT NULL DEFAULT ARRAY['full_time', 'part_time', 'contractor', 'intern']::TEXT[],
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salary_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    valid_from DATE NOT NULL,
    valid_to DATE NULL,
    basis TEXT NOT NULL CHECK (basis IN ('monthly_gross', 'daily_rate', 'fixed_fee')),
    gross_amount NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    employer_cost_pct NUMERIC NULL,
    note TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    period TEXT NOT NULL, -- Format: YYYY-MM
    payment_type_id UUID NOT NULL REFERENCES payment_types(id),
    gross NUMERIC NOT NULL DEFAULT 0,
    net NUMERIC NOT NULL DEFAULT 0,
    employer_contributions NUMERIC NOT NULL DEFAULT 0,
    total_cost NUMERIC NOT NULL DEFAULT 0,
    payment_date DATE NOT NULL,
    bank_reference TEXT NULL,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'paid', 'cancelled')),
    note TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Unique constraint preventing duplicate payment type per period unless cancelled
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_active_payment ON payments(profile_id, period, payment_type_id) WHERE status != 'cancelled';

-- 3. LEAVE & MANDATORY LEAVES
CREATE TABLE IF NOT EXISTS leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name_en TEXT NOT NULL,
    name_el TEXT NOT NULL,
    counts_against_balance BOOLEAN NOT NULL DEFAULT TRUE,
    requires_document BOOLEAN NOT NULL DEFAULT FALSE,
    requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    colour TEXT NOT NULL DEFAULT '#3b82f6',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    entitlement_days NUMERIC NOT NULL DEFAULT 20,
    carried_over_days NUMERIC NOT NULL DEFAULT 0,
    carryover_expires_on DATE NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_profile_year UNIQUE(profile_id, year)
);

CREATE TABLE IF NOT EXISTS mandatory_leaves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
    created_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    note TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    half_day_start BOOLEAN NOT NULL DEFAULT FALSE,
    half_day_end BOOLEAN NOT NULL DEFAULT FALSE,
    working_days NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    origin TEXT NOT NULL DEFAULT 'employee_request' CHECK (origin IN ('employee_request', 'mandatory', 'admin_entry')),
    mandatory_leave_id UUID NULL REFERENCES mandatory_leaves(id) ON DELETE CASCADE,
    note TEXT NULL,
    document_url TEXT NULL,
    decided_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ NULL,
    ergani_status TEXT NOT NULL DEFAULT 'not_required' CHECK (ergani_status IN ('not_required', 'pending', 'submitted')),
    ergani_submitted_at DATE NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_profile ON leave_requests(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_mandatory ON leave_requests(mandatory_leave_id);

CREATE TABLE IF NOT EXISTS public_holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    name_el TEXT NOT NULL,
    name_en TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'national' CHECK (scope IN ('national', 'thessaloniki')),
    year INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_holiday_date_scope UNIQUE(date, scope)
);

-- 4. REMOTE WORK
CREATE TABLE IF NOT EXISTS remote_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('office', 'remote_gr', 'remote_abroad')),
    location TEXT NULL, -- Mandatory in frontend validation when mode == 'remote_abroad'
    note TEXT NULL,
    ergani_status TEXT NOT NULL DEFAULT 'pending' CHECK (ergani_status IN ('not_required', 'pending', 'submitted')),
    ergani_submitted_at DATE NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_profile_remote_date UNIQUE(profile_id, date)
);

CREATE TABLE IF NOT EXISTS remote_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    weekday TEXT NOT NULL CHECK (weekday IN ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
    mode TEXT NOT NULL CHECK (mode IN ('office', 'remote_gr', 'remote_abroad')),
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to DATE NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_profile_pattern_day UNIQUE(profile_id, weekday)
);

CREATE TABLE IF NOT EXISTS remote_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type TEXT NOT NULL CHECK (scope_type IN ('company', 'team', 'employee')),
    scope_id UUID NULL,
    max_days_per_month INTEGER NOT NULL DEFAULT 8,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CONTRACT MANAGEMENT
CREATE TABLE IF NOT EXISTS counterparties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name TEXT NOT NULL,
    afm TEXT NULL,
    doy TEXT NULL,
    country TEXT NOT NULL DEFAULT 'Greece',
    address TEXT NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    counterparty_id UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NULL,
    phone TEXT NULL,
    role TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    counterparty_id UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('revenue', 'cost')),
    reference TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('saas_subscription', 'licence', 'professional_services', 'pilot', 'nda', 'dpa', 'framework', 'jv_agreement', 'supplier')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_negotiation', 'active', 'expiring', 'expired', 'terminated')),
    signed_on DATE NULL,
    starts_on DATE NOT NULL,
    ends_on DATE NULL,
    auto_renews BOOLEAN NOT NULL DEFAULT FALSE,
    renewal_term_months INTEGER NULL,
    notice_period_days INTEGER NOT NULL DEFAULT 30,
    notice_deadline DATE GENERATED ALWAYS AS (
        ends_on - notice_period_days
    ) STORED,
    value NUMERIC NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    billing_cadence TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cadence IN ('monthly', 'quarterly', 'annual', 'milestone', 'one_off')),
    vat_treatment TEXT NOT NULL DEFAULT 'domestic_24' CHECK (vat_treatment IN ('domestic_24', 'intra_eu_reverse_charge', 'non_eu')),
    owner_profile_id UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    product TEXT NULL,
    parent_contract_id UUID NULL REFERENCES contracts(id) ON DELETE SET NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_notice_deadline ON contracts(notice_deadline) WHERE status IN ('active', 'expiring');

CREATE TABLE IF NOT EXISTS contract_clauses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    clause_key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    doc_type TEXT NOT NULL DEFAULT 'contract',
    signed BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ΕΡΓΑΝΗ RECONCILIATION (Schema Ready)
CREATE TABLE IF NOT EXISTS ergani_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    file_path TEXT NOT NULL,
    period TEXT NOT NULL,
    form_type TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    matched_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ergani_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID NOT NULL REFERENCES ergani_imports(id) ON DELETE CASCADE,
    afm TEXT NOT NULL,
    form_type TEXT NOT NULL,
    date_from DATE NULL,
    date_to DATE NULL,
    filing_reference TEXT NULL,
    raw JSONB NULL,
    match_status TEXT NOT NULL DEFAULT 'pending',
    matched_leave_id UUID NULL REFERENCES leave_requests(id) ON DELETE SET NULL,
    matched_remote_id UUID NULL REFERENCES remote_days(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ergani_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID NOT NULL REFERENCES ergani_imports(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    internal_ref TEXT NULL,
    ergani_record_id UUID NULL REFERENCES ergani_records(id) ON DELETE CASCADE,
    resolved_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ NULL,
    note TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. AUDIT LOG & NOTIFICATIONS
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_profile_id UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_id UUID NULL,
    before_data JSONB NULL,
    after_data JSONB NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL,
    read_at TIMESTAMPTZ NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_profile ON notifications(profile_id, read_at);

-- ==============================================================================
-- 8. AUTOMATED AUDIT TRIGGERS (PostgreSQL Trigger logic for high-sensitivity data)
-- ==============================================================================
CREATE OR REPLACE FUNCTION audit_trigger_func() RETURNS TRIGGER AS $$
DECLARE
    v_actor UUID := NULL;
    v_action TEXT := TG_OP;
    v_before JSONB := NULL;
    v_after JSONB := NULL;
    v_row_id UUID := NULL;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_after := to_jsonb(NEW);
        v_row_id := NEW.id;
    ELSIF TG_OP = 'UPDATE' THEN
        v_before := to_jsonb(OLD);
        v_after := to_jsonb(NEW);
        v_row_id := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        v_before := to_jsonb(OLD);
        v_row_id := OLD.id;
    END IF;

    INSERT INTO audit_log(action, table_name, row_id, before_data, after_data)
    VALUES (v_action, TG_TABLE_NAME::TEXT, v_row_id, v_before, v_after);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind triggers to high sensitivity tables
CREATE TRIGGER trg_audit_salary_history BEFORE INSERT OR UPDATE OR DELETE ON salary_history FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER trg_audit_payments BEFORE INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER trg_audit_payment_types BEFORE INSERT OR UPDATE OR DELETE ON payment_types FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER trg_audit_contracts BEFORE INSERT OR UPDATE OR DELETE ON contracts FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER trg_audit_leave_requests BEFORE INSERT OR UPDATE OR DELETE ON leave_requests FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER trg_audit_mandatory_leaves BEFORE INSERT OR UPDATE OR DELETE ON mandatory_leaves FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ==============================================================================
-- 9. ROW-LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_sensitive ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandatory_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergani_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergani_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergani_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Default grant for authenticated role
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

-- RLS helper function: check if authenticated user is admin
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN profiles p ON p.id = ur.profile_id
        WHERE (p.auth_user_id = auth.uid() OR p.work_email = current_setting('request.jwt.claim.email', true))
        AND ur.role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Profiles: everyone can read directory fields; admins can edit
CREATE POLICY policy_profiles_select ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_profiles_modify ON profiles FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Sensitive profile data: admins ONLY
CREATE POLICY policy_sensitive_admin ON profile_sensitive FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Salary History & Payments (Compensation): admins ONLY
CREATE POLICY policy_salary_admin ON salary_history FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY policy_payments_admin ON payments FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Leave requests: employees can manage their own non-mandatory rows; admins can manage all
CREATE POLICY policy_leave_select ON leave_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_leave_insert ON leave_requests FOR INSERT TO authenticated WITH CHECK (
    is_admin() OR (profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid()) AND origin = 'employee_request')
);
CREATE POLICY policy_leave_update ON leave_requests FOR UPDATE TO authenticated USING (
    is_admin() OR (profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid()) AND origin = 'employee_request' AND status = 'pending')
);

-- Public holidays, leave types, remote policies: everyone can read; admin edits
CREATE POLICY policy_holidays_read ON public_holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_holidays_admin ON public_holidays FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY policy_leave_types_read ON leave_types FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_leave_types_admin ON leave_types FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Contracts: everyone can read directory/status; admins edit
CREATE POLICY policy_contracts_select ON contracts FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_contracts_admin ON contracts FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY policy_counterparties_select ON counterparties FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_counterparties_admin ON counterparties FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
