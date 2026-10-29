-- ==============================================================================
-- Desks inside a room.
--
-- A whole-day area needs the furniture to look like a real floor: desk runs along a
-- wall, single desks, a bigger shared table. A desk is pure furniture — it holds no
-- booking, it is not a seat — so it is a row with a footprint, a rotation and an
-- optional chair that sits at it.
--
-- Coordinates match `space_seats`: metres, relative to the room's centre, X east and
-- Z south, so dragging or resizing the room carries its desks along.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.space_desks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  label TEXT,
  description TEXT,
  -- centre of the desk relative to the room centre
  x NUMERIC NOT NULL DEFAULT 0,
  z NUMERIC NOT NULL DEFAULT 0,
  width NUMERIC NOT NULL DEFAULT 1.4 CHECK (width > 0.3),
  depth NUMERIC NOT NULL DEFAULT 0.7 CHECK (depth > 0.3),
  rotation NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.space_desks IS
  'A desk drawn inside a room. Furniture only: seats are booked, desks are not.';

CREATE INDEX IF NOT EXISTS space_desks_space_idx ON public.space_desks (space_id);

-- ---------------------------------------------------------------------------
-- Row level security: everyone reads the plan, admins draw it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.space_desks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS space_desks_read ON public.space_desks;
CREATE POLICY space_desks_read ON public.space_desks FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS space_desks_admin ON public.space_desks;
CREATE POLICY space_desks_admin ON public.space_desks FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.space_desks;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Default plan: a desk in front of every chair of a whole-day area, so the seeded
-- floor keeps looking furnished until an admin edits it.
-- ---------------------------------------------------------------------------

INSERT INTO public.space_desks (space_id, label, x, z, width, depth, rotation)
SELECT
  s.id,
  'Desk ' || row_number() OVER (PARTITION BY s.id ORDER BY se.label),
  se.x,
  se.z - 0.72,
  1.4,
  0.7,
  se.rotation
FROM public.space_seats se
JOIN public.spaces s ON s.id = se.space_id
JOIN public.space_types t ON t.id = s.type_id
WHERE t.booking_mode = 'whole_day'
  AND se.active
  AND NOT EXISTS (SELECT 1 FROM public.space_desks d WHERE d.space_id = se.space_id);
