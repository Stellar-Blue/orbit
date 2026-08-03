-- Migration 0021: Add reference_period to invoices table and support 'draft' status
-- Enables tracking the reference period (e.g. '2026-08', '2026-Q3', '2026', 'One-off Delivery') for contract invoicing verification and reporting analysis.

ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS reference_period TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_reference_period ON invoices(reference_period);

COMMENT ON COLUMN invoices.reference_period IS 'Reference billing/reporting period (e.g., 2026-08, 2026-Q3, 2026) for contract schedule matching and variance analysis';

-- Update check constraint on status to permit 'draft' invoices
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'registered', 'sent_received', 'partially_paid', 'paid', 'disputed', 'resolved', 'cancelled'));
