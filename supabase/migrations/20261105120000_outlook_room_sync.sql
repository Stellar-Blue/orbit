-- ---------------------------------------------------------------------------
-- Outlook room mailboxes and linked sessions
--
-- A conference room can own an Outlook room mailbox. Meetings booked on that mailbox appear in Orbit
-- as sessions (source = 'outlook', managed in Outlook: nobody edits or deletes them here), and
-- sessions opened in Orbit keep pointing at the Outlook meeting that blocks the room.
--
-- The sync itself runs server-side with the service role; these columns hold its state, and the
-- policies below keep the database honest for anything else.
-- ---------------------------------------------------------------------------

-- Room side: mailbox, webhook subscription and sync bookkeeping.
ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS outlook_email TEXT,
  ADD COLUMN IF NOT EXISTS outlook_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS outlook_subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outlook_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outlook_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS outlook_clashes JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS outlook_sync_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outlook_sync_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS spaces_outlook_email_key
  ON public.spaces (lower(outlook_email)) WHERE outlook_email IS NOT NULL;

-- Session side: where the session came from and which Outlook meeting it mirrors.
ALTER TABLE public.space_sessions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'orbit',
  ADD COLUMN IF NOT EXISTS outlook_ical_uid TEXT,
  ADD COLUMN IF NOT EXISTS outlook_series_id TEXT,
  ADD COLUMN IF NOT EXISTS outlook_event_id TEXT;

ALTER TABLE public.space_sessions DROP CONSTRAINT IF EXISTS space_sessions_source_check;
ALTER TABLE public.space_sessions
  ADD CONSTRAINT space_sessions_source_check CHECK (source IN ('orbit', 'outlook'));

CREATE UNIQUE INDEX IF NOT EXISTS space_sessions_outlook_ical_uid_key
  ON public.space_sessions (outlook_ical_uid) WHERE outlook_ical_uid IS NOT NULL;

-- Sessions that already sent an Outlook invite own that meeting: keep the oldest sent event id.
UPDATE public.space_sessions s
SET outlook_event_id = i.outlook_event_id
FROM (
  SELECT DISTINCT ON (session_id) session_id, outlook_event_id
  FROM public.space_session_invites
  WHERE outlook_status = 'sent' AND outlook_event_id IS NOT NULL
  ORDER BY session_id, created_at ASC
) i
WHERE s.id = i.session_id AND s.outlook_event_id IS NULL;

-- Outlook-born sessions are managed in Outlook: no edit or delete for anyone, admins included.
DROP POLICY IF EXISTS space_sessions_update_own ON public.space_sessions;
CREATE POLICY space_sessions_update_own ON public.space_sessions
  FOR UPDATE TO authenticated
  USING (source = 'orbit' AND (created_by = public.current_profile_id() OR public.is_admin()))
  WITH CHECK (source = 'orbit' AND (created_by = public.current_profile_id() OR public.is_admin()));

COMMENT ON POLICY space_sessions_update_own ON public.space_sessions IS
  'The person who opened an Orbit session, or an administrator, may change it. Outlook-born sessions are managed in Outlook.';

DROP POLICY IF EXISTS space_sessions_delete_own ON public.space_sessions;
CREATE POLICY space_sessions_delete_own ON public.space_sessions
  FOR DELETE TO authenticated
  USING (source = 'orbit' AND (created_by = public.current_profile_id() OR public.is_admin()));

COMMENT ON POLICY space_sessions_delete_own ON public.space_sessions IS
  'The person who opened an Orbit session, or an administrator, may delete it and release its seats. Outlook-born sessions are managed in Outlook.';

DROP POLICY IF EXISTS space_sessions_admin_delete ON public.space_sessions;
CREATE POLICY space_sessions_admin_delete ON public.space_sessions FOR DELETE TO authenticated
  USING (source = 'orbit' AND public.is_admin());

-- The last seat leaving closes a session, unless the session is booked in Outlook: the room is still
-- blocked there, and deleting it would only have the next sync import it again.
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
    DELETE FROM public.space_sessions
    WHERE id = OLD.session_id
      AND NOT EXISTS (
        SELECT 1 FROM public.space_sessions s
        WHERE s.id = OLD.session_id AND (s.source = 'outlook' OR s.outlook_event_id IS NOT NULL)
      );
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_empty_space_session() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.spaces.outlook_email IS
  'Room mailbox (lowercased) whose Outlook meetings sync with this room''s sessions. Unique across rooms.';
COMMENT ON COLUMN public.spaces.outlook_subscription_id IS
  'Microsoft Graph webhook subscription watching the room mailbox calendar.';
COMMENT ON COLUMN public.spaces.outlook_subscription_expires_at IS
  'When the Graph subscription lapses and must be renewed.';
COMMENT ON COLUMN public.spaces.outlook_synced_at IS
  'Last time a sync of the room mailbox finished successfully.';
COMMENT ON COLUMN public.spaces.outlook_sync_error IS
  'Readable reason the last sync failed; NULL when it succeeded.';
COMMENT ON COLUMN public.spaces.outlook_clashes IS
  'Outlook meetings that could not be mirrored (overlapping Orbit sessions, moved days), as RoomClash objects.';
COMMENT ON COLUMN public.spaces.outlook_sync_started_at IS
  'Claim for a running sync of this room; a stale value means the run died.';
COMMENT ON COLUMN public.spaces.outlook_sync_pending IS
  'A notification arrived while a sync was running; one more run is needed.';
COMMENT ON COLUMN public.space_sessions.source IS
  '''orbit'' = opened in Orbit; ''outlook'' = imported from the room mailbox and managed in Outlook.';
COMMENT ON COLUMN public.space_sessions.outlook_ical_uid IS
  'iCalUId of the Outlook occurrence an outlook-born session mirrors.';
COMMENT ON COLUMN public.space_sessions.outlook_series_id IS
  'Outlook series master id when the occurrence belongs to a recurring meeting.';
COMMENT ON COLUMN public.space_sessions.outlook_event_id IS
  'Outlook event this session owns (the invite Orbit sent, or the imported occurrence); such sessions survive their last seat leaving.';
