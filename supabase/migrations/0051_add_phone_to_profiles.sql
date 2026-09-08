-- 0051: Add directory-level contact phone number to profiles.
-- Non-sensitive contact field (like work email); AFM/AMKA/IBAN/address stay in
-- profile_sensitive (admin-only).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT NULL;
