-- ---------------------------------------------------------------------------
-- Inviting people to a conference-room session
--
-- Whoever opens a session (or an administrator) may invite colleagues and external guests while
-- creating it, and later. An Orbit user is invited through Slack (a direct message) and, when the
-- organiser ticks the box, also through an Outlook meeting invite. An address that is not an Orbit
-- user can only be reached by email, so it is always carried by the Outlook invite.
--
-- The row keeps what was attempted per recipient, so the organiser can see who actually got the
-- message instead of a silent "sent". Delivery itself happens in /api/spaces/session-invites with
-- the service role; employees only read the list.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.space_session_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.space_sessions(id) ON DELETE CASCADE,
  /** The signed-in person who sent the invite (a session creator or an administrator). */
  invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  /** Set when the address belongs to an Orbit user; NULL for an external guest. */
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  name TEXT,
  /** 'sent' | 'failed' | 'skipped' — skipped when that channel does not apply to the recipient. */
  slack_status TEXT NOT NULL DEFAULT 'skipped'
    CHECK (slack_status IN ('sent', 'failed', 'skipped')),
  outlook_status TEXT NOT NULL DEFAULT 'skipped'
    CHECK (outlook_status IN ('sent', 'failed', 'skipped')),
  slack_error TEXT,
  outlook_error TEXT,
  /** The Graph event carrying the meeting invite, kept so it can be cancelled with the session. */
  outlook_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.space_session_invites IS
  'One invitation to a timed session. Orbit users are reached on Slack; every address may carry an Outlook meeting invite.';

CREATE INDEX IF NOT EXISTS space_session_invites_session_idx
  ON public.space_session_invites (session_id);

-- Inviting the same address twice to one session is one invitation, not two messages. Addresses are
-- normalised to lowercase by the API before they reach this table, so every re-invite upserts.
CREATE UNIQUE INDEX IF NOT EXISTS space_session_invites_session_email_idx
  ON public.space_session_invites (session_id, email);

ALTER TABLE public.space_session_invites ENABLE ROW LEVEL SECURITY;

-- The room shows who was invited to a session, exactly like it shows who holds a seat.
DROP POLICY IF EXISTS space_session_invites_read ON public.space_session_invites;
CREATE POLICY space_session_invites_read ON public.space_session_invites
  FOR SELECT TO authenticated USING (TRUE);

-- No INSERT/UPDATE/DELETE policy on purpose: invites are written by the API route with the
-- service role, which is also the only place that holds the Slack bot and Graph credentials.

-- Live sync: an invite sent from another browser must land on everyone's room card.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.space_session_invites;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
