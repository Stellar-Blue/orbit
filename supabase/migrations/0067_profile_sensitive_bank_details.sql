-- ==============================================================================
-- 0067: bank details alongside the IBAN.
--
-- Payroll needs to know which bank and which SWIFT/BIC the IBAN belongs to (for the payment
-- instruction and for international transfers), not just the account number.
--
-- These live in `profile_sensitive` with the rest of the banking data: admins write them from the
-- People Directory, and an employee can read their own row (0066 own-row policy). Both are
-- optional — existing rows keep NULL until someone fills them in.
-- ==============================================================================

ALTER TABLE public.profile_sensitive ADD COLUMN IF NOT EXISTS bank_name TEXT NULL;
ALTER TABLE public.profile_sensitive ADD COLUMN IF NOT EXISTS bank_swift TEXT NULL;

COMMENT ON COLUMN public.profile_sensitive.bank_name IS
  'Payout bank name, e.g. Eurobank Ergasias. Optional.';
COMMENT ON COLUMN public.profile_sensitive.bank_swift IS
  'SWIFT/BIC of the payout bank, 8 or 11 characters. Optional.';
