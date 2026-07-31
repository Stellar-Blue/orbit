-- Migration: 0008_compensation_v1_rls_and_fields.sql
-- Description: Implement Compensation & Payroll Version 1 database fields and strict RLS policies.

-- 1. Add employer_cost_multiplier to salary_history (defaulting to 1.24 for salary, 1.0 for contractors)
ALTER TABLE salary_history
ADD COLUMN IF NOT EXISTS employer_cost_multiplier NUMERIC(5,4) DEFAULT 1.2400;

-- 2. Add recurring and statutory fields to payment_types
ALTER TABLE payment_types
ADD COLUMN IF NOT EXISTS is_recurring_monthly BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS default_period_month INTEGER NULL,
ADD COLUMN IF NOT EXISTS default_multiplier NUMERIC(4,2) DEFAULT 1.00;

-- 3. Add bank_reference to payments if not exists
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS bank_reference TEXT NULL;

-- 4. Update RLS Policies for salary_history and payments
-- Drop previous admin-only restrictive policies if needed and create dual admin + self-service policies
DROP POLICY IF EXISTS policy_salary_admin ON salary_history;
DROP POLICY IF EXISTS policy_payments_admin ON payments;

-- Salary History: Admins have full ALL access; employees can only SELECT their own records
CREATE POLICY policy_salary_admin ON salary_history
    FOR ALL TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY policy_salary_employee_select ON salary_history
    FOR SELECT TO authenticated
    USING (
        profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    );

-- Payments: Admins have full ALL access; employees can only SELECT their own records AND only when status = 'paid'
CREATE POLICY policy_payments_admin ON payments
    FOR ALL TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY policy_payments_employee_select ON payments
    FOR SELECT TO authenticated
    USING (
        profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
        AND status = 'paid'
    );

-- Ensure all writes stay strictly admin-only by not granting INSERT/UPDATE/DELETE to employee policies.
