-- Per-line invoicing timing: some contracts bill one line in advance and another in arrears within the
-- same period (e.g. a platform licence up front, optimization/forecast services after the month closes).
--
-- NULL  = inherit the contract's invoice_timing (existing behaviour, so no backfill needed)
-- 'start_of_period' = billed in advance at the start of the chargeable period
-- 'end_of_period'   = billed in arrears once the period has closed
ALTER TABLE public.contract_lines
  ADD COLUMN IF NOT EXISTS invoice_timing TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_lines_invoice_timing_check'
  ) THEN
    ALTER TABLE public.contract_lines
      ADD CONSTRAINT contract_lines_invoice_timing_check
      CHECK (invoice_timing IS NULL OR invoice_timing IN ('start_of_period', 'end_of_period'));
  END IF;
END $$;

COMMENT ON COLUMN public.contract_lines.invoice_timing IS
  'NULL = inherit contracts.invoice_timing; otherwise start_of_period (advance) or end_of_period (arrears).';
