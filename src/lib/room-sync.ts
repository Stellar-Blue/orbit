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
  start: { dateTime: string };
  end: { dateTime: string };
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

const RESPONSES: Record<string, OccurrenceAttendee['response']> = {
  accepted: 'accepted',
  tentativelyAccepted: 'tentative',
  declined: 'declined',
  organizer: 'organizer',
};

const BODY_LIMIT = 2000;

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
  return {
    icalUid: room.iCalUId,
    seriesId: room.seriesMasterId ?? null,
    date,
    startsAt: room.start.dateTime.slice(11, 16),
    endsAt: room.end.dateTime.slice(11, 16),
    subject: source.subject || null,
    body: source.body?.content?.trim().slice(0, BODY_LIMIT) || null,
    organizerEmail: organizer?.address?.trim().toLowerCase() || null,
    organizerName: organizer?.name || null,
    attendees,
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
      finalWindow.set(entry.id, entry);
    }
  }

  for (const occurrence of stillUnmatched) {
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
