-- Migration 0019: Add invoice_timing column to contracts table
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS invoice_timing VARCHAR(50) DEFAULT 'start_of_period';
UPDATE contracts SET invoice_timing = 'start_of_period' WHERE invoice_timing IS NULL;
