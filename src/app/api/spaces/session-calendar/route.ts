import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { graphGetEvent } from '@/lib/integrations/outlook';
import { calendarStateOf, loadSessionContext, syncSessionCalendar } from '@/lib/spaces-server';
import { eventAttendeeEmails } from '@/lib/room-sync';

export const maxDuration = 120;

/**
 * Brings a session's Outlook meeting in line with who is actually in it, after a seat is taken or
 * released. Seat holders are attendees of the meeting, so joining a session puts it on the person's
 * Outlook calendar.
 *
 * Any signed-in person may call it: the request changes nothing by itself — it only re-sends the
 * meeting when the database and Outlook disagree, and stays a no-op otherwise. Requiring the caller
 * to still hold a seat would make leaving impossible to sync, since the seat is gone by then.
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
  if (context.source === 'outlook') return NextResponse.json({ ok: true, skipped: 'outlook' });

  const calendar = await calendarStateOf(admin, sessionId);
  const organizerEmail = (context.organizer?.email || '').trim().toLowerCase();
  const wanted = Array.from(new Set(
    calendar.attendees
      .map(address => address.trim().toLowerCase())
      .filter(address => address && address !== organizerEmail)
  ));

  // Re-patching an unchanged meeting would send every attendee an update, so Outlook is read first.
  if (calendar.eventId && organizerEmail) {
    const current = await graphGetEvent(organizerEmail, calendar.eventId);
    if (current.ok) {
      const onEvent = eventAttendeeEmails(current.event);
      if (onEvent.length === wanted.length && onEvent.every(address => wanted.includes(address))) {
        return NextResponse.json({ ok: true, unchanged: true, outlook_event_id: calendar.eventId });
      }
    }
  }

  const synced = await syncSessionCalendar({
    admin, context, attendees: wanted, eventId: calendar.eventId,
  });
  return NextResponse.json({
    ok: synced.ok,
    outlook_event_id: synced.eventId || calendar.eventId || undefined,
    calendar_error: synced.ok ? undefined : synced.error,
  });
}
