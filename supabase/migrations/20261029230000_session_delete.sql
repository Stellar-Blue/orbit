-- Taking a session back. Admins could already remove one; the person who opened it should be able to
-- as well, so a session created by mistake does not need an administrator. The bookings of a session
-- cascade with it (space_bookings.session_id is ON DELETE CASCADE), so its seats are released too.
DROP POLICY IF EXISTS space_sessions_delete_own ON public.space_sessions;

CREATE POLICY space_sessions_delete_own ON public.space_sessions
  FOR DELETE TO authenticated
  USING (created_by = current_profile_id() OR is_admin());

COMMENT ON POLICY space_sessions_delete_own ON public.space_sessions IS
  'The person who opened a session, or an administrator, may delete it and release its seats.';
