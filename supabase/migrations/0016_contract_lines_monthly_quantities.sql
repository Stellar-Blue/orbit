-- Add monthly_quantities JSONB column to contract_lines table for per-asset/tiered modular pricing schedule projections
ALTER TABLE contract_lines ADD COLUMN IF NOT EXISTS monthly_quantities JSONB DEFAULT '{}'::jsonb;
NOTIFY pgrst, 'reload schema';
