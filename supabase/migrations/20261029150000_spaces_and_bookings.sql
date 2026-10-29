-- ==============================================================================
-- Spaces & seat booking.
--
-- A *space* is a bookable room (desk area, conference room, pod). Its *type* decides
-- how it is booked:
--   • whole_day  — a booking covers the date; up to `capacity` people share the space.
--   • time_range — the first booking of the day opens a session (start, end, title) and
--                  everyone else joins that session; `capacity` caps the seats in it.
--
-- Capacity is enforced by a trigger, not by the UI: two people pressing "Book" at the
-- same moment are serialised on the space row, so a room can never be overbooked.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.space_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  booking_mode TEXT NOT NULL DEFAULT 'whole_day'
    CHECK (booking_mode IN ('whole_day', 'time_range')),
  color TEXT NOT NULL DEFAULT '#2f6fa3',
  sort_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.space_types IS
  'Bookable room kinds (desk area, conference room, pod). booking_mode decides whole-day seats vs. time-range sessions.';

CREATE TABLE IF NOT EXISTS public.spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  type_id UUID NOT NULL REFERENCES public.space_types(id) ON DELETE RESTRICT,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  location TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.spaces IS
  'A declarable, bookable room. capacity = how many people (seats) it holds.';

-- One session per space per day: whoever books first defines the window, everyone else joins.
CREATE TABLE IF NOT EXISTS public.space_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  title TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT space_sessions_window CHECK (ends_at > starts_at),
  CONSTRAINT space_sessions_one_per_day UNIQUE (space_id, session_date)
);

COMMENT ON TABLE public.space_sessions IS
  'The time window the first booker defined for a time_range space on a given day.';

CREATE TABLE IF NOT EXISTS public.space_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.space_sessions(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT space_bookings_one_seat UNIQUE (space_id, booking_date, profile_id)
);

COMMENT ON TABLE public.space_bookings IS
  'A seat held by one person in one space on one date (session_id is set for time_range spaces).';

CREATE INDEX IF NOT EXISTS space_bookings_space_date_idx ON public.space_bookings (space_id, booking_date);
CREATE INDEX IF NOT EXISTS space_bookings_profile_date_idx ON public.space_bookings (profile_id, booking_date);
CREATE INDEX IF NOT EXISTS spaces_type_idx ON public.spaces (type_id);

-- ---------------------------------------------------------------------------
-- Capacity + session rules
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER: the row lock and the seat count must see the space and every booking, which
-- RLS would hide from the employee doing the booking (a `SELECT ... FOR UPDATE` only locks rows the
-- caller may update, so an employee's own booking would look like a missing space).
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

DROP TRIGGER IF EXISTS space_bookings_enforce ON public.space_bookings;
CREATE TRIGGER space_bookings_enforce
  BEFORE INSERT OR UPDATE ON public.space_bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_space_booking();

/** Sessions only exist for time-range spaces, and only one per space/day. */
CREATE OR REPLACE FUNCTION public.validate_space_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS space_sessions_validate ON public.space_sessions;
CREATE TRIGGER space_sessions_validate
  BEFORE INSERT OR UPDATE ON public.space_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_space_session();

/**
 * An empty session would block its room for the rest of the day, so the last seat leaving
 * closes the session. SECURITY DEFINER: the person cancelling only holds a booking delete right.
 */
CREATE OR REPLACE FUNCTION public.close_empty_space_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.space_bookings WHERE session_id = OLD.session_id
  ) THEN
    DELETE FROM public.space_sessions WHERE id = OLD.session_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS space_bookings_close_session ON public.space_bookings;
CREATE TRIGGER space_bookings_close_session
  AFTER DELETE ON public.space_bookings
  FOR EACH ROW EXECUTE FUNCTION public.close_empty_space_session();

-- Trigger functions run as the table owner; nobody needs EXECUTE, so the RPC surface stays closed.
REVOKE EXECUTE ON FUNCTION public.enforce_space_booking() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_space_session() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_empty_space_session() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.space_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS space_types_read ON public.space_types;
CREATE POLICY space_types_read ON public.space_types FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS space_types_admin ON public.space_types;
CREATE POLICY space_types_admin ON public.space_types FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS spaces_read ON public.spaces;
CREATE POLICY spaces_read ON public.spaces FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS spaces_admin ON public.spaces;
CREATE POLICY spaces_admin ON public.spaces FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS space_sessions_read ON public.space_sessions;
CREATE POLICY space_sessions_read ON public.space_sessions FOR SELECT TO authenticated USING (TRUE);
-- Anyone may open the session for the day; only an admin may remove one outright.
DROP POLICY IF EXISTS space_sessions_insert ON public.space_sessions;
CREATE POLICY space_sessions_insert ON public.space_sessions FOR INSERT TO authenticated
  WITH CHECK (created_by IS NULL OR created_by = public.current_profile_id());
DROP POLICY IF EXISTS space_sessions_admin_delete ON public.space_sessions;
CREATE POLICY space_sessions_admin_delete ON public.space_sessions FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS space_bookings_read ON public.space_bookings;
CREATE POLICY space_bookings_read ON public.space_bookings FOR SELECT TO authenticated USING (TRUE);
-- Employees book their own seat; admins may book for a colleague.
DROP POLICY IF EXISTS space_bookings_insert ON public.space_bookings;
CREATE POLICY space_bookings_insert ON public.space_bookings FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id() OR public.is_admin());
DROP POLICY IF EXISTS space_bookings_delete ON public.space_bookings;
CREATE POLICY space_bookings_delete ON public.space_bookings FOR DELETE TO authenticated
  USING (profile_id = public.current_profile_id() OR public.is_admin());
DROP POLICY IF EXISTS space_bookings_update ON public.space_bookings;
CREATE POLICY space_bookings_update ON public.space_bookings FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id() OR public.is_admin())
  WITH CHECK (profile_id = public.current_profile_id() OR public.is_admin());

-- Live sync: a booked seat must appear on everyone's screen without a refresh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.space_types;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.spaces;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.space_sessions;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.space_bookings;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Starter catalogue — rename, retype or delete these in Settings → Spaces.
-- ---------------------------------------------------------------------------

INSERT INTO public.space_types (name, booking_mode, color, sort_order)
VALUES
  ('Working space', 'whole_day', '#2f6fa3', 10),
  ('Conference room', 'time_range', '#a21caf', 20),
  ('Meeting pod', 'time_range', '#0d9488', 30)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.spaces (name, type_id, capacity, location, notes)
SELECT v.name, t.id, v.capacity, v.location, v.notes
FROM (VALUES
  ('Desks · Floor 2', 'Working space', 12, 'Floor 2', 'Open desk area'),
  ('Conference room A', 'Conference room', 8, 'Floor 2', 'Screen + video conference'),
  ('Phone pod 1', 'Meeting pod', 1, 'Floor 2', 'Single-occupancy calls')
) AS v(name, type_name, capacity, location, notes)
JOIN public.space_types t ON t.name = v.type_name
ON CONFLICT (name) DO NOTHING;
