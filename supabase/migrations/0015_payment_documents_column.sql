-- Add documents JSONB column to payments table for persisting uploaded receipts and vouchers
ALTER TABLE payments ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '[]'::jsonb;
NOTIFY pgrst, 'reload schema';
