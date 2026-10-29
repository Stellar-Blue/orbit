-- A whole-day space fills the person's whole day, so a person holds at most one of them per date —
-- whichever workspace it is in. Meeting rooms are unaffected: their bookings carry a session and a
-- person may sit in the same room several times a day.
--
-- Rows created before this rule may already break it (someone took a desk in two workspaces), so the
-- older duplicate is dropped before the index is built: the newest booking is the one that stands.

DELETE FROM public.space_bookings older
WHERE older.session_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.space_bookings newer
    WHERE newer.profile_id = older.profile_id
      AND newer.booking_date = older.booking_date
      AND newer.session_id IS NULL
      AND (newer.created_at, newer.id) > (older.created_at, older.id)
  );

DROP INDEX IF EXISTS public.space_bookings_one_seat_day_idx;

CREATE UNIQUE INDEX IF NOT EXISTS space_bookings_one_seat_day_idx
  ON public.space_bookings (profile_id, booking_date)
  WHERE session_id IS NULL;

COMMENT ON INDEX public.space_bookings_one_seat_day_idx IS
  'One whole-day seat per person per date; session bookings are excluded and limited per session.';
