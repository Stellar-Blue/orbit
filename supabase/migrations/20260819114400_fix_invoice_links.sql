-- 1. Drop existing policies
DROP POLICY IF EXISTS "Users can view all invoice links" ON invoice_links;
DROP POLICY IF EXISTS "Users can insert invoice links" ON invoice_links;
DROP POLICY IF EXISTS "Users can update invoice links" ON invoice_links;
DROP POLICY IF EXISTS "Users can delete invoice links" ON invoice_links;

-- 2. Add generic policy matching invoices table
CREATE POLICY "Enable full access to invoice_links" ON invoice_links FOR ALL USING (true);

-- 3. Fix foreign key referencing auth.users instead of profiles
ALTER TABLE invoice_links DROP CONSTRAINT invoice_links_created_by_fkey;
ALTER TABLE invoice_links ADD CONSTRAINT invoice_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
