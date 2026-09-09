-- 0058: Refine the remote-day rule guard so it only fires on SCHEDULING changes.
-- Status-only updates (e.g. ergani_status / ergani_submitted_at by server sync) must
-- never trip the past/advance rules, even on past days (service role has no JWT, so
-- is_admin() is false there). If neither date nor mode changes, allow the update.
CREATE OR REPLACE FUNCTION public.guard_remote_day_rules() RETURNS trigger AS $$
DECLARE
  adv INT := 0;
BEGIN
  -- Status/note-only updates are not scheduling changes.
  IF TG_OP = 'UPDATE' AND OLD.date = NEW.date AND OLD.mode = NEW.mode THEN
    RETURN NEW;
  END IF;

  IF NEW.mode = 'office' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(registration_advance_days, 0) INTO adv
  FROM public.remote_policies
  WHERE scope_type = 'company'
  LIMIT 1;
  adv := COALESCE(adv, 0);

  IF NEW.date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Past remote days are locked: only administrators can change past remote days.';
  END IF;
  IF adv > 0 AND NEW.date < CURRENT_DATE + make_interval(days => adv) THEN
    RAISE EXCEPTION 'Remote work must be registered at least % day(s) in advance.', adv;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_remote_day_rules ON public.remote_days;
CREATE TRIGGER trg_guard_remote_day_rules
  BEFORE INSERT OR UPDATE ON public.remote_days
  FOR EACH ROW EXECUTE FUNCTION public.guard_remote_day_rules();
