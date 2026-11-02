-- ---------------------------------------------------------------------------
-- Editing a conference-room session
--
-- A session is a small meeting: its time, title and description can change, and the organiser may
-- add or remove people. Until now only INSERT and DELETE were allowed, so an organiser had to delete
-- the session (losing its seats) to fix a typo in the window.
--
-- The rule is the same one the delete button already uses: whoever opened the session, or an
-- administrator. The API route writes with the service role (it is also the only place that can
-- patch the Outlook meeting), this policy keeps the database honest for anything else.
-- ---------------------------------------------------------------------------

ALTER TABLE public.space_sessions ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN public.space_sessions.description IS
  'Free-text agenda shown to the people invited to the session.';

DROP POLICY IF EXISTS space_sessions_update_own ON public.space_sessions;
CREATE POLICY space_sessions_update_own ON public.space_sessions
  FOR UPDATE TO authenticated
  USING (created_by = public.current_profile_id() OR public.is_admin())
  WITH CHECK (created_by = public.current_profile_id() OR public.is_admin());

COMMENT ON POLICY space_sessions_update_own ON public.space_sessions IS
  'The person who opened a session, or an administrator, may change its window, title and description.';
