-- ==============================================================================
-- Receipts: money that moved without a tax invoice.
--
-- An intercompany transfer (e.g. GCS settling StellarBlue's invoices in one mass
-- payment) is real cash on the revenue schedule, but there is no document to
-- register. A receipt records that money — counterparty, amount, value date, what
-- it covers — and can be linked to contracts, projects and (when one exists later)
-- the invoice it settles.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counterparty_id UUID NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
  -- incoming = money received (AR), outgoing = money paid out (AP)
  direction TEXT NOT NULL DEFAULT 'incoming' CHECK (direction IN ('incoming', 'outgoing')),
  amount NUMERIC NOT NULL CHECK (amount <> 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  fx_rate NUMERIC NOT NULL DEFAULT 1,
  amount_eur NUMERIC NOT NULL,
  received_on DATE NOT NULL,
  -- Service window the money covers; falls back to the receipt month when empty.
  period_from DATE,
  period_to DATE,
  method TEXT,
  bank_reference TEXT,
  note TEXT,
  contract_ids UUID[] NOT NULL DEFAULT '{}',
  project_ids UUID[] NOT NULL DEFAULT '{}',
  -- The invoice this receipt settles, when one exists (or is raised later).
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.receipts IS
  'Cash movements without a tax document (intercompany transfers, deposits). Optional links to contracts, projects and the invoice they settle.';

CREATE INDEX IF NOT EXISTS receipts_received_on_idx ON public.receipts (received_on DESC);
CREATE INDEX IF NOT EXISTS receipts_contract_ids_idx ON public.receipts USING GIN (contract_ids);
CREATE INDEX IF NOT EXISTS receipts_project_ids_idx ON public.receipts USING GIN (project_ids);
CREATE INDEX IF NOT EXISTS receipts_invoice_idx ON public.receipts (invoice_id);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipts_admin ON public.receipts;
CREATE POLICY receipts_admin ON public.receipts FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Live sync: the revenue schedule and the invoice register both read receipts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.receipts;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
