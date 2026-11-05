import type { SupabaseClient } from '@supabase/supabase-js';
import { graphCreateSubscription, graphDeleteSubscription, graphRenewSubscription } from '@/lib/integrations/outlook';
import { athensToday } from '@/lib/integrations/server';
import { describeGraphFailure, meetingLabel, type RoomSyncResult } from '@/lib/room-sync';
import { syncRoom } from '@/lib/room-sync-server';
import { normalizeInviteEmail } from '@/lib/spaces';
import { calendarStateOf, loadSessionContext, syncSessionCalendar } from '@/lib/spaces-server';

/**
 * A conference room's link to its Outlook room mailbox: saving the address, booking the room on the
 * upcoming Orbit meetings, and the Graph subscription that tells Orbit when the room's calendar changes.
 */

const DAY_MS = 86_400_000;
const SUBSCRIPTION_DAYS = 6;
const RENEW_WITHIN_MS = 48 * 3_600_000;

export type RoomMailboxResult = {
  ok: boolean;
  error?: string;
  status?: number;
  /** Upcoming Orbit sessions whose Outlook meeting now books the room. */
  backfilled: number;
  /** One readable reason per Orbit session whose meeting could not book the room; re-saving retries. */
  backfillFailures: string[];
  subscription?: string;
  sync?: RoomSyncResult;
};

const refuse = (status: number, error: string): RoomMailboxResult =>
  ({ ok: false, status, error, backfilled: 0, backfillFailures: [] });

/**
 * Keeps a Graph subscription on the room mailbox's events. Subscriptions lapse after a few days, so
 * the daily job renews one that is close to expiry and re-creates one Graph no longer knows.
 */
export async function ensureRoomSubscription(
  admin: SupabaseClient,
  spaceId: string
): Promise<{ state: 'active' | 'renewed' | 'created' | 'skipped'; reason?: string }> {
  const { data: room } = await admin
    .from('spaces')
    .select('outlook_email, outlook_subscription_id, outlook_subscription_expires_at')
    .eq('id', spaceId)
    .maybeSingle();
  const secret = process.env.OUTLOOK_ROOMS_WEBHOOK_SECRET;
  const notificationUrl = `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')}/api/integrations/outlook/rooms/notify`;
  if (!room?.outlook_email) return { state: 'skipped', reason: 'The room has no Outlook mailbox.' };
  if (!secret) return { state: 'skipped', reason: 'OUTLOOK_ROOMS_WEBHOOK_SECRET is not set.' };
  if (!notificationUrl.startsWith('https://')) {
    return { state: 'skipped', reason: 'Outlook can only notify a public https:// address; use Sync now.' };
  }

  const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_DAYS * DAY_MS).toISOString();
  // Graph may shorten the expiry it was asked for, so the one it answers with is stored.
  const save = async (subscription: Record<string, unknown> | undefined, fallbackId: string) => {
    await admin.from('spaces').update({
      outlook_subscription_id: String(subscription?.id || fallbackId),
      outlook_subscription_expires_at: String(subscription?.expirationDateTime || expirationDateTime),
    }).eq('id', spaceId);
  };

  const currentId: string | null = room.outlook_subscription_id;
  if (currentId) {
    const expiresAt = Date.parse(room.outlook_subscription_expires_at || '') || 0;
    if (expiresAt - Date.now() > RENEW_WITHIN_MS) return { state: 'active' };
    const renewed = await graphRenewSubscription(currentId, expirationDateTime);
    if (renewed.ok) {
      await save(renewed.event, currentId);
      return { state: 'renewed' };
    }
    if (renewed.status !== 404) return { state: 'skipped', reason: describeGraphFailure(renewed) };
  }

  const created = await graphCreateSubscription({
    resource: `/users/${room.outlook_email}/events`,
    notificationUrl,
    clientState: secret,
    expirationDateTime,
  });
  if (!created.ok) return { state: 'skipped', reason: describeGraphFailure(created) };
  await save(created.event, '');
  return { state: 'created' };
}

/**
 * Saves (or clears) a room's mailbox. Admin authorisation is the route's job. Setting a mailbox —
 * also re-saving the same one, which is how a failed backfill is retried — subscribes, books the room
 * on every upcoming Orbit meeting and syncs once. A mailbox that is replaced or cleared loses its
 * subscription and its upcoming Outlook-born sessions; Orbit-born sessions stay.
 */
export async function linkRoomMailbox(
  admin: SupabaseClient,
  spaceId: string,
  email: string | null
): Promise<RoomMailboxResult> {
  const typed = (email || '').trim();
  const next = typed ? normalizeInviteEmail(typed) : null;
  if (typed && !next) return refuse(400, 'Enter the room mailbox as an email address.');

  const { data: room } = await admin
    .from('spaces')
    .select('outlook_email, outlook_subscription_id, space_types(booking_mode)')
    .eq('id', spaceId)
    .maybeSingle();
  if (!room) return refuse(404, 'That room no longer exists.');
  const bookingMode = (room.space_types as { booking_mode?: string } | null)?.booking_mode;
  if (next && bookingMode !== 'time_range') return refuse(400, 'Only rooms booked by the hour can have an Outlook room mailbox.');

  const previous: string | null = room.outlook_email ? String(room.outlook_email).trim().toLowerCase() : null;
  if (previous !== next) {
    const { error } = await admin.from('spaces').update({
      outlook_email: next,
      outlook_subscription_id: null,
      outlook_subscription_expires_at: null,
      outlook_synced_at: null,
      outlook_sync_error: null,
      outlook_clashes: [],
    }).eq('id', spaceId);
    if (error) return error.code === '23505' ? refuse(409, `${next} is already linked to another room.`) : refuse(500, error.message);
    if (room.outlook_subscription_id) await graphDeleteSubscription(room.outlook_subscription_id);
    if (previous) {
      await admin.from('space_sessions').delete()
        .eq('space_id', spaceId).eq('source', 'outlook').gte('session_date', athensToday());
    }
  }
  if (!next) return { ok: true, backfilled: 0, backfillFailures: [] };

  // Subscribed first, so the room accepting the meetings booked below already notifies Orbit.
  const subscription = await ensureRoomSubscription(admin, spaceId);
  const backfill = await bookRoomForOrbitSessions(admin, spaceId);
  const sync = await syncRoom(admin, spaceId);
  return {
    ok: true,
    backfilled: backfill.booked,
    backfillFailures: backfill.failures,
    subscription: subscription.reason ? `${subscription.state}: ${subscription.reason}` : subscription.state,
    sync,
  };
}

/**
 * Puts the room on the Outlook meeting of every upcoming Orbit session, so the room shows busy in
 * Outlook and the sync recognises those meetings instead of importing them. Every session that could
 * not be booked is reported.
 */
async function bookRoomForOrbitSessions(
  admin: SupabaseClient,
  spaceId: string
): Promise<{ booked: number; failures: string[] }> {
  const { data, error } = await admin
    .from('space_sessions')
    .select('id, created_by, title, session_date, starts_at')
    .eq('space_id', spaceId)
    .eq('source', 'orbit')
    .gte('session_date', athensToday())
    .order('session_date')
    .order('starts_at');
  if (error) return { booked: 0, failures: [`Could not read the room's upcoming sessions: ${error.message}`] };

  const result = { booked: 0, failures: [] as string[] };
  type Row = { id: string; created_by: string | null; title: string | null; session_date: string; starts_at: string };
  for (const row of (data || []) as Row[]) {
    const label = meetingLabel(row.title, row.session_date, row.starts_at);
    if (!row.created_by) {
      result.failures.push(`${label}: the session has no organiser, so no Outlook meeting can book the room`);
      continue;
    }
    const context = await loadSessionContext(admin, row.id, row.created_by);
    if (!context) continue; // deleted since the list was read: nothing left to book
    const calendar = await calendarStateOf(admin, row.id);
    const synced = await syncSessionCalendar({ admin, context, attendees: calendar.attendees, eventId: calendar.eventId });
    if (synced.ok) result.booked += 1;
    else result.failures.push(`${label}: ${synced.error || 'the Outlook meeting could not be updated'}`);
  }
  return result;
}
