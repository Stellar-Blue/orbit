-- Migration 0011: Invoice Tracking, Financial Reconciliation & Customizable Budget Categories
-- Defines schema for AR/AP invoice archives, credit notes, schedule allocations, payment milestones, and storage buckets.

-- 1. Extend contracts table with customizable payment terms
ALTER TABLE contracts 
ADD COLUMN IF NOT EXISTS payment_terms_days INT NOT NULL DEFAULT 30;

COMMENT ON COLUMN contracts.payment_terms_days IS 'Default net payment terms in days (e.g. Net 30, Net 60) for generating invoice due dates';

-- 2. Create customizable invoice expense categories table
CREATE TABLE IF NOT EXISTS invoice_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial standardized budget category options
INSERT INTO invoice_categories (name, description, is_default) VALUES
('Infrastructure & Hosting', 'Servers, cloud computing, domain names, and technical SaaS infrastructure', true),
('Marketing & Sales', 'Advertising campaigns, sponsorships, event marketing, and CRM tools', true),
('Office & Admin', 'Office rent, equipment, utilities, supplies, and facility management', true),
('Travel & Expense', 'Corporate travel, flights, lodging, client entertainment, and mobility', true),
('Legal & Accounting', 'External audit fees, corporate counsel, IP protection, and advisory services', true),
('Other Operational', 'Miscellaneous operational expenses and uncategorized vendor services', true)
ON CONFLICT (name) DO NOTHING;

-- 3. Create invoices core archive table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT CHECK (direction IN ('outgoing', 'incoming')) NOT NULL,
  counterparty_id UUID REFERENCES counterparties(id) ON DELETE RESTRICT NOT NULL,
  contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL NULL,
  type TEXT CHECK (type IN ('invoice', 'credit_note', 'proforma', 'debit_note')) NOT NULL DEFAULT 'invoice',
  credits_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL NULL,
  invoice_number TEXT NOT NULL,
  mark TEXT NULL, -- AADE myDATA registration number (Μοναδικός Αριθμός Καταχώρησης)
  internal_ref TEXT NULL,
  category TEXT NULL, -- References invoice_categories name for one-off / unlinked bills
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  period_from DATE NULL,
  period_to DATE NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  fx_rate NUMERIC NOT NULL DEFAULT 1.0,
  net NUMERIC NOT NULL,
  vat_amount NUMERIC NOT NULL,
  vat_rate TEXT NOT NULL DEFAULT '24%',
  gross NUMERIC NOT NULL,
  gross_eur NUMERIC NOT NULL,
  status TEXT CHECK (status IN ('registered', 'sent_received', 'partially_paid', 'paid', 'disputed', 'resolved', 'cancelled')) NOT NULL DEFAULT 'registered',
  missing_document BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT idx_invoices_unique_dedup UNIQUE (counterparty_id, direction, invoice_number)
);

COMMENT ON TABLE invoices IS 'Immutable common truth archive for issued (AR) and received (AP) corporate invoices and credit notes';
COMMENT ON COLUMN invoices.mark IS 'AADE myDATA unique transmission registration identifier (Μοναδικός Αριθμός Καταχώρησης)';

-- 4. Create child tables for documents, payment disbursements, and schedule allocations
CREATE TABLE IF NOT EXISTS invoice_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  paid_on DATE NOT NULL,
  amount NUMERIC NOT NULL,
  bank_reference TEXT NULL,
  note TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE NOT NULL,
  period TEXT NOT NULL, -- Format YYYY-MM matching contract_revenue_schedule
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Set up Supabase Storage Bucket for Invoice PDF Archives
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoices',
  'invoices',
  true,
  52428800,
  '{"application/pdf","image/png","image/jpeg","image/webp"}'
)
ON CONFLICT (id) DO NOTHING;

-- Storage security policies for invoices bucket
DROP POLICY IF EXISTS "Enable invoice file uploads" ON storage.objects;
CREATE POLICY "Enable invoice file uploads" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'invoices');

DROP POLICY IF EXISTS "Enable invoice file access" ON storage.objects;
CREATE POLICY "Enable invoice file access" ON storage.objects FOR SELECT USING (bucket_id = 'invoices');

DROP POLICY IF EXISTS "Enable invoice file deletions" ON storage.objects;
CREATE POLICY "Enable invoice file deletions" ON storage.objects FOR DELETE USING (bucket_id = 'invoices');

-- 6. Enable Row Level Security (RLS) & Policies
ALTER TABLE invoice_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_allocations ENABLE ROW LEVEL SECURITY;

-- Allow read/write for application admin sessions (or local dev client bypass)
CREATE POLICY "Enable read access for all to invoice_categories" ON invoice_categories FOR SELECT USING (true);
CREATE POLICY "Enable write access for all to invoice_categories" ON invoice_categories FOR ALL USING (true);

CREATE POLICY "Enable full access to invoices" ON invoices FOR ALL USING (true);
CREATE POLICY "Enable full access to invoice_documents" ON invoice_documents FOR ALL USING (true);
CREATE POLICY "Enable full access to invoice_payments" ON invoice_payments FOR ALL USING (true);
CREATE POLICY "Enable full access to invoice_allocations" ON invoice_allocations FOR ALL USING (true);

-- 7. Seed realistic sample invoice records against dev counterparties (if present)
DO $$
DECLARE
  v_cp_id UUID;
  v_contract_id UUID;
  v_inv_id UUID;
BEGIN
  -- Check if there is at least one counterparty to link sample invoices to
  SELECT id INTO v_cp_id FROM counterparties LIMIT 1;
  SELECT id INTO v_contract_id FROM contracts LIMIT 1;

  IF v_cp_id IS NOT NULL THEN
    -- Seed an outgoing AR invoice that has been paid
    INSERT INTO invoices (
      id, direction, counterparty_id, contract_id, type, invoice_number, mark, internal_ref, category,
      issue_date, due_date, period_from, period_to, currency, fx_rate, net, vat_amount, vat_rate, gross, gross_eur, status, missing_document, notes
    ) VALUES (
      gen_random_uuid(), 'outgoing', v_cp_id, v_contract_id, 'invoice', 'TIM-2026-0014', '4009281729013', 'AR-Q3-2026', 'Infrastructure & Hosting',
      '2026-07-01', '2026-07-31', '2026-07-01', '2026-07-31', 'EUR', 1.0, 12500.00, 3000.00, '24%', 15500.00, 15500.00, 'paid', false, 'Standard SaaS Platform Enterprise Subscription - July 2026'
    ) RETURNING id INTO v_inv_id;

    -- Seed payment for this invoice
    INSERT INTO invoice_payments (invoice_id, paid_on, amount, bank_reference, note)
    VALUES (v_inv_id, '2026-07-28', 15500.00, 'EUR-SEPA-882910384', 'Full payment received via Alpha Bank SEPA');

    -- If a contract exists, allocate to July 2026 schedule
    IF v_contract_id IS NOT NULL THEN
      INSERT INTO invoice_allocations (invoice_id, contract_id, period, amount)
      VALUES (v_inv_id, v_contract_id, '2026-07', 12500.00);
    END IF;

    -- Seed an incoming AP supplier invoice currently unpaid and due in 12 days
    INSERT INTO invoices (
      direction, counterparty_id, contract_id, type, invoice_number, mark, internal_ref, category,
      issue_date, due_date, period_from, period_to, currency, fx_rate, net, vat_amount, vat_rate, gross, gross_eur, status, missing_document, notes
    ) VALUES (
      'incoming', v_cp_id, NULL, 'invoice', 'AWS-INV-2026-08', NULL, 'AP-CLOUD-08', 'Infrastructure & Hosting',
      '2026-08-01', '2026-08-31', '2026-07-01', '2026-07-31', 'EUR', 1.0, 4820.00, 1156.80, '24%', 5976.80, 5976.80, 'sent_received', true, 'Monthly hosting usage bill for primary production cluster'
    );
  END IF;
END $$;
