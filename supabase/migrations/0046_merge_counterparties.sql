-- Migration 0046: merge counterparties (dedup)
-- Merges a duplicate counterparty (source) INTO a kept one (target): all child records are
-- reassigned to the target, missing target fields are filled from the source, then the source
-- is deleted. Runs atomically (single transaction). Admin-only, invoked via API route.
--
-- Child tables covered: counterparty_contacts, contacts, contracts, attio_outbox, attio_links,
-- invoices, counterparty_tier_overrides, counterparty_tier_history, counterparty_tiers.
-- Unique-constraint handling: attio_links keeps the target's link (moves the source's only if the
-- target has none); invoices suffix the number on (direction, invoice_number) collisions; tier
-- state keeps the target's row per model.

CREATE OR REPLACE FUNCTION public.merge_counterparties(p_target_id UUID, p_source_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.counterparties%ROWTYPE;
  v_source public.counterparties%ROWTYPE;
  v_counts jsonb;
  v_n int;
  v_target_linked boolean;
  v_row RECORD;
  v_new_number text;
BEGIN
  IF p_target_id IS NULL OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'target_id and source_id are required';
  END IF;
  IF p_target_id = p_source_id THEN
    RAISE EXCEPTION 'target and source counterparties must be different';
  END IF;

  SELECT * INTO v_target FROM public.counterparties WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target counterparty not found'; END IF;

  SELECT * INTO v_source FROM public.counterparties WHERE id = p_source_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'source counterparty not found'; END IF;

  v_counts := jsonb_build_object();

  -- 1. Contacts (modern + legacy)
  UPDATE public.counterparty_contacts SET counterparty_id = p_target_id WHERE counterparty_id = p_source_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('contacts', v_n);

  UPDATE public.contacts SET counterparty_id = p_target_id WHERE counterparty_id = p_source_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('legacy_contacts', v_n);

  -- 2. Contracts
  UPDATE public.contracts SET counterparty_id = p_target_id WHERE counterparty_id = p_source_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('contracts', v_n);

  -- 3. Attio outbox
  UPDATE public.attio_outbox SET counterparty_id = p_target_id WHERE counterparty_id = p_source_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('outbox', v_n);

  -- 4. Attio link (unique per counterparty): keep the target's link; move the source's only if the target has none.
  SELECT EXISTS (SELECT 1 FROM public.attio_links WHERE counterparty_id = p_target_id) INTO v_target_linked;
  IF v_target_linked THEN
    DELETE FROM public.attio_links WHERE counterparty_id = p_source_id;
    v_counts := v_counts || jsonb_build_object('attio_link', 'kept_target');
  ELSE
    UPDATE public.attio_links SET counterparty_id = p_target_id WHERE counterparty_id = p_source_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('attio_link', CASE WHEN v_n > 0 THEN 'moved' ELSE 'none' END);
  END IF;

  -- 5. Invoices (unique on counterparty_id, direction, invoice_number): suffix the number on collision.
  v_n := 0;
  FOR v_row IN SELECT * FROM public.invoices WHERE counterparty_id = p_source_id LOOP
    IF EXISTS (
      SELECT 1 FROM public.invoices
      WHERE counterparty_id = p_target_id AND direction = v_row.direction AND invoice_number = v_row.invoice_number
    ) THEN
      v_new_number := v_row.invoice_number || ' [' || COALESCE(v_row.mark, 'merged') || ']';
      UPDATE public.invoices SET counterparty_id = p_target_id, invoice_number = v_new_number WHERE id = v_row.id;
    ELSE
      UPDATE public.invoices SET counterparty_id = p_target_id WHERE id = v_row.id;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  v_counts := v_counts || jsonb_build_object('invoices', v_n);

  -- 6. Tier overrides + history
  UPDATE public.counterparty_tier_overrides SET counterparty_id = p_target_id WHERE counterparty_id = p_source_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('tier_overrides', v_n);

  UPDATE public.counterparty_tier_history SET counterparty_id = p_target_id WHERE counterparty_id = p_source_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('tier_history', v_n);

  -- 7. Tier state (PK counterparty_id, model): target wins per model.
  DELETE FROM public.counterparty_tiers
  WHERE counterparty_id = p_source_id AND model IN (SELECT model FROM public.counterparty_tiers WHERE counterparty_id = p_target_id);
  UPDATE public.counterparty_tiers SET counterparty_id = p_target_id WHERE counterparty_id = p_source_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('tiers_moved', v_n);

  -- 8. Drop the source first (all children already moved), then fill the target's missing
  --    profile fields from the captured source row. Deleting first avoids colliding with the
  --    partial unique index on (country, vat_number) when the target had no VAT of its own.
  DELETE FROM public.counterparties WHERE id = p_source_id;

  UPDATE public.counterparties SET
    legal_name     = COALESCE(NULLIF(v_target.legal_name, ''), v_source.legal_name),
    trade_name     = COALESCE(NULLIF(v_target.trade_name, ''), v_source.trade_name),
    afm            = COALESCE(NULLIF(v_target.afm, ''), v_source.afm),
    vat_number     = COALESCE(NULLIF(v_target.vat_number, ''), v_source.vat_number),
    doy            = COALESCE(NULLIF(v_target.doy, ''), v_source.doy),
    country        = COALESCE(NULLIF(v_target.country, ''), v_source.country),
    address        = COALESCE(NULLIF(v_target.address, ''), v_source.address),
    website_domain = COALESCE(NULLIF(v_target.website_domain, ''), v_source.website_domain),
    notes          = CASE
                       WHEN NULLIF(v_target.notes, '') IS NULL AND NULLIF(v_source.notes, '') IS NULL THEN NULL
                       WHEN NULLIF(v_target.notes, '') IS NULL THEN v_source.notes
                       WHEN NULLIF(v_source.notes, '') IS NULL THEN v_target.notes
                       ELSE v_target.notes || E'\n— merged from ' || v_source.legal_name || ': ' || v_source.notes
                     END
  WHERE id = p_target_id;

  RETURN v_counts;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_counterparties(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_counterparties(UUID, UUID) TO authenticated;
