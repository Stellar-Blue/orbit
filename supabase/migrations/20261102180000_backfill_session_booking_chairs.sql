-- ---------------------------------------------------------------------------
-- Give every booked seat a chair
--
-- Invitations used to book the seat without picking a chair (they insert the booking straight into
-- `space_bookings` instead of going through the booking dialog). The room counts those people as
-- attending, but the 3D plan draws each person above the chair they took — with `seat_id` NULL the
-- avatar had nowhere to sit and simply never appeared.
--
-- The invite route now assigns a free chair; this backfills the rows created before it did. Rows that
-- are already seated are untouched, so re-running is a no-op, and a room with no drawn chairs keeps
-- its unseated bookings rather than losing them.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  booking RECORD;
  free_chair UUID;
BEGIN
  FOR booking IN
    SELECT b.id, b.space_id, b.session_id, b.booking_date
    FROM public.space_bookings b
    WHERE b.seat_id IS NULL
    ORDER BY b.created_at, b.id
  LOOP
    SELECT s.id INTO free_chair
    FROM public.space_seats s
    WHERE s.space_id = booking.space_id
      AND s.active
      AND NOT EXISTS (
        SELECT 1 FROM public.space_bookings taken
        WHERE taken.space_id = booking.space_id
          AND taken.seat_id = s.id
          AND (
            (booking.session_id IS NOT NULL AND taken.session_id = booking.session_id)
            OR (booking.session_id IS NULL AND taken.session_id IS NULL AND taken.booking_date = booking.booking_date)
          )
      )
    ORDER BY s.created_at, s.id
    LIMIT 1;

    IF free_chair IS NOT NULL THEN
      UPDATE public.space_bookings SET seat_id = free_chair WHERE id = booking.id;
    END IF;
    free_chair := NULL;
  END LOOP;
END $$;
