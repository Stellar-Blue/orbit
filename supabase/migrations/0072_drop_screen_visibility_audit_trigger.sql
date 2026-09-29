-- ==============================================================================
-- 0072: drop the audit trigger 0071 put on screen_visibility.
--
-- `audit_trigger_func()` reads NEW.id, which screen_visibility does not have (its key is
-- `screen_key`), so any write failed with `record "new" has no field "id"`. The table
-- already carries `updated_by` / `updated_at`, which is the audit trail that matters here.
-- ==============================================================================

DROP TRIGGER IF EXISTS trg_audit_screen_visibility ON public.screen_visibility;
