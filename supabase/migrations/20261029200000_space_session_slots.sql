-- ---------------------------------------------------------------------------
-- Several sessions per room per day
--
-- A conference room runs more than one meeting on a normal day. Sessions used to be unique per
-- (space, date). They are now unique per window and may not overlap, and every booking rule —
-- capacity, chair and "one seat per person" — is scoped to the session instead of the day.
-- Whole-day spaces keep their per-date rules untouched (their bookings carry session_id = NULL).
-- ---------------------------------------------------------------------------

ALTER TABLE public.space_sessions DROP CONSTRAINT IF EXISTS space_sessions_one_per_day;

COMMENT ON TABLE public.space_sessions IS
  'One booking window of a time_range space on a date. A room may hold several non-overlapping sessions per day.';

-- Two identical windows are the same session, so the second insert races into the first one.
CREATE UNIQUE INDEX IF NOT EXISTS space_sessions_window_idx
  ON public.space_sessions (space_id, session_date, starts_at);

/** Sessions only exist for time-range spaces and may not overlap: one room cannot be in two meetings. */
CREATE OR REPLACE FUNCTION public.validate_space_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_clash public.space_sessions;
BEGIN
  SELECT t.booking_mode INTO v_mode
  FROM public.spaces s JOIN public.space_types t ON t.id = s.type_id
  WHERE s.id = NEW.space_id;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'Space % does not exist', NEW.space_id;
  END IF;
  IF v_mode <> 'time_range' THEN
    RAISE EXCEPTION 'A whole-day space cannot open a timed session' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_clash
  FROM public.space_sessions
  WHERE space_id = NEW.space_id
    AND session_date = NEW.session_date
    AND id <> NEW.id
    AND starts_at < NEW.ends_at
    AND ends_at > NEW.starts_at
  ORDER BY starts_at
  LIMIT 1;
  IF v_clash.id IS NOT NULL THEN
    RAISE EXCEPTION 'This room already has a session % – % that overlaps',
      to_char(v_clash.starts_at, 'HH24:MI'), to_char(v_clash.ends_at, 'HH24:MI')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Booking rules move from the day to the session
-- ---------------------------------------------------------------------------

ALTER TABLE public.space_bookings DROP CONSTRAINT IF EXISTS space_bookings_one_seat;
DROP INDEX IF EXISTS public.space_bookings_seat_day_idx;

-- Whole-day spaces: one chair per date, one booking per person per date.
CREATE UNIQUE INDEX IF NOT EXISTS space_bookings_seat_day_idx
  ON public.space_bookings (space_id, booking_date, seat_id)
  WHERE seat_id IS NOT NULL AND session_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS space_bookings_one_seat_day_idx
  ON public.space_bookings (space_id, booking_date, profile_id)
  WHERE session_id IS NULL;

-- Timed spaces: one chair per session, one booking per person per session — the same person may
-- sit in the same room in the morning and again in the afternoon.
CREATE UNIQUE INDEX IF NOT EXISTS space_bookings_seat_session_idx
  ON public.space_bookings (session_id, seat_id)
  WHERE seat_id IS NOT NULL AND session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS space_bookings_one_seat_session_idx
  ON public.space_bookings (session_id, profile_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.space_bookings.session_id IS
  'The session a timed booking belongs to; NULL for whole-day spaces. Capacity and chair rules apply per session.';

CREATE OR REPLACE FUNCTION public.enforce_space_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_space public.spaces;
  v_mode TEXT;
  v_taken INTEGER;
BEGIN
  -- Serialise concurrent bookings on the same space: the count below must not race.
  SELECT * INTO v_space FROM public.spaces WHERE id = NEW.space_id FOR UPDATE;
  IF v_space.id IS NULL THEN
    RAISE EXCEPTION 'Space % does not exist', NEW.space_id;
  END IF;
  IF NOT v_space.active THEN
    RAISE EXCEPTION 'This space is no longer bookable' USING ERRCODE = 'check_violation';
  END IF;

  SELECT booking_mode INTO v_mode FROM public.space_types WHERE id = v_space.type_id;

  IF v_mode = 'whole_day' THEN
    IF NEW.session_id IS NOT NULL THEN
      RAISE EXCEPTION 'A whole-day space cannot hold a timed session' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.seat_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.space_seats
        WHERE id = NEW.seat_id AND space_id = NEW.space_id AND active
      ) THEN
        RAISE EXCEPTION 'That seat is not part of this room' USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.space_bookings
        WHERE space_id = NEW.space_id AND booking_date = NEW.booking_date
          AND seat_id = NEW.seat_id AND id <> NEW.id
      ) THEN
        RAISE EXCEPTION 'That seat has just been taken' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    SELECT COUNT(*) INTO v_taken
    FROM public.space_bookings
    WHERE space_id = NEW.space_id AND booking_date = NEW.booking_date AND id <> NEW.id;
    IF v_taken >= v_space.capacity THEN
      RAISE EXCEPTION 'This space is already fully booked for that day (% of % seats)', v_taken, v_space.capacity
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.session_id IS NULL THEN
      RAISE EXCEPTION 'A time-range space must be booked into a session' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.space_sessions
      WHERE id = NEW.session_id AND space_id = NEW.space_id AND session_date = NEW.booking_date
    ) THEN
      RAISE EXCEPTION 'The session does not belong to this space and date' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.seat_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.space_seats
        WHERE id = NEW.seat_id AND space_id = NEW.space_id AND active
      ) THEN
        RAISE EXCEPTION 'That seat is not part of this room' USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.space_bookings
        WHERE session_id = NEW.session_id AND seat_id = NEW.seat_id AND id <> NEW.id
      ) THEN
        RAISE EXCEPTION 'That seat has just been taken for this session' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    SELECT COUNT(*) INTO v_taken
    FROM public.space_bookings
    WHERE session_id = NEW.session_id AND id <> NEW.id;
    IF v_taken >= v_space.capacity THEN
      RAISE EXCEPTION 'This session is already full (% of % seats)', v_taken, v_space.capacity
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_space_booking() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_space_session() FROM PUBLIC, anon, authenticated;

-- Live sync already covers both tables; the seats of a session simply arrive as booking rows.
