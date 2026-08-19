CREATE TABLE invoice_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  title TEXT,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE invoice_links ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view all invoice links" ON invoice_links
  FOR SELECT USING (true);

CREATE POLICY "Users can insert invoice links" ON invoice_links
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update invoice links" ON invoice_links
  FOR UPDATE USING (auth.uid() = created_by);

CREATE POLICY "Users can delete invoice links" ON invoice_links
  FOR DELETE USING (auth.uid() = created_by);

-- Index for fast lookup by invoice_id
CREATE INDEX idx_invoice_links_invoice_id ON invoice_links(invoice_id);
