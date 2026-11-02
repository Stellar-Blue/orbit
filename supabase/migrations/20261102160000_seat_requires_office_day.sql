-- ---------------------------------------------------------------------------
-- A seat is for a day at the office
--
-- Booking a seat on a day the person has declared as leave or remote is a contradiction: the room
-- would show them as present while the company sees them away. Two triggers keep the two truths
-- consistent, whichever screen (or API) writes first:
--
--   • `enforce_seat_at_office` refuses a booking on a day the person is away. A declared request is
--     enough — pending leave counts, because the person has already declared the day. An explicit
--     `remote_days` row with mode `office` overrides a recurring remote pattern, which is how the
--     remote screen lets someone come in on a pattern day.
--   • `release_seats_for_absence` frees the seats a person holds when a leave or a remote day is
--     registered for those dates, so the room never keeps a chair for someone who cannot use it.
--
-- Leave statuses match `AWAY_LEAVE_STATUSES` and the remote lookup matches `absenceOnDate` in
-- src/lib/spaces.ts; the rule is written twice because only the database can be the last word on a
-- direct insert, and only TypeScript can explain it in a dialog.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_seat_at_office()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_away TEXT;
  v_weekday TEXT;
BEGIN
  SELECT 'leave' INTO v_away
  FROM public.leave_requests
  WHERE profile_id = NEW.profile_id
    AND status IN ('pending', 'approved', 'in_progress', 'taken', 'cancellation_requested')
    AND start_date <= NEW.booking_date
    AND end_date >= NEW.booking_date
  LIMIT 1;
  IF v_away IS NOT NULL THEN
    RAISE EXCEPTION 'That day is registered as leave — a seat can only be booked for a day at the office.'
      USING ERRCODE = 'SB001';
  END IF;

  -- An explicit declaration for the day wins over the recurring pattern, including "I am in".
  SELECT mode INTO v_away
  FROM public.remote_days
  WHERE profile_id = NEW.profile_id AND date = NEW.booking_date
  LIMIT 1;
  IF v_away IS NOT NULL THEN
    IF v_away <> 'office' THEN
      RAISE EXCEPTION 'That day is registered as remote work — a seat can only be booked for a day at the office.'
        USING ERRCODE = 'SB001';
    END IF;
    RETURN NEW;
  END IF;

  v_weekday := CASE EXTRACT(ISODOW FROM NEW.booking_date)
    WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu'
    WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat' ELSE 'Sun' END;

  SELECT mode INTO v_away
  FROM public.remote_patterns
  WHERE profile_id = NEW.profile_id
    AND mode <> 'office'
    AND weekday = v_weekday
    AND valid_from <= NEW.booking_date
    AND (valid_to IS NULL OR valid_to >= NEW.booking_date)
  LIMIT 1;
  IF v_away IS NOT NULL THEN
    RAISE EXCEPTION 'That day falls in your recurring remote schedule — a seat can only be booked for a day at the office.'
      USING ERRCODE = 'SB001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_seat_at_office() IS
  'Refuses a seat booking on a day the person declared as leave or remote (SQLSTATE SB001).';

DROP TRIGGER IF EXISTS space_bookings_requires_office_day ON public.space_bookings;
CREATE TRIGGER space_bookings_requires_office_day
  BEFORE INSERT ON public.space_bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_seat_at_office();

-- ---------------------------------------------------------------------------
-- Registering the absence frees the room
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_seats_for_absence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'leave_requests' THEN
    IF NEW.status NOT IN ('pending', 'approved', 'in_progress', 'taken', 'cancellation_requested') THEN
      RETURN NEW;
    END IF;
    DELETE FROM public.space_bookings
    WHERE profile_id = NEW.profile_id
      AND booking_date BETWEEN NEW.start_date AND NEW.end_date;
  ELSE
    IF NEW.mode = 'office' THEN
      RETURN NEW;
    END IF;
    DELETE FROM public.space_bookings
    WHERE profile_id = NEW.profile_id
      AND booking_date = NEW.date;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.release_seats_for_absence() IS
  'Releases the seats a person holds on the dates they just declared as leave or remote.';

DROP TRIGGER IF EXISTS leave_requests_release_seats ON public.leave_requests;
CREATE TRIGGER leave_requests_release_seats
  AFTER INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.release_seats_for_absence();

DROP TRIGGER IF EXISTS remote_days_release_seats ON public.remote_days;
CREATE TRIGGER remote_days_release_seats
  AFTER INSERT OR UPDATE ON public.remote_days
  FOR EACH ROW EXECUTE FUNCTION public.release_seats_for_absence();

-- Trigger functions run as the table owner; nobody needs EXECUTE, so the RPC surface stays closed.
REVOKE EXECUTE ON FUNCTION public.enforce_seat_at_office() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_seats_for_absence() FROM PUBLIC, anon, authenticated;
