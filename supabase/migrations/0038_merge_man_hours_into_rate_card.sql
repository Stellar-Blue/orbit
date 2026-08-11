-- 0038: Merge man-hours pricing into the rate card
-- The v1 "Man-Hours & Engineering Time" catalog module duplicated the rate-card matrix
-- (rate_cards / rate_card_entries). The rate card is now the single source of truth for
-- man-hours hourly rates. Remove the catalog module and its items.
-- contract_lines referencing these items keep their snapshotted values (FK is SET NULL).

DELETE FROM public.catalog_items WHERE pricing_kind = 'man_hours';
DELETE FROM public.catalog_modules WHERE name = 'Man-Hours & Engineering Time';
