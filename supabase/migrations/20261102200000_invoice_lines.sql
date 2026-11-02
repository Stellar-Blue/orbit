-- ==============================================================================
-- Invoice lines.
--
-- One invoice often bills several things at different amounts and for different
-- months: two agreements' fees for a quarter plus a change request delivered in
-- one month. The link arrays say *what* an invoice bills but not *how much of it
-- goes where*, so the revenue schedule had to guess from the total.
--
-- Each line carries its own net amount (invoice currency), its own service period
-- and the one agreement fee or project it bills:
--   { id, description, amount, period_from, period_to, contract_id, project_id }
--
-- Additive only: invoices without lines keep working exactly as before, and the
-- invoice-level net / period / contract_ids / project_ids stay the summary the
-- rest of the app (exports, AADE sync, filters) reads.
-- ==============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS lines JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.invoices.lines IS
  'Invoice lines: [{ id, description, amount, period_from, period_to, contract_id, project_id }]. '
  'amount is net in the invoice currency; a line bills a project (project_id) or an agreement''s own fee (contract_id).';
