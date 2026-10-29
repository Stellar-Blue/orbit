-- ==============================================================================
-- Furniture detail.
--
-- Three small things a real floor plan needs: a desk may or may not carry a screen,
-- the wall screen of a meeting room belongs on a wall you choose rather than always the
-- north one, and a workstation (a desk with its chair) is placed as one object.
--
-- The floor size already lives on office_floors; nothing here changes its shape.
-- ==============================================================================

ALTER TABLE public.space_desks
  ADD COLUMN IF NOT EXISTS has_monitor BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.space_desks.has_monitor IS
  'Whether the desk is drawn with a screen and keyboard. Shared tables usually have neither.';

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS screen_wall TEXT NOT NULL DEFAULT 'none'
    CHECK (screen_wall IN ('none', 'n', 's', 'w', 'e'));

COMMENT ON COLUMN public.spaces.screen_wall IS
  'Wall a meeting room''s screen hangs on. `none` draws no screen.';

-- The seeded desks all have a screen, matching the previous look.
UPDATE public.space_desks SET has_monitor = TRUE WHERE has_monitor IS NULL;
