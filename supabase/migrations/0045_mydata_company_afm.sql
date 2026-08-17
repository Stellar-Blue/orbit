-- Migration 0045: AADE company AFM (direction detection)
-- The company's own AFM lets the sync distinguish issued documents (we are the issuer →
-- outgoing/AR, other party = counterpart) from received ones (we are the counterpart →
-- incoming/AP, other party = issuer) returned by RequestTransmittedDocs.
ALTER TABLE public.aade_sync_state ADD COLUMN IF NOT EXISTS company_afm TEXT NULL;
