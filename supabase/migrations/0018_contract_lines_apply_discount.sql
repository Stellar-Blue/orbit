-- Add apply_discount column to contract_lines table to specify which line items receive contract discounts
ALTER TABLE contract_lines ADD COLUMN IF NOT EXISTS apply_discount BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN contract_lines.apply_discount IS 'Whether the contract general discount percentage applies to this line item.';
