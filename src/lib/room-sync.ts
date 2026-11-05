/**
 * Pure planning for syncing a room mailbox's Outlook calendar into conference-room sessions.
 * No I/O: the server route reads Graph and the database, hands the rows here, and applies the plan.
 */

import { clockLabel, overlappingSession } from '@/lib/spaces';
import type { RoomClash, SpaceSession } from '@/lib/types';

type GraphAddress = { name?: string; address?: string };

export type GraphCalendarEvent = {
  id: string;
  iCalUId: string;
  seriesMasterId?: string | null;
  type?: 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster';
  subject?: string | null;
  body?: { content?: string | null } | null;
  sensitivity?: 'normal' | 'personal' | 'private' | 'confidential';
  /** Present when Graph says which zone `dateTime` is in; Orbit asks for Athens. */
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  organizer?: { emailAddress?: GraphAddress };
  attendees?: {
    type?: 'required' | 'optional' | 'resource';
    status?: { response?: string };
    emailAddress?: GraphAddress;
  }[];
};

export type OccurrenceAttendee = {
  email: string;
  name: string | null;
  response: 'accepted' | 'tentative' | 'declined' | 'none' | 'organizer';
};

/** One meeting on one day; `startsAt`/`endsAt` are `HH:MM` in Athens time. */
export type RoomOccurrence = {
  icalUid: string;
  seriesId: string | null;
  date: string;
  startsAt: string;
  endsAt: string;
  subject: string | null;
  body: string | null;
  organizerEmail: string | null;
  organizerName: string | null;
  attendees: OccurrenceAttendee[];
  /** The meeting carries an Orbit session link: Orbit sent it, so it is never imported as Outlook's. */
  orbitMeeting?: boolean;
};

export type LinkedSession = Pick<
  SpaceSession,
  'id' | 'session_date' | 'starts_at' | 'ends_at' | 'title' | 'description' | 'source' | 'outlook_ical_uid' | 'outlook_series_id'
>;

export type RoomSyncMatch = {
  sessionId: string;
  source: 'orbit' | 'outlook';
  occurrence: RoomOccurrence;
  changed: boolean;
  relink: boolean;
};

export type RoomSyncPlan = {
  creates: RoomOccurrence[];
  matches: RoomSyncMatch[];
  deletes: string[];
  clashes: RoomClash[];
  missingOrbit: string[];
  issues: string[];
};

/** Shared by the server and the client. */
export type RoomSyncResult = {
  ok: boolean;
  created: number;
  updated: number;
  deleted: number;
  clashes: number;
  issues: string[];
  error?: string;
  skipped?: 'locked' | 'no_mailbox';
};

/** Shared by the server and the client. */
export type RoomSubscription = { state: 'active' | 'renewed' | 'created' | 'skipped'; reason?: string };

/** What syncing an Orbit room into Outlook's Places directory did. */
export type RoomProvisionOutcome = 'created' | 'updated' | 'unchanged' | 'failed' | 'skipped';

export type RoomProvisionResult = {
  space_id: string;
  name: string;
  outcome: RoomProvisionOutcome;
  outlook_email?: string | null;
  /** A warning next to a successful outcome, or the reason a room was skipped or failed. */
  message?: string;
  backfilled?: number;
  backfillFailures?: string[];
  subscription?: RoomSubscription;
  sync?: RoomSyncResult;
};

/** The Outlook Places room fields Orbit owns; `building` and `floorLabel` come from the room. */
export type RoomPlaceFields = {
  displayName: string;
  capacity: number;
  building: string;
  floorLabel: string;
};

/**
 * What an Orbit room should look like in Outlook: its name, how many people it seats, and where it
 * is. The building falls back to the room's location, the floor to the Orbit floor it is drawn on.
 */
export function roomPlaceFields(
  space: { name: string; capacity: number; location?: string | null },
  floorName?: string | null,
  defaults?: { building?: string; floor?: string }
): RoomPlaceFields {
  return {
    displayName: space.name.trim(),
    capacity: Math.max(1, Math.round(Number(space.capacity) || 1)),
    building: (space.location || '').trim() || defaults?.building || 'Orbit',
    floorLabel: (floorName || '').trim() || defaults?.floor || 'Main',
  };
}

/** Only the room fields whose Orbit value differs from what Outlook holds, so no-op PATCHes stay rare. */
export function roomPlacePatch(
  current: { displayName?: string | null; capacity?: number | null; building?: string | null; floorLabel?: string | null },
  wanted: RoomPlaceFields
): Partial<RoomPlaceFields> {
  const patch: Partial<RoomPlaceFields> = {};
  if ((current.displayName || '').trim() !== wanted.displayName) patch.displayName = wanted.displayName;
  if (Number(current.capacity || 0) !== wanted.capacity) patch.capacity = wanted.capacity;
  if ((current.building || '').trim() !== wanted.building) patch.building = wanted.building;
  if ((current.floorLabel || '').trim() !== wanted.floorLabel) patch.floorLabel = wanted.floorLabel;
  return patch;
}

const RESPONSES: Record<string, OccurrenceAttendee['response']> = {
  accepted: 'accepted',
  tentativelyAccepted: 'tentative',
  declined: 'declined',
  organizer: 'organizer',
};

const BODY_LIMIT = 2000;
const ATHENS_ZONES = ['Europe/Athens', 'GTB Standard Time'];
const PRIVATE = ['private', 'confidential'];

/** Every Orbit meeting body ends with the session link (`/spaces?session=…`). */
export function isOrbitMeetingBody(body: string | null | undefined): boolean {
  return typeof body === 'string' && body.includes('/spaces?session=');
}

/**
 * The first zone Graph reported that is not Athens, or null. Orbit stores Athens wall-clock times, so
 * a read in any other zone would move every session.
 */
export function unexpectedTimeZone(events: Pick<GraphCalendarEvent, 'start'>[]): string | null {
  return events.map(event => event.start.timeZone).find(zone => zone && !ATHENS_ZONES.includes(zone)) || null;
}

/**
 * A Graph event as one dated occurrence, or null when it cannot be a session (cancelled, all-day,
 * the series master itself, or running past midnight). Details come from the organiser's copy when
 * we have it: the room's own copy carries the booker's name as subject and no guest list.
 */
export function occurrenceFromGraph(
  room: GraphCalendarEvent,
  organizerCopy: GraphCalendarEvent | null,
  roomMailbox: string
): RoomOccurrence | null {
  if (room.isCancelled || room.isAllDay || room.type === 'seriesMaster') return null;
  const date = room.start.dateTime.slice(0, 10);
  if (room.end.dateTime.slice(0, 10) !== date) return null;

  const source = organizerCopy ?? room;
  const roomEmail = roomMailbox.trim().toLowerCase();
  const seen = new Set<string>();
  const attendees: OccurrenceAttendee[] = [];
  for (const attendee of source.attendees ?? []) {
    const email = attendee.emailAddress?.address?.trim().toLowerCase();
    if (!email || attendee.type === 'resource' || email === roomEmail || seen.has(email)) continue;
    seen.add(email);
    attendees.push({
      email,
      name: attendee.emailAddress?.name || null,
      response: RESPONSES[attendee.status?.response ?? ''] ?? 'none',
    });
  }

  const organizer = source.organizer?.emailAddress;
  // An app token reads private meetings in full; everyone in Orbit would see what the attendees
  // agreed to keep private. The seat still holds the room.
  const hidden = [room, organizerCopy].some(event => PRIVATE.includes(event?.sensitivity ?? ''));
  return {
    icalUid: room.iCalUId,
    seriesId: room.seriesMasterId ?? null,
    date,
    startsAt: room.start.dateTime.slice(11, 16),
    endsAt: room.end.dateTime.slice(11, 16),
    subject: hidden ? 'Private meeting' : source.subject || null,
    body: hidden ? null : source.body?.content?.trim().slice(0, BODY_LIMIT) || null,
    organizerEmail: organizer?.address?.trim().toLowerCase() || null,
    organizerName: organizer?.name || null,
    attendees,
    orbitMeeting: isOrbitMeetingBody(source.body?.content),
  };
}

/** An occurrence that could not become a session, as admins see it on the room. */
export function clashOf(occurrence: RoomOccurrence): RoomClash {
  return {
    date: occurrence.date,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    subject: occurrence.subject,
    organizer: occurrence.organizerName || occurrence.organizerEmail,
  };
}

/** `Standup on 2026-11-10 09:00`, the prefix of every per-session room issue. */
export function meetingLabel(title: string | null | undefined, date: string, startsAt: string): string {
  return `${title || 'Session'} on ${date} ${clockLabel(startsAt)}`;
}

/**
 * Orbit sessions whose meeting is not on the room calendar yet: no meeting at all, or a meeting the
 * room's calendar (read up to `horizonEnd`) does not show. A session past the horizon read is only
 * counted when it has no meeting, since the read cannot vouch for it.
 */
export function sessionsMissingFromRoom(
  sessions: { id: string; session_date: string; outlook_ical_uid?: string | null }[],
  roomIcalUids: Set<string>,
  horizonEnd: string
): string[] {
  return sessions
    .filter(session => !session.outlook_ical_uid
      || (session.session_date <= horizonEnd && !roomIcalUids.has(session.outlook_ical_uid)))
    .map(session => session.id);
}

/** The organiser's address on an event, lowercased; empty when Outlook gives none. */
export function organizerEmailOf(event: GraphCalendarEvent): string {
  return event.organizer?.emailAddress?.address?.trim().toLowerCase() || '';
}

/**
 * Organisers whose own calendar carries the full meeting, each once: never the room itself, and only
 * inside the tenant (the room mailbox's domain, or a current colleague). Anyone else is read from the
 * room's copy.
 */
export function organizersToRead(
  events: GraphCalendarEvent[],
  roomMailbox: string,
  isColleague: (email: string) => boolean
): string[] {
  const room = roomMailbox.trim().toLowerCase();
  const domain = room.slice(room.indexOf('@'));
  return [...new Set(events.map(organizerEmailOf))].filter(email => (
    email !== '' && email !== room && (email.endsWith(domain) || isColleague(email))
  ));
}

/**
 * Whether the organiser's read of an Orbit meeting proves it was cancelled. Only a missing item or a
 * cancelled event does: a missing mailbox or a refused read says nothing about the meeting.
 */
export function organizerCancelled(read: { ok: boolean; status?: number; code?: string; event?: Record<string, unknown> }): boolean {
  return read.ok ? read.event?.isCancelled === true : read.status === 404 && read.code === 'ErrorItemNotFound';
}

/**
 * What to create, update, delete or report so the room's sessions mirror its Outlook calendar.
 * Past dates are ignored on both sides. Outlook-born sessions follow Outlook completely; Orbit-born
 * ones only follow time changes on the same day and are never deleted.
 */
export function planRoomSync(args: {
  occurrences: RoomOccurrence[];
  sessions: LinkedSession[];
  today: string;
}): RoomSyncPlan {
  const { today } = args;
  const occurrences = args.occurrences
    .filter(entry => entry.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startsAt.localeCompare(b.startsAt));
  const sessions = args.sessions.filter(entry => entry.session_date >= today);
  const plan: RoomSyncPlan = { creates: [], matches: [], deletes: [], clashes: [], missingOrbit: [], issues: [] };

  const byUid = new Map<string, LinkedSession>();
  for (const entry of sessions) if (entry.outlook_ical_uid) byUid.set(entry.outlook_ical_uid, entry);
  const liveUids = new Set(occurrences.map(entry => entry.icalUid));
  const claimed = new Set<string>();
  const finalWindow = new Map<string, { starts_at: string; ends_at: string }>();
  const unmatched: RoomOccurrence[] = [];

  const matchOf = (entry: LinkedSession, occurrence: RoomOccurrence, relink: boolean): RoomSyncMatch => {
    const outlookBorn = entry.source === 'outlook';
    const changed = relink
      || clockLabel(entry.starts_at) !== occurrence.startsAt
      || clockLabel(entry.ends_at) !== occurrence.endsAt
      || (outlookBorn && ((entry.title || null) !== occurrence.subject || (entry.description || null) !== occurrence.body));
    return { sessionId: entry.id, source: outlookBorn ? 'outlook' : 'orbit', occurrence, changed, relink };
  };

  for (const occurrence of occurrences) {
    const entry = byUid.get(occurrence.icalUid);
    if (!entry) { unmatched.push(occurrence); continue; }
    claimed.add(entry.id);
    if (entry.session_date !== occurrence.date) {
      if (entry.source === 'outlook') {
        // Bookings carry a date, so a moved occurrence is a new session.
        plan.deletes.push(entry.id);
        unmatched.push(occurrence);
      } else {
        plan.issues.push(`"${entry.title || occurrence.subject || 'Meeting'}" was moved to ${occurrence.date} in Outlook; move the Orbit session by hand.`);
        finalWindow.set(entry.id, entry);
      }
      continue;
    }
    plan.matches.push(matchOf(entry, occurrence, false));
    finalWindow.set(entry.id, { starts_at: occurrence.startsAt, ends_at: occurrence.endsAt });
  }

  // A series occurrence re-issued under a new uid: keep the session (and its joiners).
  const stillUnmatched: RoomOccurrence[] = [];
  for (const occurrence of unmatched) {
    const entry = occurrence.seriesId ? sessions.find(candidate => (
      candidate.source === 'outlook'
      && !claimed.has(candidate.id)
      && candidate.outlook_series_id === occurrence.seriesId
      && candidate.session_date === occurrence.date
      && !(candidate.outlook_ical_uid && liveUids.has(candidate.outlook_ical_uid))
    )) : undefined;
    if (!entry) { stillUnmatched.push(occurrence); continue; }
    claimed.add(entry.id);
    plan.matches.push(matchOf(entry, occurrence, true));
    finalWindow.set(entry.id, { starts_at: occurrence.startsAt, ends_at: occurrence.endsAt });
  }

  for (const entry of sessions) {
    if (claimed.has(entry.id)) continue;
    if (entry.source === 'outlook') plan.deletes.push(entry.id);
    else {
      if (entry.outlook_ical_uid) plan.missingOrbit.push(entry.id);
      else plan.issues.push(`${meetingLabel(entry.title, entry.session_date, entry.starts_at)}: not booked in Outlook yet — re-save the room mailbox to retry`);
      finalWindow.set(entry.id, entry);
    }
  }

  for (const occurrence of stillUnmatched) {
    // An orphan meeting, or one whose cancel failed: importing it would resurrect a deleted session.
    if (occurrence.orbitMeeting) {
      plan.issues.push(`${meetingLabel(occurrence.subject, occurrence.date, occurrence.startsAt)}: an Orbit meeting whose session no longer exists — cancel it in Outlook`);
      continue;
    }
    const obstacles = [
      ...sessions
        .filter(entry => entry.session_date === occurrence.date && finalWindow.has(entry.id))
        .map(entry => ({ id: entry.id, ...finalWindow.get(entry.id)! })),
      ...plan.creates
        .filter(entry => entry.date === occurrence.date)
        .map(entry => ({ id: entry.icalUid, starts_at: entry.startsAt, ends_at: entry.endsAt })),
    ];
    if (overlappingSession(obstacles, { startsAt: occurrence.startsAt, endsAt: occurrence.endsAt })) {
      plan.clashes.push(clashOf(occurrence));
    } else {
      plan.creates.push(occurrence);
    }
  }
  return plan;
}

/**
 * Invites to add or drop so a session's guest list follows the meeting: the organiser plus everyone
 * who has not declined. Only people already invited can be removed, so manual joiners stay.
 */
export function planAttendees(args: {
  occurrence: RoomOccurrence;
  directory: Map<string, { id: string; name: string }>;
  existingInvites: { email: string; profile_id: string | null }[];
}): {
  add: { email: string; profileId: string | null; name: string | null }[];
  remove: { email: string; profileId: string | null }[];
} {
  const { occurrence, directory, existingInvites } = args;
  const desired = new Map<string, string | null>();
  if (occurrence.organizerEmail) desired.set(occurrence.organizerEmail, occurrence.organizerName);
  for (const attendee of occurrence.attendees) {
    if (attendee.response !== 'declined' && !desired.has(attendee.email)) desired.set(attendee.email, attendee.name);
  }
  const existing = new Set(existingInvites.map(invite => invite.email.toLowerCase()));
  return {
    add: [...desired]
      .filter(([email]) => !existing.has(email))
      .map(([email, name]) => ({ email, profileId: directory.get(email)?.id ?? null, name })),
    remove: existingInvites
      .filter(invite => !desired.has(invite.email.toLowerCase()))
      .map(invite => ({ email: invite.email, profileId: invite.profile_id })),
  };
}

/** Subscription ids from a Graph change notification whose `clientState` matches our secret. */
export function notifiedSubscriptionIds(body: unknown, clientState: string): string[] {
  if (!clientState) return [];
  const value = (body as { value?: unknown } | null)?.value;
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (entry?.clientState === clientState && typeof entry.subscriptionId === 'string') ids.add(entry.subscriptionId);
  }
  return [...ids];
}

/** Whether the room mailbox declined the meeting, per the organiser's copy of it. */
export function roomDeclined(event: Record<string, unknown> | undefined, roomMailbox: string): boolean {
  const room = roomMailbox.trim().toLowerCase();
  const attendees = (event?.attendees ?? []) as NonNullable<GraphCalendarEvent['attendees']>;
  return attendees.some(attendee => (
    attendee.emailAddress?.address?.trim().toLowerCase() === room && attendee.status?.response === 'declined'
  ));
}

/**
 * One result for a sync that ran again because Outlook changed meanwhile: the extra run's state (it
 * is the newer read), with the changes both runs made.
 */
export function mergeSyncRuns(first: RoomSyncResult, extra: RoomSyncResult): RoomSyncResult {
  if (extra.skipped) return first;
  return {
    ...extra,
    created: first.created + extra.created,
    updated: first.updated + extra.updated,
    deleted: first.deleted + extra.deleted,
  };
}

/** The room issue a subscription that could not be kept leaves behind; null when live updates work. */
export function subscriptionIssue(subscription: RoomSubscription | undefined): string | null {
  return subscription?.state === 'skipped'
    ? `Live updates from Outlook are off, so this room only syncs daily or on Sync now: ${subscription.reason || 'unknown reason'}`
    : null;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const firstFew = (lines: string[]) =>
  `${lines.slice(0, 3).join('; ')}${lines.length > 3 ? ` (+${lines.length - 3} more)` : ''}`;

/**
 * What an admin is told after linking a mailbox or Sync now: what was done, and every problem — a
 * failed sync, meetings not booked, issues, clashes, live updates being off. `ok` only when there is
 * no problem at all.
 */
export function roomSyncReport(result: {
  backfilled?: number;
  backfillFailures?: string[];
  subscription?: RoomSubscription;
  sync?: RoomSyncResult;
}): { ok: boolean; summary: string; problems: string[] } {
  const { sync, subscription, backfillFailures = [] } = result;
  const done: string[] = [];
  const problems: string[] = [];
  if (result.backfilled !== undefined) done.push(`${count(result.backfilled, 'Orbit session')} booked in Outlook`);
  if (sync?.skipped === 'locked') done.push('a sync was already running and will pick this up');
  else if (sync?.ok) done.push(`${sync.created} imported, ${sync.updated} updated, ${sync.deleted} removed`);
  else if (sync) problems.push(`The sync failed: ${sync.error || 'unknown error'}`);
  if (backfillFailures.length > 0) {
    problems.push(`${count(backfillFailures.length, 'Orbit session')} not booked in Outlook: ${firstFew(backfillFailures)}`);
  }
  const ownIssue = subscriptionIssue(subscription);
  const issues = (sync?.issues ?? []).filter(issue => issue !== ownIssue);
  if (issues.length > 0) problems.push(`${count(issues.length, 'issue')}: ${firstFew(issues)}`);
  if (sync?.clashes) problems.push(`${count(sync.clashes, 'Outlook meeting')} not imported (overlapping Orbit sessions)`);
  if (ownIssue) problems.push(ownIssue);
  else if (subscription) done.push(`live updates ${subscription.state}`);
  return { ok: problems.length === 0, summary: done.join(' · '), problems };
}

/** A Graph failure as a sentence an admin can act on. */
export function describeGraphFailure(failure: { status: number; code?: string; message?: string }): string {
  const { status, code, message } = failure;
  if (status === 403 || code === 'ErrorAccessDenied') {
    return 'Orbit cannot read this room mailbox (access denied). If the tenant uses an Exchange application access policy, add the room mailbox to it.';
  }
  if (status === 404 || ['ErrorInvalidUser', 'ResourceNotFound', 'MailboxNotEnabledForRESTAPI'].includes(code ?? '')) {
    return 'No mailbox found at this address — check the room mailbox email.';
  }
  if (code === 'no_token' || status === 0) return 'Microsoft Graph is not configured (no application token).';
  return `Outlook returned ${status}${code ? ` (${code})` : ''}: ${message || 'unknown error'}`;
}

/**
 * A Places failure as a sentence an admin can act on. Places needs its own application permission
 * and Exchange roles, which room-calendar access does not grant.
 */
export function describePlaceFailure(
  failure: { status: number; code?: string; message?: string },
  action: 'create' | 'read' | 'update'
): string {
  const { status, code, message } = failure;
  if (code === 'no_token' || status === 0) return 'Microsoft Graph is not configured (no application token).';
  if (status === 403 || code === 'ErrorAccessDenied' || code === 'Authorization_RequestDenied') {
    return `Orbit may not ${action} Outlook rooms. Grant the app the Place.ReadWrite.All application permission (admin consent) and the Exchange MailRecipient and TenantPlacesManagement roles.`;
  }
  if (status === 404) return 'Outlook does not list this room.';
  return `Outlook returned ${status}${code ? ` (${code})` : ''}: ${message || 'unknown error'}`;
}

/**
 * What an admin is told after syncing Orbit's rooms into Outlook: how many rooms were created,
 * updated or already matched, and every room that failed or still has a sync problem.
 */
export function roomProvisionReport(results: RoomProvisionResult[]): {
  ok: boolean; summary: string; problems: string[];
} {
  const tally = (outcome: RoomProvisionOutcome) => results.filter(result => result.outcome === outcome).length;
  const created = tally('created');
  const updated = tally('updated');
  const unchanged = tally('unchanged');
  const skipped = tally('skipped');
  const failed = tally('failed');
  const done: string[] = [];
  if (created > 0) done.push(`${count(created, 'room')} created in Outlook`);
  if (updated > 0) done.push(`${count(updated, 'room')} updated`);
  if (unchanged > 0) done.push(`${count(unchanged, 'room')} already in Outlook`);
  if (skipped > 0) done.push(`${count(skipped, 'room')} skipped`);
  if (failed > 0) done.push(`${count(failed, 'room')} failed`);
  if (done.length === 0) done.push('no room needed an Outlook mailbox');

  const problems: string[] = [];
  for (const result of results) {
    if (result.outcome === 'failed') {
      problems.push(`${result.name}: ${result.message || 'Outlook refused the room'}`);
      continue;
    }
    if (result.outcome === 'skipped') {
      if (result.message) problems.push(`${result.name}: ${result.message}`);
      continue;
    }
    if (result.message) problems.push(`${result.name}: ${result.message}`);
    const report = roomSyncReport(result);
    if (!report.ok) problems.push(`${result.name}: ${report.problems.join('; ')}`);
  }
  return { ok: problems.length === 0, summary: done.join(' · '), problems };
}
