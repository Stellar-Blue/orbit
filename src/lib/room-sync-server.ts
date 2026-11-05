import type { SupabaseClient } from '@supabase/supabase-js';
import {
  graphCalendarView, graphCreateSubscription, graphDeleteSubscription, graphGetEvent, graphRenewSubscription,
} from '@/lib/integrations/outlook';
import { athensToday } from '@/lib/integrations/server';
import {
  clashOf, describeGraphFailure, occurrenceFromGraph, planAttendees, planRoomSync,
  type GraphCalendarEvent, type LinkedSession, type RoomOccurrence, type RoomSyncMatch, type RoomSyncResult,
} from '@/lib/room-sync';
import { normalizeInviteEmail } from '@/lib/spaces';
import {
  bookInviteeSeat, calendarStateOf, clock, loadSessionContext, removeInvitee, syncSessionCalendar,
} from '@/lib/spaces-server';
import type { RoomClash } from '@/lib/types';

/**
 * Keeps a conference room's sessions in step with its Outlook room mailbox.
 *
 * Every trigger — the webhook, the daily job, "Sync now", linking a mailbox — runs the same full sync
 * of the 12-week horizon: read the room calendar, let the pure planner in room-sync.ts decide, apply.
 * A replayed or missed notification is therefore harmless. Outlook-born sessions are Outlook's: the
 * sync never sends Slack messages for them and never pushes them back to Outlook.
 */

const HORIZON_DAYS = 84;
const CLAIM_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const SUBSCRIPTION_DAYS = 6;
const RENEW_WITHIN_MS = 48 * 3_600_000;

type RoomSession = LinkedSession & { outlook_event_id: string | null; created_by: string | null };
type Directory = {
  /** Current colleagues by lowercased work email: who can be seated. */
  byEmail: Map<string, { id: string; name: string }>;
  /** Every profile's work email by id: whose calendar holds an Orbit meeting. */
  emailOf: Map<string, string>;
};
type Invite = { email: string; profile_id: string | null };
type Sync = {
  admin: SupabaseClient;
  spaceId: string;
  today: string;
  directory: Directory;
  /** Organisers whose calendar could not be read this run: their meetings show the room's copy. */
  unreadOrganizers: Set<string>;
  sessions: Map<string, RoomSession>;
  tally: { created: number; updated: number; deleted: number; clashes: RoomClash[]; issues: string[] };
};

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const idle = (fields: Partial<RoomSyncResult> = {}): RoomSyncResult => ({
  ok: true, created: 0, updated: 0, deleted: 0, clashes: 0, issues: [], ...fields,
});

const labelOf = (title: string | null | undefined, date: string, startsAt: string): string =>
  `${title || 'Session'} on ${date} ${clock(startsAt)}`;

// ---------- One room's sync ----------

/**
 * Syncs one room. Runs never overlap: a call that finds the room claimed only leaves a "pending"
 * flag, and the running sync goes once more when it ends, so a burst of notifications costs at most
 * two runs.
 */
export async function syncRoom(admin: SupabaseClient, spaceId: string): Promise<RoomSyncResult> {
  return runClaimed(admin, spaceId, true);
}

async function runClaimed(admin: SupabaseClient, spaceId: string, mayRepeat: boolean): Promise<RoomSyncResult> {
  const claim = await claimRoom(admin, spaceId);
  if (claim.error) return idle({ ok: false, error: claim.error });
  if (!claim.room) {
    // Only flagged while still claimed: a run that released in between would never see the flag,
    // so the room is claimed again instead.
    const { data: held } = await admin
      .from('spaces')
      .update({ outlook_sync_pending: true })
      .eq('id', spaceId)
      .not('outlook_sync_started_at', 'is', null)
      .select('id')
      .maybeSingle();
    return !held && mayRepeat ? runClaimed(admin, spaceId, false) : idle({ skipped: 'locked' });
  }
  const mailbox: string | null = claim.room.outlook_email;
  let result: RoomSyncResult;
  let pending: boolean;
  try {
    result = mailbox ? await syncMailbox(admin, spaceId, mailbox) : idle({ skipped: 'no_mailbox' });
  } finally {
    // Released even when the run throws, so a crash never locks the room for the claim's lifetime.
    pending = await releaseRoom(admin, spaceId);
  }
  return pending && mayRepeat ? runClaimed(admin, spaceId, false) : result;
}

/**
 * Takes the room unless another run holds a fresh claim. The pending flag is cleared here, not at the
 * end: this run reads the calendar after the claim, so only notifications from now on need a re-run.
 */
async function claimRoom(admin: SupabaseClient, spaceId: string) {
  const staleBefore = new Date(Date.now() - CLAIM_MS).toISOString();
  const { data, error } = await admin
    .from('spaces')
    .update({ outlook_sync_started_at: new Date().toISOString(), outlook_sync_pending: false })
    .eq('id', spaceId)
    .or(`outlook_sync_started_at.is.null,outlook_sync_started_at.lt."${staleBefore}"`)
    .select('outlook_email')
    .maybeSingle();
  return { room: data as { outlook_email: string | null } | null, error: error?.message };
}

/** Frees the room; true when a notification arrived while it was claimed. */
async function releaseRoom(admin: SupabaseClient, spaceId: string): Promise<boolean> {
  const { data } = await admin
    .from('spaces')
    .update({ outlook_sync_started_at: null })
    .eq('id', spaceId)
    .select('outlook_sync_pending')
    .maybeSingle();
  return Boolean(data?.outlook_sync_pending);
}

/** A failed read leaves every session as it was; the room only shows why. */
async function recordFailure(admin: SupabaseClient, spaceId: string, error: string): Promise<RoomSyncResult> {
  await admin.from('spaces').update({ outlook_sync_error: error }).eq('id', spaceId);
  return idle({ ok: false, error });
}

async function syncMailbox(admin: SupabaseClient, spaceId: string, mailbox: string): Promise<RoomSyncResult> {
  const today = athensToday();
  const horizonEnd = addDays(today, HORIZON_DAYS);
  // Athens midnight is 21:00 or 22:00 UTC the day before, so the UTC window is a day wider on both
  // ends; the planner drops dates before today and the filter below drops dates past the horizon.
  const window = { start: `${addDays(today, -1)}T00:00:00Z`, end: `${addDays(horizonEnd, 1)}T00:00:00Z` };
  const roomView = await graphCalendarView(mailbox, window.start, window.end);
  if (!roomView.ok) return recordFailure(admin, spaceId, describeGraphFailure(roomView));

  const directory = await loadDirectory(admin);
  const read = await withOrganizerCopies(roomView.events, mailbox, window, directory);
  // Sessions are loaded for the same dates: the planner deletes Outlook-born sessions it cannot
  // match, so nothing outside the window read may reach it.
  const occurrences = read.occurrences.filter(occurrence => occurrence.date <= horizonEnd);
  const { data, error } = await admin
    .from('space_sessions')
    .select('id, session_date, starts_at, ends_at, title, description, source, outlook_ical_uid, outlook_series_id, outlook_event_id, created_by')
    .eq('space_id', spaceId)
    .gte('session_date', today)
    .lte('session_date', horizonEnd);
  if (error) return recordFailure(admin, spaceId, `Could not read the room's sessions: ${error.message}`);
  const sessions = (data || []) as RoomSession[];

  const plan = planRoomSync({ occurrences, sessions, today });
  const sync: Sync = {
    admin, spaceId, today, directory, unreadOrganizers: read.unreadOrganizers,
    sessions: new Map(sessions.map(session => [session.id, session])),
    tally: { created: 0, updated: 0, deleted: 0, clashes: [...plan.clashes], issues: [...plan.issues] },
  };
  // Deletes first: a meeting re-created in Outlook at the same time must not trip the overlap trigger.
  await applyDeletes(sync, plan.deletes);
  await applyMatches(sync, plan.matches);
  await applyCreates(sync, plan.creates);
  await checkMissingOrbit(sync, plan.missingOrbit);

  const { tally } = sync;
  await admin.from('spaces').update({
    outlook_synced_at: new Date().toISOString(),
    outlook_sync_error: tally.issues.join('\n') || null,
    outlook_clashes: tally.clashes,
  }).eq('id', spaceId);
  return idle({
    created: tally.created, updated: tally.updated, deleted: tally.deleted,
    clashes: tally.clashes.length, issues: tally.issues,
  });
}

async function loadDirectory(admin: SupabaseClient): Promise<Directory> {
  const { data } = await admin.from('profiles').select('id, first_name, last_name, work_email, status');
  const directory: Directory = { byEmail: new Map(), emailOf: new Map() };
  for (const profile of data || []) {
    if (!profile.work_email) continue;
    const email = String(profile.work_email).trim().toLowerCase();
    directory.emailOf.set(profile.id, email);
    if (profile.status === 'departed') continue;
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || email;
    directory.byEmail.set(email, { id: profile.id, name });
  }
  return directory;
}

/**
 * The room's events as occurrences, with subject, agenda and guests from each organiser's own copy:
 * the room's copy is usually stripped. Each organiser in the tenant is read once per sync; one outside
 * it, or one whose calendar cannot be read, leaves the room's copy as the source.
 */
async function withOrganizerCopies(
  roomEvents: GraphCalendarEvent[],
  mailbox: string,
  window: { start: string; end: string },
  directory: Directory
): Promise<{ occurrences: RoomOccurrence[]; unreadOrganizers: Set<string> }> {
  const room = mailbox.trim().toLowerCase();
  const tenantDomain = room.slice(room.indexOf('@'));
  const organizerOf = (event: GraphCalendarEvent): string =>
    event.organizer?.emailAddress?.address?.trim().toLowerCase() || '';
  const organizers = [...new Set(roomEvents.map(organizerOf))].filter(email => (
    email && email !== room && (email.endsWith(tenantDomain) || directory.byEmail.has(email))
  ));

  const copies = new Map<string, Map<string, GraphCalendarEvent>>();
  const unreadOrganizers = new Set<string>();
  await Promise.all(organizers.map(async email => {
    const view = await graphCalendarView(email, window.start, window.end);
    if (view.ok) copies.set(email, new Map(view.events.map(event => [event.iCalUId, event])));
    else unreadOrganizers.add(email);
  }));

  const occurrences = roomEvents
    .map(event => occurrenceFromGraph(event, copies.get(organizerOf(event))?.get(event.iCalUId) ?? null, mailbox))
    .filter((occurrence): occurrence is RoomOccurrence => occurrence !== null);
  return { occurrences, unreadOrganizers };
}

// ---------- Applying the plan ----------

const organizerIdOf = (sync: Sync, occurrence: RoomOccurrence): string | null =>
  (occurrence.organizerEmail && sync.directory.byEmail.get(occurrence.organizerEmail)?.id) || null;

async function applyDeletes(sync: Sync, ids: string[]) {
  for (const id of ids) {
    // The planner only deletes upcoming Outlook-born sessions; the filters hold it to that.
    const { count, error } = await sync.admin
      .from('space_sessions')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('source', 'outlook')
      .gte('session_date', sync.today);
    const session = sync.sessions.get(id)!;
    if (error) sync.tally.issues.push(`${labelOf(session.title, session.session_date, session.starts_at)}: ${error.message}`);
    else sync.tally.deleted += count || 0;
  }
}

async function applyMatches(sync: Sync, matches: RoomSyncMatch[]) {
  const invites = await upcomingInvites(sync);
  for (const match of matches) {
    const { occurrence } = match;
    // Orbit-born sessions keep their own title: the Outlook subject Orbit wrote is "title · room". An
    // organiser whose calendar failed to read this run leaves only the stripped room copy, so a
    // transient Graph error must not overwrite the title or drop the guests and their seats.
    const followDetails = match.source === 'outlook' && !sync.unreadOrganizers.has(occurrence.organizerEmail || '');
    if (match.changed) {
      const { error } = await sync.admin.from('space_sessions').update({
        starts_at: `${occurrence.startsAt}:00`,
        ends_at: `${occurrence.endsAt}:00`,
        ...(followDetails ? { title: occurrence.subject, description: occurrence.body } : {}),
        ...(match.relink ? { outlook_ical_uid: occurrence.icalUid, outlook_series_id: occurrence.seriesId } : {}),
      }).eq('id', match.sessionId);
      // ponytail: two meetings swapping windows in one Outlook edit trip the overlap trigger here;
      // reported as an issue, not resolved. Upgrade path: park one session's window first.
      if (error) {
        const title = sync.sessions.get(match.sessionId)?.title || occurrence.subject;
        sync.tally.issues.push(`${labelOf(title, occurrence.date, occurrence.startsAt)}: ${error.message}`);
      } else {
        sync.tally.updated += 1;
      }
    }
    if (followDetails && invites) {
      const target = { spaceId: sync.spaceId, sessionId: match.sessionId, sessionDate: occurrence.date };
      await syncAttendees(sync, target, occurrence, invites.get(match.sessionId) || []);
    }
  }
}

/**
 * The room's upcoming invite rows by session, in one read. Null when the read fails: guests are then
 * left alone this run, since an empty list would re-seat everyone who released their seat.
 */
async function upcomingInvites(sync: Sync): Promise<Map<string, Invite[]> | null> {
  const { data, error } = await sync.admin
    .from('space_session_invites')
    .select('session_id, email, profile_id, space_sessions!inner(space_id, session_date)')
    .eq('space_sessions.space_id', sync.spaceId)
    .gte('space_sessions.session_date', sync.today);
  if (error) {
    sync.tally.issues.push(`Could not read the room's guest lists: ${error.message}`);
    return null;
  }
  const bySession = new Map<string, Invite[]>();
  for (const row of (data || []) as (Invite & { session_id: string })[]) {
    bySession.set(row.session_id, [...(bySession.get(row.session_id) || []), row]);
  }
  return bySession;
}

async function applyCreates(sync: Sync, creates: RoomOccurrence[]) {
  for (const occurrence of creates) {
    const { data, error } = await sync.admin.from('space_sessions').insert({
      space_id: sync.spaceId,
      session_date: occurrence.date,
      starts_at: `${occurrence.startsAt}:00`,
      ends_at: `${occurrence.endsAt}:00`,
      title: occurrence.subject,
      description: occurrence.body,
      source: 'outlook',
      outlook_ical_uid: occurrence.icalUid,
      outlook_series_id: occurrence.seriesId,
      created_by: organizerIdOf(sync, occurrence),
    }).select('id').single();
    if (error) {
      // Already imported: by a run whose claim had lapsed, or into another room the meeting also books.
      if (error.code === '23505' && /outlook_ical_uid/.test(error.message)) continue;
      // An Orbit session opened in that window since the calendar was read.
      if (/overlaps|space_sessions_window_idx/.test(error.message)) sync.tally.clashes.push(clashOf(occurrence));
      else sync.tally.issues.push(`${labelOf(occurrence.subject, occurrence.date, occurrence.startsAt)}: ${error.message}`);
      continue;
    }
    sync.tally.created += 1;
    await syncAttendees(sync, { spaceId: sync.spaceId, sessionId: data.id, sessionDate: occurrence.date }, occurrence, []);
  }
}

/**
 * Brings an Outlook-born session's guest list in line with the meeting. Only invites the sync wrote
 * are dropped, so people who joined by hand keep their seat; a full room or a day away means invited
 * without a seat. No Slack and no mail: Outlook already told everyone.
 */
async function syncAttendees(
  sync: Sync,
  target: { spaceId: string; sessionId: string; sessionDate: string },
  occurrence: RoomOccurrence,
  existingInvites: Invite[]
) {
  const { add, remove } = planAttendees({ occurrence, directory: sync.directory.byEmail, existingInvites });
  // Removals first, so a full room frees the chairs the newcomers need.
  for (const person of remove) await removeInvitee(sync.admin, target.sessionId, person.email);
  if (add.length === 0) return;

  const organizerId = organizerIdOf(sync, occurrence);
  for (const person of add) {
    if (!person.profileId) continue;
    const { seat, error } = await bookInviteeSeat(sync.admin, target, person.profileId, organizerId);
    if (seat === 'failed') console.error(`room sync: seat for ${person.email} failed: ${error}`);
  }
  const { error } = await sync.admin.from('space_session_invites').upsert(
    add.map(person => ({
      session_id: target.sessionId,
      invited_by: organizerId,
      profile_id: person.profileId,
      email: person.email,
      name: sync.directory.byEmail.get(person.email)?.name || person.name,
      slack_status: 'skipped',
      outlook_status: 'skipped',
    })),
    { onConflict: 'session_id,email' }
  );
  if (error) console.error('room sync: space_session_invites upsert error:', error.message);
}

/**
 * Orbit-born meetings the room calendar no longer shows. Gone or cancelled on the organiser's side
 * means the organiser cancelled it in Outlook, so the session goes too; otherwise the room declined
 * it, and a session someone made in Orbit is flagged, never deleted.
 */
async function checkMissingOrbit(sync: Sync, ids: string[]) {
  for (const id of ids) {
    const session = sync.sessions.get(id);
    if (!session) continue;
    const label = labelOf(session.title, session.session_date, session.starts_at);
    const organizer = session.created_by ? sync.directory.emailOf.get(session.created_by) : undefined;
    const copy = organizer && session.outlook_event_id ? await graphGetEvent(organizer, session.outlook_event_id) : null;
    const cancelled = copy ? (copy.ok ? copy.event?.isCancelled === true : copy.status === 404) : false;
    if (!cancelled) {
      sync.tally.issues.push(`${label}: the room declined it in Outlook`);
      continue;
    }
    const { count, error } = await sync.admin
      .from('space_sessions')
      .delete({ count: 'exact' })
      .eq('id', id)
      .gte('session_date', sync.today);
    if (error) sync.tally.issues.push(`${label}: ${error.message}`);
    else sync.tally.deleted += count || 0;
  }
}

// ---------- Change notifications ----------

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

// ---------- Linking a room to its mailbox ----------

/**
 * Saves (or clears) a room's mailbox. Admin authorisation is the route's job. A new mailbox books the
 * room for every upcoming Orbit session, gets its subscription and is synced once; the mailbox it
 * replaces loses its subscription and its upcoming Outlook-born sessions. Orbit-born sessions stay.
 */
export async function linkRoomMailbox(
  admin: SupabaseClient,
  spaceId: string,
  email: string | null
): Promise<{ ok: boolean; error?: string; status?: number; backfilled: number; subscription?: string; sync?: RoomSyncResult }> {
  const typed = (email || '').trim();
  const next = typed ? normalizeInviteEmail(typed) : null;
  if (typed && !next) return { ok: false, status: 400, error: 'Enter the room mailbox as an email address.', backfilled: 0 };

  const { data: room } = await admin
    .from('spaces')
    .select('outlook_email, outlook_subscription_id, space_types(booking_mode)')
    .eq('id', spaceId)
    .maybeSingle();
  if (!room) return { ok: false, status: 404, error: 'That room no longer exists.', backfilled: 0 };
  const bookingMode = (room.space_types as { booking_mode?: string } | null)?.booking_mode;
  if (next && bookingMode !== 'time_range') {
    return { ok: false, status: 400, error: 'Only rooms booked by the hour can have an Outlook room mailbox.', backfilled: 0 };
  }

  const previous: string | null = room.outlook_email ? String(room.outlook_email).trim().toLowerCase() : null;
  const changed = previous !== next;
  if (changed) {
    const { error } = await admin.from('spaces').update({
      outlook_email: next,
      outlook_subscription_id: null,
      outlook_subscription_expires_at: null,
      outlook_synced_at: null,
      outlook_sync_error: null,
      outlook_clashes: [],
    }).eq('id', spaceId);
    if (error) {
      return error.code === '23505'
        ? { ok: false, status: 409, error: `${next} is already linked to another room.`, backfilled: 0 }
        : { ok: false, status: 500, error: error.message, backfilled: 0 };
    }
    if (room.outlook_subscription_id) await graphDeleteSubscription(room.outlook_subscription_id);
    if (previous) {
      await admin.from('space_sessions').delete()
        .eq('space_id', spaceId).eq('source', 'outlook').gte('session_date', athensToday());
    }
  }
  if (!next) return { ok: true, backfilled: 0 };

  // Re-saving the same mailbox does not re-patch every meeting: that would mail every attendee.
  const backfilled = changed ? await bookRoomForOrbitSessions(admin, spaceId) : 0;
  const subscription = await ensureRoomSubscription(admin, spaceId);
  const sync = await syncRoom(admin, spaceId);
  return {
    ok: true,
    backfilled,
    subscription: subscription.reason ? `${subscription.state}: ${subscription.reason}` : subscription.state,
    sync,
  };
}

/**
 * Puts the room on the Outlook meeting of every upcoming Orbit session, so the room shows busy in
 * Outlook and the first sync recognises those meetings instead of importing them.
 */
async function bookRoomForOrbitSessions(admin: SupabaseClient, spaceId: string): Promise<number> {
  const { data } = await admin
    .from('space_sessions')
    .select('id, created_by')
    .eq('space_id', spaceId)
    .eq('source', 'orbit')
    .gte('session_date', athensToday())
    .not('created_by', 'is', null);
  let booked = 0;
  for (const row of (data || []) as { id: string; created_by: string }[]) {
    const context = await loadSessionContext(admin, row.id, row.created_by);
    if (!context) continue;
    const calendar = await calendarStateOf(admin, row.id);
    const synced = await syncSessionCalendar({ admin, context, attendees: calendar.attendees, eventId: calendar.eventId });
    if (synced.ok) booked += 1;
    else console.error(`room mailbox backfill: session ${row.id} failed: ${synced.error}`);
  }
  return booked;
}
