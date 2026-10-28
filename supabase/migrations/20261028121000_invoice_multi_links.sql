-- ==============================================================================
-- Invoices can reference several agreements, and the projects inside them.
--
-- One invoice often bills more than one thing: a licence plus two change requests
-- from different projects, or the same service across two master agreements. The
-- single `contract_id` column could not express that, so the register now stores
-- every link in two arrays.
--
-- Additive only: `contract_id` stays in place as the primary (first) contract so
-- legacy readers, exports and the AADE sync keep working unchanged.
-- ==============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS contract_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS project_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.invoices.contract_ids IS
  'Every contract the invoice bills. `contract_id` mirrors the first entry as the primary link.';
COMMENT ON COLUMN public.invoices.project_ids IS
  'Projects (change requests) the invoice bills; their parent contracts also appear in contract_ids.';

-- Carry the legacy single link over, without duplicating on re-run.
UPDATE public.invoices
SET contract_ids = ARRAY[contract_id]
WHERE contract_id IS NOT NULL
  AND COALESCE(ARRAY_LENGTH(contract_ids, 1), 0) = 0;

CREATE INDEX IF NOT EXISTS invoices_contract_ids_idx ON public.invoices USING GIN (contract_ids);
CREATE INDEX IF NOT EXISTS invoices_project_ids_idx ON public.invoices USING GIN (project_ids);
