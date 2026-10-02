-- Multiple bank references per payment.
--
-- One settlement can arrive as several transfers, each carrying its own transaction number
-- (Αριθμός συναλλαγής on the receipt), so the single value becomes a list. Existing values are kept
-- as the first element — nothing is lost and no reader has to be taught two shapes.
ALTER TABLE public.payments
  ALTER COLUMN bank_reference TYPE TEXT[]
  USING (
    CASE
      WHEN bank_reference IS NULL OR btrim(bank_reference) = '' THEN NULL
      ELSE ARRAY[btrim(bank_reference)]
    END
  );

COMMENT ON COLUMN public.payments.bank_reference IS
  'Bank transaction references for this settlement (one per transfer). Empty list = not yet paid by wire.';

-- PostgREST caches column types; without this it keeps serialising the column as a plain string.
NOTIFY pgrst, 'reload schema';
