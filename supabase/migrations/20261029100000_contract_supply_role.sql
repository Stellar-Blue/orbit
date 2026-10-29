-- ==============================================================================
-- Subcontracts: agreements where StellarBlue is not the prime contractor.
--
-- Some of the work we book is delivered under another company's contract (e.g. we
-- supply ATLAS to VEB through Uni Systems). The payer stays the counterparty —
-- that is who we invoice — while these columns record our position, the end
-- customer the work really serves, the prime's own reference and the fee the
-- prime contractor retains.
-- ==============================================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS supply_role TEXT NOT NULL DEFAULT 'prime'
    CHECK (supply_role IN ('prime', 'subcontractor', 'intercompany')),
  ADD COLUMN IF NOT EXISTS end_customer_id UUID REFERENCES public.counterparties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prime_contract_ref TEXT,
  ADD COLUMN IF NOT EXISTS prime_fee_pct NUMERIC NOT NULL DEFAULT 0
    CHECK (prime_fee_pct >= 0 AND prime_fee_pct <= 100);

COMMENT ON COLUMN public.contracts.supply_role IS
  'Our position on the deal: prime (we hold the client contract), subcontractor (we sit under another vendor) or intercompany (group resale).';
COMMENT ON COLUMN public.contracts.end_customer_id IS
  'Ultimate client the work serves when we are not prime (e.g. VEB under Uni Systems). Never invoiced.';
COMMENT ON COLUMN public.contracts.prime_contract_ref IS
  'The prime contractor''s own contract / PO number we work under (flow-down reference quoted on our invoices).';
COMMENT ON COLUMN public.contracts.prime_fee_pct IS
  'Share of the billed amount the prime contractor retains, in percent.';

CREATE INDEX IF NOT EXISTS contracts_end_customer_idx ON public.contracts (end_customer_id);
CREATE INDEX IF NOT EXISTS contracts_supply_role_idx ON public.contracts (supply_role);
