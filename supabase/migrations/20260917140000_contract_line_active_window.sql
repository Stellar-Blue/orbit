-- Per-line active window: charges inside one contract can start later or end earlier than the contract
-- itself (a module added in month 4, a licence that stops mid-term). The month-by-month schedule only
-- charges a line while its window covers the period.
--
-- NULL = the line follows the contract's own service window (existing behaviour, no backfill needed).
-- Both dates are inclusive; billing is monthly, so comparisons use the month (YYYY-MM).
ALTER TABLE public.contract_lines
  ADD COLUMN IF NOT EXISTS starts_on DATE,
  ADD COLUMN IF NOT EXISTS ends_on DATE;

-- A window must be a valid range: no end before start.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_lines_active_window_check'
  ) THEN
    ALTER TABLE public.contract_lines
      ADD CONSTRAINT contract_lines_active_window_check
      CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);
  END IF;
END $$;

COMMENT ON COLUMN public.contract_lines.starts_on IS
  'First chargeable month for this line (inclusive). NULL = start with the contract.';
COMMENT ON COLUMN public.contract_lines.ends_on IS
  'Last chargeable month for this line (inclusive). NULL = run until the contract ends.';
