-- ==============================================================================
-- Office floor plans.
--
-- The 3D view needs geometry the booking tables never carried: where a room sits
-- on the floor, how big it is, and where the seats inside it are. Rooms keep their
-- `capacity` (the booking limit) and gain a rectangle on a floor; seats are real
-- rows, so a booking can name the chair it takes.
--
-- Coordinates are metres on a right-handed floor plane: X to the east, Z to the
-- south, Y up. Seat X/Z are relative to the room's centre so moving a room moves
-- its seats.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.office_floors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  width NUMERIC NOT NULL DEFAULT 24 CHECK (width > 0),
  depth NUMERIC NOT NULL DEFAULT 16 CHECK (depth > 0),
  sort_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.office_floors IS
  'A floor (or office) the 3D plan draws. Rooms hang off exactly one floor.';

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS floor_id UUID REFERENCES public.office_floors(id) ON DELETE SET NULL,
  -- centre of the room on the floor, in metres
  ADD COLUMN IF NOT EXISTS pos_x NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pos_z NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS room_width NUMERIC NOT NULL DEFAULT 4 CHECK (room_width > 0),
  ADD COLUMN IF NOT EXISTS room_depth NUMERIC NOT NULL DEFAULT 3.5 CHECK (room_depth > 0),
  ADD COLUMN IF NOT EXISTS room_height NUMERIC NOT NULL DEFAULT 2.6 CHECK (room_height > 0),
  ADD COLUMN IF NOT EXISTS rotation NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.spaces.pos_x IS 'Room centre on the floor plan, metres east of the floor origin.';
COMMENT ON COLUMN public.spaces.pos_z IS 'Room centre on the floor plan, metres south of the floor origin.';

CREATE TABLE IF NOT EXISTS public.space_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  label TEXT,
  -- relative to the room centre, so moving or resizing a room keeps its seats inside
  x NUMERIC NOT NULL DEFAULT 0,
  z NUMERIC NOT NULL DEFAULT 0,
  rotation NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.space_seats IS
  'A chair drawn inside a room. Optional on a booking — a seat can be booked once per room per day.';

CREATE INDEX IF NOT EXISTS space_seats_space_idx ON public.space_seats (space_id);
CREATE INDEX IF NOT EXISTS spaces_floor_idx ON public.spaces (floor_id);

ALTER TABLE public.space_bookings
  ADD COLUMN IF NOT EXISTS seat_id UUID REFERENCES public.space_seats(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS space_bookings_seat_day_idx
  ON public.space_bookings (space_id, booking_date, seat_id)
  WHERE seat_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Seat validation joins the capacity trigger
-- ---------------------------------------------------------------------------

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
  SELECT * INTO v_space FROM public.spaces WHERE id = NEW.space_id FOR UPDATE;
  IF v_space.id IS NULL THEN
    RAISE EXCEPTION 'Space % does not exist', NEW.space_id;
  END IF;
  IF NOT v_space.active THEN
    RAISE EXCEPTION 'This space is no longer bookable' USING ERRCODE = 'check_violation';
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

REVOKE EXECUTE ON FUNCTION public.enforce_space_booking() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.office_floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_seats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS office_floors_read ON public.office_floors;
CREATE POLICY office_floors_read ON public.office_floors FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS office_floors_admin ON public.office_floors;
CREATE POLICY office_floors_admin ON public.office_floors FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS space_seats_read ON public.space_seats;
CREATE POLICY space_seats_read ON public.space_seats FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS space_seats_admin ON public.space_seats;
CREATE POLICY space_seats_admin ON public.space_seats FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.office_floors;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.space_seats;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Default plan: put the seeded rooms on a floor and lay their seats out.
-- ---------------------------------------------------------------------------

INSERT INTO public.office_floors (name, width, depth, sort_order)
VALUES ('Floor 2', 24, 16, 10)
ON CONFLICT (name) DO NOTHING;

UPDATE public.spaces s
SET floor_id = f.id,
    pos_x = v.pos_x,
    pos_z = v.pos_z,
    room_width = v.w,
    room_depth = v.d,
    room_height = 2.6
FROM public.office_floors f,
  (VALUES
    ('Desks · Floor 2', -5.0, -3.0, 10.0, 6.0),
    ('Conference room A', 5.0, -3.5, 7.0, 5.0),
    ('Phone pod 1', 8.5, 4.0, 2.2, 2.2)
  ) AS v(name, pos_x, pos_z, w, d)
WHERE f.name = 'Floor 2'
  AND s.name = v.name
  AND s.floor_id IS NULL;

-- A seat grid per room, matching its capacity. Existing seats are left untouched.
DO $$
DECLARE
  room RECORD;
  cols INTEGER;
  rows INTEGER;
  i INTEGER;
  sx NUMERIC;
  sz NUMERIC;
BEGIN
  FOR room IN SELECT * FROM public.spaces WHERE floor_id IS NOT NULL LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.space_seats WHERE space_id = room.id);

    cols := GREATEST(1, LEAST(room.capacity, CEIL(SQRT(room.capacity * room.room_width / GREATEST(room.room_depth, 0.5)))::INTEGER));
    rows := GREATEST(1, CEIL(room.capacity::NUMERIC / cols)::INTEGER);

    FOR i IN 0..room.capacity - 1 LOOP
      sx := ((i % cols) + 0.5) / cols * room.room_width - room.room_width / 2;
      sz := (FLOOR(i::NUMERIC / cols) + 0.5) / rows * room.room_depth - room.room_depth / 2;
      INSERT INTO public.space_seats (space_id, label, x, z)
      VALUES (room.id, 'S' || (i + 1), ROUND(sx, 2), ROUND(sz, 2));
    END LOOP;
  END LOOP;
END $$;
