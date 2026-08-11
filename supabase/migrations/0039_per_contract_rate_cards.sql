-- 0039: Per-contract rate cards
-- Rate cards become contract-scoped: a card with contract_id set is that contract's own
-- man-hours rate matrix (created lazily from the global default when the contract is
-- first opened). Cards with contract_id NULL remain the shared/global defaults.
ALTER TABLE public.rate_cards
  ADD COLUMN IF NOT EXISTS contract_id UUID NULL REFERENCES public.contracts(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS rate_cards_contract_idx ON public.rate_cards (contract_id);
