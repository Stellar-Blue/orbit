import type { SupabaseClient } from '@supabase/supabase-js';
import { ATHENS_TIMEZONE } from '@/lib/integrations/types';
import { syncSessionCalendarInvite } from '@/lib/integrations/outlook';

/**
 * Server-side session context shared by the invite and edit routes.
 *
 * Both routes need the same three things before they can talk to Slack or Graph: the session being
 * changed, the room it sits in, and the organiser whose calendar carries the meeting. Keeping that
 * lookup here means the same authorisation inputs and the same meeting payload are built one way.
 */

export interface SessionContext {
  id: string;
  spaceId: string;
  sessionDate: string;
  /** `HH:MM:SS` from Postgres. */
  startsAt: string;
  endsAt: string;
  title?: string | null;
  description?: string | null;
  createdBy?: string | null;
  roomName: string;
  roomLocation?: string | null;
  organizer: { profileId: string; email: string; name: string } | null;
}

export const clock = (value: string): string => String(value || '').slice(0, 5);

export const longDate = (dateStr: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ATHENS_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${dateStr}T12:00:00Z`));

export const sessionWhen = (context: Pick<SessionContext, 'sessionDate' | 'startsAt' | 'endsAt'>): string =>
  `${longDate(context.sessionDate)} · ${clock(context.startsAt)} – ${clock(context.endsAt)}`;

const personName = (profile?: { first_name?: string | null; last_name?: string | null; work_email?: string | null } | null): string =>
  [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || profile?.work_email || 'An Orbit colleague';

export async function loadSessionContext(
  admin: SupabaseClient,
  sessionId: string,
  fallbackProfileId: string
): Promise<SessionContext | null> {
  const { data: sessionRow } = await admin
    .from('space_sessions')
    .select('id, space_id, session_date, starts_at, ends_at, title, description, created_by')
    .eq('id', sessionId)
    .maybeSingle();
  if (!sessionRow) return null;

  const [{ data: spaceRow }, { data: organizerRow }] = await Promise.all([
    admin.from('spaces').select('id, name, location').eq('id', sessionRow.space_id).maybeSingle(),
    admin
      .from('profiles')
      .select('id, first_name, last_name, work_email')
      .eq('id', sessionRow.created_by || fallbackProfileId)
      .maybeSingle(),
  ]);

  return {
    id: sessionRow.id,
    spaceId: sessionRow.space_id,
    sessionDate: sessionRow.session_date,
    startsAt: sessionRow.starts_at,
    endsAt: sessionRow.ends_at,
    title: sessionRow.title,
    description: sessionRow.description,
    createdBy: sessionRow.created_by,
    roomName: spaceRow?.name || 'the meeting room',
    roomLocation: spaceRow?.location || null,
    organizer: organizerRow?.work_email
      ? { profileId: organizerRow.id, email: organizerRow.work_email, name: personName(organizerRow) }
      : null,
  };
}

/**
 * The one Outlook meeting a session owns, and the addresses currently on it. The newest code path
 * patches that same event, so a session never accumulates a meeting per invite batch.
 */
export async function calendarStateOf(
  admin: SupabaseClient,
  sessionId: string
): Promise<{ eventId: string | null; attendees: string[] }> {
  const { data } = await admin
    .from('space_session_invites')
    .select('email, outlook_event_id')
    .eq('session_id', sessionId)
    .eq('outlook_status', 'sent')
    .not('outlook_event_id', 'is', null)
    .order('created_at');
  const rows = (data || []) as { email: string; outlook_event_id: string }[];
  const eventId = rows[0]?.outlook_event_id || null;
  if (!eventId) return { eventId: null, attendees: [] };
  const attendees = Array.from(new Set(
    rows.filter(row => row.outlook_event_id === eventId).map(row => row.email)
  ));
  return { eventId, attendees };
}

/** Creates, patches or cancels the session's meeting so it always mirrors Orbit. */
export async function syncSessionCalendar(args: {
  admin: SupabaseClient;
  context: SessionContext;
  attendees: string[];
  eventId?: string | null;
}): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  const details = {
    organizerName: args.context.organizer?.name || 'An Orbit colleague',
    roomName: args.context.roomName,
    roomLocation: args.context.roomLocation,
    sessionDate: args.context.sessionDate,
    startsAt: args.context.startsAt,
    endsAt: args.context.endsAt,
    title: args.context.title,
    description: args.context.description,
    attendees: Array.from(new Set(args.attendees)),
  };
  if (!args.context.organizer?.email) {
    if (details.attendees.length === 0) return { ok: true };
    return { ok: false, error: 'The organiser has no work email, so no calendar invite could be sent.' };
  }
  return syncSessionCalendarInvite({
    admin: args.admin,
    organizerProfileId: args.context.organizer.profileId,
    organizerEmail: args.context.organizer.email,
    details,
    existingEventId: args.eventId || null,
  });
}
