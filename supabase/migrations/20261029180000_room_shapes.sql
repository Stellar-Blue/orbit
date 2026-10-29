-- ==============================================================================
-- Room shapes.
--
-- Not every room is a rectangle: a wing that wraps a corner, a meeting room that
-- steps around a core. An L-shaped room is the bounding box minus one corner, so it
-- needs three extra numbers next to the width and depth it already has.
-- ==============================================================================

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS room_shape TEXT NOT NULL DEFAULT 'rect'
    CHECK (room_shape IN ('rect', 'l')),
  ADD COLUMN IF NOT EXISTS notch_width NUMERIC NOT NULL DEFAULT 0 CHECK (notch_width >= 0),
  ADD COLUMN IF NOT EXISTS notch_depth NUMERIC NOT NULL DEFAULT 0 CHECK (notch_depth >= 0),
  ADD COLUMN IF NOT EXISTS notch_corner TEXT NOT NULL DEFAULT 'ne'
    CHECK (notch_corner IN ('nw', 'ne', 'sw', 'se'));

COMMENT ON COLUMN public.spaces.room_shape IS
  'Footprint of the room on the floor plan: a plain rectangle, or an L with one corner cut away.';
COMMENT ON COLUMN public.spaces.notch_width IS
  'Width of the missing corner of an L-shaped room, in metres. Ignored for rectangles.';
COMMENT ON COLUMN public.spaces.notch_depth IS
  'Depth of the missing corner of an L-shaped room, in metres. Ignored for rectangles.';
COMMENT ON COLUMN public.spaces.notch_corner IS
  'Which corner of the bounding box an L-shaped room is missing.';

-- The notch can never be as big as the room it is cut from.
ALTER TABLE public.spaces
  DROP CONSTRAINT IF EXISTS spaces_notch_smaller_than_room;
ALTER TABLE public.spaces
  ADD CONSTRAINT spaces_notch_smaller_than_room
  CHECK (room_shape = 'rect' OR (notch_width <= room_width - 1 AND notch_depth <= room_depth - 1));
