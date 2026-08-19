-- Backfill script to map legacy text-based categories to new budget_categories UUIDs.

-- Temporary function to match text category to budget category UUID
CREATE OR REPLACE FUNCTION pg_temp.get_budget_category_id(
  p_category TEXT, 
  p_direction TEXT
) RETURNS UUID AS $$
DECLARE
  v_mapped_name TEXT;
  v_budget_direction TEXT;
  v_id UUID;
BEGIN
  -- Determine budget category direction based on invoice direction
  -- incoming = expense, outgoing = income
  IF p_direction = 'incoming' THEN
    v_budget_direction := 'expense';
  ELSIF p_direction = 'outgoing' THEN
    v_budget_direction := 'income';
  ELSE
    v_budget_direction := 'expense';
  END IF;

  -- Map old string categories to new budget category names
  v_mapped_name := CASE
    WHEN p_category ILIKE '%software%' THEN 'SaaS & Software'
    WHEN p_category ILIKE '%cloud%' THEN 'Cloud Infrastructure'
    WHEN p_category ILIKE '%facilit%' THEN 'Rent & Facilities'
    WHEN p_category ILIKE '%clean%' THEN 'Rent & Facilities'
    WHEN p_category ILIKE '%utilit%' THEN 'Rent & Facilities'
    WHEN p_category ILIKE '%travel%' THEN 'Travel & Entertainment'
    WHEN p_category ILIKE '%meal%' THEN 'Travel & Entertainment'
    WHEN p_category ILIKE '%conference%' THEN 'Travel & Entertainment'
    WHEN p_category ILIKE '%train%' THEN 'Travel & Entertainment'
    WHEN p_category ILIKE '%office supplies%' THEN 'Hardware & Equipment'
    WHEN p_category ILIKE '%equipment%' THEN 'Hardware & Equipment'
    WHEN p_category ILIKE '%professional%' THEN 'Legal & Professional'
    WHEN p_category ILIKE '%benefit%' THEN 'Payroll & Benefits'
    WHEN p_category ILIKE '%logistic%' THEN 'Other Expenses'
    WHEN p_category ILIKE '%shipping%' THEN 'Other Expenses'
    ELSE 'Other Expenses'
  END;

  IF v_budget_direction = 'income' THEN
     v_mapped_name := 'Other Income'; -- For simplicity, default all legacy outgoing invoices to 'Other Income' or we could map them. 
  END IF;

  SELECT id INTO v_id 
  FROM budget_categories 
  WHERE name = v_mapped_name AND direction = v_budget_direction 
  LIMIT 1;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Execute the update
UPDATE invoices
SET category_id = pg_temp.get_budget_category_id(category, direction)
WHERE category_id IS NULL AND category IS NOT NULL;

-- For any that had no string category, map to 'Other Expenses' or 'Other Income' based on direction
UPDATE invoices
SET category_id = (SELECT id FROM budget_categories WHERE name = 'Other Expenses' LIMIT 1)
WHERE category_id IS NULL AND direction = 'incoming';

UPDATE invoices
SET category_id = (SELECT id FROM budget_categories WHERE name = 'Other Income' LIMIT 1)
WHERE category_id IS NULL AND direction = 'outgoing';

-- Drop the temp function
DROP FUNCTION pg_temp.get_budget_category_id(TEXT, TEXT);
