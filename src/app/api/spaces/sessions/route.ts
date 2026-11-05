import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, hasSlackBotToken, slackSendDirectMessage } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import {
  calendarStateOf, clock, loadSessionContext, OUTLOOK_MANAGED_ERROR, sessionShareUrl, sessionWhen, syncSessionCalendar,
} from '@/lib/spaces-server';
import { clockLabel, overlappingSession, sessionLabel, validateSessionWindow } from '@/lib/spaces';

/**
 * Editing a session that already exists — its window, title and description.
 *
 * Only the person who opened the session, or an administrator, may do it (the same rule as deleting
 * or inviting). Two things ride along with the database update:
 *   • the Outlook meeting is patched, so every attendee's calendar moves with the session — Graph
 *     sends the "updated meeting" notice itself;
 *   • colleagues invited on Slack get a short message when the window actually moved, because a
 *     Slack invitation has no calendar behind it.
 */

interface EditRequest {
  session_id?: string;
  starts_at?: string;
  ends_at?: string;
  title?: string | null;
  description?: string | null;
}

export async function PATCH(request: NextRequest) {
  const caller = await requireApiSession(request);
  if (isNextResponse(caller)) return caller;

  const body = await request.json().catch(() => null) as EditRequest | null;
  const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
  if (!sessionId) return NextResponse.json({ error: 'session_id is required' }, { status: 400 });

  const admin = getAdminClient();
  const context = await loadSessionContext(admin, sessionId, caller.profileId);
  if (!context) return NextResponse.json({ error: 'That session no longer exists.' }, { status: 404 });
  if (context.source === 'outlook') return NextResponse.json({ error: OUTLOOK_MANAGED_ERROR }, { status: 403 });
  if (!caller.isAdmin && context.createdBy !== caller.profileId) {
    return NextResponse.json(
      { error: 'Only the person who opened this session, or an administrator, can edit it.' },
      { status: 403 }
    );
  }

  const startsAt = clockLabel(body?.starts_at || context.startsAt);
  const endsAt = clockLabel(body?.ends_at || context.endsAt);
  const invalid = validateSessionWindow(startsAt, endsAt);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  // A room cannot be in two meetings at once. The database trigger refuses the overlap too, this
  // answers with the session that is in the way.
  const { data: sameDay } = await admin
    .from('space_sessions')
    .select('id, starts_at, ends_at')
    .eq('space_id', context.spaceId)
    .eq('session_date', context.sessionDate)
    .neq('id', sessionId);
  const clash = overlappingSession(
    (sameDay || []) as { id: string; starts_at: string; ends_at: string }[],
    { startsAt, endsAt }
  );
  if (clash) {
    return NextResponse.json(
      { error: `${context.roomName} already has a session ${sessionLabel(clash)}. Pick a window that does not overlap.` },
      { status: 409 }
    );
  }

  const title = typeof body?.title === 'string' ? body.title.trim() || null : context.title || null;
  const description = typeof body?.description === 'string'
    ? body.description.trim() || null
    : context.description || null;

  const { error: updateError } = await admin
    .from('space_sessions')
    .update({ starts_at: `${startsAt}:00`, ends_at: `${endsAt}:00`, title, description })
    .eq('id', sessionId);
  if (updateError) {
    const readable = updateError.code === '23505'
      ? `${context.roomName} already has a session starting at ${startsAt}.`
      : updateError.message;
    return NextResponse.json({ error: readable }, { status: 400 });
  }

  const updated = { ...context, startsAt: `${startsAt}:00`, endsAt: `${endsAt}:00`, title, description };
  const windowMoved = clock(context.startsAt) !== startsAt || clock(context.endsAt) !== endsAt;

  // The meeting is patched whether or not the time moved: a new title or agenda should reach the
  // people who already accepted it.
  const calendar = await calendarStateOf(admin, sessionId);
  let calendarError: string | undefined;
  let outlookEventId = calendar.eventId;
  if (calendar.eventId || calendar.attendees.length > 0 || context.roomMailbox) {
    const synced = await syncSessionCalendar({
      admin, context: updated, attendees: calendar.attendees, eventId: calendar.eventId,
    });
    if (synced.ok) outlookEventId = synced.eventId || calendar.eventId;
    else calendarError = synced.error;
  }

  // A Slack invitation has no calendar: whoever was reached there has to hear about a move directly.
  let notified = 0;
  if (windowMoved && hasSlackBotToken()) {
    const { data: invited } = await admin
      .from('space_session_invites')
      .select('email, profile_id')
      .eq('session_id', sessionId)
      .eq('slack_status', 'sent')
      .not('profile_id', 'is', null);
    const when = sessionWhen(updated);
    const link = sessionShareUrl(sessionId);
    for (const row of (invited || []) as { email: string }[]) {
      const sent = await slackSendDirectMessage({
        email: row.email,
        text: [
          `:alarm_clock: *${title?.trim() || 'Meeting'}* in *${context.roomName}* has moved`,
          `Now: ${when}`,
          '',
          `${context.organizer?.name || 'The organiser'} changed the time of a session you were invited to.`,
          ...(link ? ['', `Review it: ${link}`] : []),
        ].join('\n'),
      });
      if (sent.ok) notified += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    session: {
      id: sessionId,
      starts_at: `${startsAt}:00`,
      ends_at: `${endsAt}:00`,
      title,
      description,
    },
    window_moved: windowMoved,
    notified,
    outlook_event_id: outlookEventId,
    calendar_error: calendarError,
  });
}

/**
 * Makes sure a session owns its Outlook meeting. The client calls it right after creating a session,
 * so a room with a mailbox is booked in Outlook even when nobody has been invited.
 */
export async function POST(request: NextRequest) {
  const caller = await requireApiSession(request);
  if (isNextResponse(caller)) return caller;

  const body = await request.json().catch(() => null) as { session_id?: string } | null;
  const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
  if (!sessionId) return NextResponse.json({ error: 'session_id is required' }, { status: 400 });

  const admin = getAdminClient();
  const context = await loadSessionContext(admin, sessionId, caller.profileId);
  if (!context) return NextResponse.json({ error: 'That session no longer exists.' }, { status: 404 });
  if (context.source === 'outlook') return NextResponse.json({ error: OUTLOOK_MANAGED_ERROR }, { status: 403 });
  if (!caller.isAdmin && context.createdBy !== caller.profileId) {
    return NextResponse.json(
      { error: 'Only the person who opened this session, or an administrator, can do that.' },
      { status: 403 }
    );
  }
  if (!context.roomMailbox) return NextResponse.json({ ok: true, skipped: 'no_mailbox' });

  const calendar = await calendarStateOf(admin, sessionId);
  const synced = await syncSessionCalendar({
    admin, context, attendees: calendar.attendees, eventId: calendar.eventId,
  });
  return NextResponse.json({
    ok: synced.ok,
    outlook_event_id: synced.eventId || calendar.eventId || undefined,
    calendar_error: synced.ok ? undefined : synced.error,
  });
}
