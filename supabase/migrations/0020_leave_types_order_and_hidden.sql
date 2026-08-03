-- Add sort_order and is_hidden columns to leave_types table
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 100;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;

-- Populate sequential order on standard default leave categories if present
UPDATE leave_types SET sort_order = 10 WHERE code = 'annual' OR code = 'lt-annual';
UPDATE leave_types SET sort_order = 20 WHERE code = 'sick' OR code = 'lt-sick';
UPDATE leave_types SET sort_order = 30 WHERE code = 'unpaid' OR code = 'lt-unpaid';
UPDATE leave_types SET sort_order = 40 WHERE code = 'bereavement' OR code = 'lt-bereavement';
UPDATE leave_types SET sort_order = 50 WHERE code = 'blood_donation' OR code = 'lt-blood';
