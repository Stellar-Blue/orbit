import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, graphCalendarView, graphGetEvent } from '@/lib/integrations/outlook';
import { athensToday } from '@/lib/integrations/server';
import {
  clashOf, describeGraphFailure, meetingLabel, occurrenceFromGraph, organizerCancelled, organizerEmailOf,
  organizersToRead, planAttendees, planRoomSync,
  type GraphCalendarEvent, type LinkedSession, type RoomOccurrence, type RoomSyncMatch, type RoomSyncResult,
} from '@/lib/room-sync';
import { bookInviteeSeat, removeInvitee } from '@/lib/spaces-server';
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
const INVITE_PAGE = 1000;

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
  horizonEnd: string;
  directory: Directory;
  /** Occurrences whose organiser copy should exist but was not read: only the stripped room copy is known. */
  staleDetails: Set<string>;
  sessions: Map<string, RoomSession>;
  tally: { created: number; updated: number; deleted: number; clashes: RoomClash[]; issues: string[] };
};

const idle = (fields: Partial<RoomSyncResult> = {}): RoomSyncResult => ({
  ok: true, created: 0, updated: 0, deleted: 0, clashes: 0, issues: [], ...fields,
});

// ---------- Claim ----------

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

// ---------- Read and plan ----------

/** A failed read leaves every session as it was; the room only shows why. */
async function recordFailure(admin: SupabaseClient, spaceId: string, error: string): Promise<RoomSyncResult> {
  await admin.from('spaces').update({ outlook_sync_error: error }).eq('id', spaceId);
  return idle({ ok: false, error });
}

/**
 * The dates a sync covers, [today, horizonEnd], and the UTC range read for them. Athens midnight is
 * 21:00 or 22:00 UTC the day before, so the UTC range is a day wider on both ends; callers drop the
 * dates outside [today, horizonEnd].
 */
export function roomSyncWindow(today: string): { horizonEnd: string; start: string; end: string } {
  const horizonEnd = addDays(today, HORIZON_DAYS);
  return { horizonEnd, start: `${addDays(today, -1)}T00:00:00Z`, end: `${addDays(horizonEnd, 1)}T00:00:00Z` };
}

async function syncMailbox(admin: SupabaseClient, spaceId: string, mailbox: string): Promise<RoomSyncResult> {
  const today = athensToday();
  const window = roomSyncWindow(today);
  const { horizonEnd } = window;
  const roomView = await graphCalendarView(mailbox, window.start, window.end);
  if (!roomView.ok) return recordFailure(admin, spaceId, describeGraphFailure(roomView));

  // Without the directory every create would lose its organiser and every guest their seat for good.
  const directory = await loadDirectory(admin);
  if ('error' in directory) return recordFailure(admin, spaceId, `Could not read the people directory: ${directory.error}`);
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
    admin, spaceId, today, horizonEnd, directory, staleDetails: read.staleDetails,
    sessions: new Map(sessions.map(session => [session.id, session])),
    tally: { created: 0, updated: 0, deleted: 0, clashes: [...plan.clashes], issues: [...read.issues, ...plan.issues] },
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

async function loadDirectory(admin: SupabaseClient): Promise<Directory | { error: string }> {
  const { data, error } = await admin.from('profiles').select('id, first_name, last_name, work_email, status');
  if (error) return { error: error.message };
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
 * the room's copy is usually stripped. Each organiser in the tenant is read once per sync. When that
 * copy is missing (unreadable calendar, or not on it), the occurrence is marked stale so its session
 * keeps the details it has; organisers outside the tenant are read from the room's copy as designed.
 */
async function withOrganizerCopies(
  roomEvents: GraphCalendarEvent[],
  mailbox: string,
  window: { start: string; end: string },
  directory: Directory
): Promise<{ occurrences: RoomOccurrence[]; staleDetails: Set<string>; issues: string[] }> {
  const organizers = organizersToRead(roomEvents, mailbox, email => directory.byEmail.has(email));
  const copies = new Map<string, Map<string, GraphCalendarEvent>>();
  const issues: string[] = [];
  await Promise.all(organizers.map(async email => {
    const view = await graphCalendarView(email, window.start, window.end);
    if (view.ok) copies.set(email, new Map(view.events.map(event => [event.iCalUId, event])));
    else issues.push(`Could not read ${email}'s calendar: ${describeGraphFailure(view)}`);
  }));

  const expected = new Set(organizers);
  const staleDetails = new Set<string>();
  const occurrences: RoomOccurrence[] = [];
  for (const event of roomEvents) {
    const organizer = organizerEmailOf(event);
    const copy = copies.get(organizer)?.get(event.iCalUId) ?? null;
    if (!copy && expected.has(organizer)) staleDetails.add(event.iCalUId);
    const occurrence = occurrenceFromGraph(event, copy, mailbox);
    if (occurrence) occurrences.push(occurrence);
  }
  return { occurrences, staleDetails, issues: issues.sort() };
}

// ---------- Apply ----------

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
    if (error) sync.tally.issues.push(`${meetingLabel(session.title, session.session_date, session.starts_at)}: ${error.message}`);
    else sync.tally.deleted += count || 0;
  }
}

async function applyMatches(sync: Sync, matches: RoomSyncMatch[]) {
  const invites = await upcomingInvites(sync);
  for (const match of matches) {
    const { occurrence } = match;
    // Orbit-born sessions keep their own title: the Outlook subject Orbit wrote is "title · room". A
    // stale occurrence only has the stripped room copy, which must not overwrite the title or drop
    // the guests and their seats.
    const followDetails = match.source === 'outlook' && !sync.staleDetails.has(occurrence.icalUid);
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
        sync.tally.issues.push(`${meetingLabel(title, occurrence.date, occurrence.startsAt)}: ${error.message}`);
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
 * The invite rows of the room's sessions in the horizon, by session, read page by page until the
 * reported total is reached. Pages advance by the rows actually returned, so a server row cap below
 * INVITE_PAGE cannot skip any. Null when a read fails: guests are then left alone this run, since a
 * missing list would re-seat everyone who released their seat.
 */
async function upcomingInvites(sync: Sync): Promise<Map<string, Invite[]> | null> {
  const bySession = new Map<string, Invite[]>();
  let from = 0;
  let total = Number.POSITIVE_INFINITY;
  while (from < total) {
    const { data, error, count } = await sync.admin
      .from('space_session_invites')
      .select('id, session_id, email, profile_id, space_sessions!inner(space_id, session_date)', { count: 'exact' })
      .eq('space_sessions.space_id', sync.spaceId)
      .gte('space_sessions.session_date', sync.today)
      .lte('space_sessions.session_date', sync.horizonEnd)
      .order('id')
      .range(from, from + INVITE_PAGE - 1);
    if (error) {
      sync.tally.issues.push(`Could not read the room's guest lists: ${error.message}`);
      return null;
    }
    const rows = (data || []) as (Invite & { session_id: string })[];
    for (const row of rows) bySession.set(row.session_id, [...(bySession.get(row.session_id) || []), row]);
    total = count ?? total;
    if (rows.length === 0) break;
    from += rows.length;
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
      else sync.tally.issues.push(`${meetingLabel(occurrence.subject, occurrence.date, occurrence.startsAt)}: ${error.message}`);
      continue;
    }
    sync.tally.created += 1;
    await syncAttendees(sync, { spaceId: sync.spaceId, sessionId: data.id, sessionDate: occurrence.date }, occurrence, []);
  }
}

/**
 * Brings an Outlook-born session's guest list in line with the meeting. Only invites the sync wrote
 * are dropped, and only seats the sync booked are released: the sync books with no `created_by`,
 * every seat taken in the app records who took it. A full room or a day away means invited without
 * a seat. No Slack and no mail: Outlook already told everyone.
 */
async function syncAttendees(
  sync: Sync,
  target: { spaceId: string; sessionId: string; sessionDate: string },
  occurrence: RoomOccurrence,
  existingInvites: Invite[]
) {
  const { add, remove } = planAttendees({ occurrence, directory: sync.directory.byEmail, existingInvites });
  const label = meetingLabel(occurrence.subject, occurrence.date, occurrence.startsAt);
  // Removals first, so a full room frees the chairs the newcomers need.
  for (const person of remove) {
    const { removed, seatReleased } = await removeInvitee(sync.admin, target.sessionId, person.email, { syncSeatOnly: true });
    if (removed && person.profileId && !seatReleased) sync.tally.issues.push(`${label}: ${person.email}'s seat could not be released`);
  }
  if (add.length === 0) return;

  for (const person of add) {
    if (!person.profileId) continue;
    const { seat, error } = await bookInviteeSeat(sync.admin, target, person.profileId, null);
    if (seat === 'failed') sync.tally.issues.push(`${label}: ${person.email} ${error}`);
  }
  const organizerId = organizerIdOf(sync, occurrence);
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
  if (error) sync.tally.issues.push(`${label}: the guest list could not be saved: ${error.message}`);
}

/**
 * Orbit-born meetings the room calendar no longer shows. Only the organiser's own copy being gone or
 * cancelled deletes the session; a declined room, a read that failed or a meeting never created is
 * flagged, and the session someone made in Orbit stays.
 */
async function checkMissingOrbit(sync: Sync, ids: string[]) {
  for (const id of ids) {
    const session = sync.sessions.get(id)!;
    const label = meetingLabel(session.title, session.session_date, session.starts_at);
    if (!session.outlook_event_id) {
      sync.tally.issues.push(`${label}: not booked in Outlook yet — re-save the room mailbox to retry`);
      continue;
    }
    const organizer = session.created_by ? sync.directory.emailOf.get(session.created_by) : undefined;
    if (!organizer) {
      sync.tally.issues.push(`${label}: could not check it in Outlook — the organiser has no work email`);
      continue;
    }
    const read = await graphGetEvent(organizer, session.outlook_event_id);
    if (!organizerCancelled(read)) {
      sync.tally.issues.push(read.ok
        ? `${label}: the room declined it in Outlook`
        : `${label}: could not check it in Outlook — ${describeGraphFailure(read)}`);
      continue;
    }
    const { count, error } = await sync.admin
      .from('space_sessions')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('source', 'orbit')
      .gte('session_date', sync.today);
    if (error) sync.tally.issues.push(`${label}: ${error.message}`);
    else sync.tally.deleted += count || 0;
  }
}
