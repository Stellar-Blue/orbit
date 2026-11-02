import { SupabaseClient } from '@supabase/supabase-js';
import { ATHENS_TIMEZONE } from './types';
import { getDelegatedToken } from './msal';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const ORBIT_REF_PROP = 'String {66f5a359-d465-4757-b8e7-ef2d44c7f74f} Name orbitRef';

let tokenCache: { token: string; expiresAt: number } | null = null;

export interface GraphSettings {
  enabled: boolean;
  leaveLabel: string;
  remoteLabel: string;
  halfDayLabel: string;
  horizonDays: number;
}

export interface WorkPlanSummary {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  /** Set when the pass aborted because consent is gone (403). */
  skipped?: string;
  /** Non-fatal Graph failures, one `<op>:<code>` entry each. Never silently dropped. */
  errors: string[];
}

export interface OutlookSyncResult {
  ok: boolean;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  skipped?: string;
  mailboxErrors: number;
  workPlan?: WorkPlanSummary;
}

export function hasGraphCredentials(): boolean {
  return !!(process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET && process.env.GRAPH_TENANT_ID);
}

export async function getGraphSettings(admin: SupabaseClient): Promise<GraphSettings> {
  const { data } = await admin.from('integration_settings').select('key,value').eq('provider', 'm365');
  const map: Record<string, string> = {};
  (data || []).forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });
  return {
    enabled: map.enabled !== 'false',
    leaveLabel: map.leave_label ?? 'Out of office',
    remoteLabel: map.remote_label ?? 'Working remotely',
    halfDayLabel: map.half_day_label ?? 'Out of office (afternoon)',
    horizonDays: Math.max(1, Number(map.horizon_days) || 60),
  };
}

// ---------- Token (application, client credentials — calendar events) ----------

export async function getGraphToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  if (!hasGraphCredentials()) return null;
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GRAPH_CLIENT_ID!,
        client_secret: process.env.GRAPH_CLIENT_SECRET!,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  tokenCache = { token: data.access_token as string, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

// ---------- Graph event CRUD (application token) ----------

interface GraphAttendee {
  emailAddress: { address: string; name?: string };
  type: 'required' | 'optional';
}

interface GraphEventPayload {
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  type: 'allDay' | 'singleInstance';
  showAs: 'oof' | 'workingElsewhere' | 'busy';
  singleValueExtendedProperties?: { id: string; value: string }[];
  /** Meeting invite fields — only the session invitations use them. */
  attendees?: GraphAttendee[];
  body?: { contentType: 'text' | 'html'; content: string };
  location?: { displayName: string };
  isReminderOn?: boolean;
  reminderMinutesBeforeStart?: number;
  allowNewTimeProposals?: boolean;
  id?: string;
}

type GraphResult =
  | { ok: true; event?: Record<string, unknown>; status?: number; code?: string }
  | { ok: false; status: number; code?: string; message?: string; retryAfter?: number };

async function graphRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  url: string,
  body?: unknown,
  token?: string,
  retries = 2
): Promise<GraphResult> {
  const bearer = token || (await getGraphToken());
  if (!bearer) return { ok: false, status: 0, code: 'no_token' };
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429 && retries > 0) {
    const wait = Number(res.headers.get('retry-after') || 5) * 1000;
    await new Promise(r => setTimeout(r, Math.min(wait, 30_000)));
    return graphRequest(method, url, body, token, retries - 1);
  }
  if ((res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) && retries > 0) {
    await new Promise(r => setTimeout(r, 5_000));
    return graphRequest(method, url, body, token, retries - 1);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = (data.error as { code?: string; message?: string }) || {};
    return { ok: false, status: res.status, code: err.code, message: err.message, retryAfter: Number(res.headers.get('retry-after') || 0) };
  }
  if (method === 'DELETE') return { ok: true };
  const data = await res.json();
  return { ok: true, event: data };
}

export async function graphCreateEvent(mailboxEmail: string, payload: GraphEventPayload, token?: string): Promise<GraphResult> {
  return graphRequest('POST', `${GRAPH_BASE}/users/${encodeURIComponent(mailboxEmail)}/calendar/events`, payload, token);
}

export async function graphPatchEvent(mailboxEmail: string, eventId: string, payload: Partial<GraphEventPayload>, token?: string): Promise<GraphResult> {
  return graphRequest('PATCH', `${GRAPH_BASE}/users/${encodeURIComponent(mailboxEmail)}/calendar/events/${eventId}`, payload, token);
}

export async function graphGetEvent(mailboxEmail: string, eventId: string): Promise<GraphResult> {
  return graphRequest('GET', `${GRAPH_BASE}/users/${encodeURIComponent(mailboxEmail)}/calendar/events/${eventId}`);
}

export async function graphDeleteEvent(mailboxEmail: string, eventId: string, token?: string): Promise<GraphResult> {
  return graphRequest('DELETE', `${GRAPH_BASE}/users/${encodeURIComponent(mailboxEmail)}/calendar/events/${eventId}`, undefined, token);
}

// ---------- Work plan CRUD (delegated token) ----------

function wpBase(mailboxEmail: string): string {
  return `${GRAPH_BASE}/users/${encodeURIComponent(mailboxEmail)}/settings/workHoursAndLocations`;
}

export async function wpCreateRecurrence(token: string, mailboxEmail: string, payload: Record<string, unknown>): Promise<GraphResult> {
  return graphRequest('POST', `${wpBase(mailboxEmail)}/recurrences`, payload, token);
}

export async function wpUpdateRecurrence(token: string, mailboxEmail: string, id: string, payload: Record<string, unknown>): Promise<GraphResult> {
  return graphRequest('PUT', `${wpBase(mailboxEmail)}/recurrences/${encodeURIComponent(id)}`, payload, token);
}

export async function wpDeleteRecurrence(token: string, mailboxEmail: string, id: string): Promise<GraphResult> {
  return graphRequest('DELETE', `${wpBase(mailboxEmail)}/recurrences/${encodeURIComponent(id)}`, undefined, token);
}

export async function wpCreateOccurrence(token: string, mailboxEmail: string, payload: Record<string, unknown>): Promise<GraphResult> {
  return graphRequest('POST', `${wpBase(mailboxEmail)}/occurrences`, payload, token);
}

export async function wpUpdateOccurrence(token: string, mailboxEmail: string, id: string, payload: Record<string, unknown>): Promise<GraphResult> {
  return graphRequest('PUT', `${wpBase(mailboxEmail)}/occurrences/${encodeURIComponent(id)}`, payload, token);
}

export async function wpDeleteOccurrence(token: string, mailboxEmail: string, id: string): Promise<GraphResult> {
  return graphRequest('DELETE', `${wpBase(mailboxEmail)}/occurrences/${encodeURIComponent(id)}`, undefined, token);
}

export async function wpListRecurrences(token: string, mailboxEmail: string): Promise<GraphResult> {
  return graphRequest('GET', `${wpBase(mailboxEmail)}/recurrences`, undefined, token);
}

export async function wpSetCurrentLocation(token: string, mailboxEmail: string, workLocationType: 'office' | 'remote' | 'timeOff'): Promise<GraphResult> {
  return graphRequest('POST', `${wpBase(mailboxEmail)}/occurrences/setCurrentLocation`, {
    updateScope: 'currentDay',
    workLocationType,
  }, token);
}

// ---------- Event payload builders ----------

export interface DesiredEvent {
  marker: string;
  orbitKind: 'leave' | 'remote';
  orbitId: string;
  subject: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  showAs: 'oof' | 'workingElsewhere';
  startTime?: string;
  endTime?: string;
}

export function buildAllDayPayload(ev: DesiredEvent): GraphEventPayload {
  // Graph rejects `type: allDay` for application-permission tokens. 24h singleInstance events
  // from midnight render as all-day rows and carry showAs, which scheduling keys on.
  return {
    subject: ev.subject,
    start: { dateTime: `${ev.startDate}T00:00:00`, timeZone: ATHENS_TIMEZONE },
    end: { dateTime: `${ev.endDate}T00:00:00`, timeZone: ATHENS_TIMEZONE },
    type: 'singleInstance',
    showAs: ev.showAs,
    singleValueExtendedProperties: [{ id: ORBIT_REF_PROP, value: ev.marker }],
  };
}

export function buildTimedPayload(ev: DesiredEvent): GraphEventPayload {
  return {
    subject: ev.subject,
    start: { dateTime: `${ev.startDate}T${ev.startTime || '09:00'}:00`, timeZone: ATHENS_TIMEZONE },
    end: { dateTime: `${ev.endDate}T${ev.endTime || '17:00'}:00`, timeZone: ATHENS_TIMEZONE },
    type: 'singleInstance',
    showAs: ev.showAs,
    singleValueExtendedProperties: [{ id: ORBIT_REF_PROP, value: ev.marker }],
  };
}

// ---------- Session meeting invites ----------

export interface SessionInviteDetails {
  organizerName: string;
  roomName: string;
  roomLocation?: string | null;
  sessionDate: string;
  /** `HH:MM:SS` from Postgres, or `HH:MM` from the dialog. */
  startsAt: string;
  endsAt: string;
  title?: string | null;
  description?: string | null;
  note?: string | null;
  attendees: string[];
}

const clock = (value: string): string => String(value || '').slice(0, 5);

const longDate = (dateStr: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ATHENS_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${dateStr}T12:00:00Z`));

/**
 * The Outlook side of a session invitation: a real meeting on the organiser's calendar with every
 * address as a required attendee, so Graph mails the invite and the meeting lands in each calendar.
 */
export function buildSessionInvitePayload(details: SessionInviteDetails): GraphEventPayload {
  const subject = details.title?.trim()
    ? `${details.title.trim()} · ${details.roomName}`
    : `Meeting in ${details.roomName}`;
  const where = details.roomLocation ? `${details.roomName} (${details.roomLocation})` : details.roomName;
  const description = details.description?.trim();
  const note = details.note?.trim();
  return {
    subject,
    body: {
      contentType: 'text',
      content: [
        `${details.organizerName} invited you to a session booked in Orbit.`,
        '',
        `Room: ${where}`,
        `When: ${longDate(details.sessionDate)}, ${clock(details.startsAt)} – ${clock(details.endsAt)}`,
        ...(description ? ['', description] : []),
        ...(note ? ['', note] : []),
      ].join('\n'),
    },
    start: { dateTime: `${details.sessionDate}T${clock(details.startsAt)}:00`, timeZone: ATHENS_TIMEZONE },
    end: { dateTime: `${details.sessionDate}T${clock(details.endsAt)}:00`, timeZone: ATHENS_TIMEZONE },
    location: { displayName: where },
    attendees: details.attendees.map(address => ({ emailAddress: { address }, type: 'required' as const })),
    type: 'singleInstance',
    showAs: 'busy',
    isReminderOn: true,
    reminderMinutesBeforeStart: 15,
    allowNewTimeProposals: false,
  };
}

/**
 * Puts the session on the organiser's calendar and keeps it in sync. The delegated token is used
 * when the organiser connected Microsoft, so the invitation comes from the person who booked; the
 * application token covers organisers who never connected, since Graph accepts application
 * `Calendars.ReadWrite` on any tenant mailbox.
 *
 * `existingEventId` is the single meeting a session owns: an edit patches it (Graph notifies the
 * attendees itself) and an empty attendee list cancels it. A meeting deleted by hand in Outlook is
 * recreated rather than silently lost.
 */
export async function syncSessionCalendarInvite(args: {
  admin: SupabaseClient;
  organizerProfileId: string;
  organizerEmail: string;
  details: SessionInviteDetails;
  existingEventId?: string | null;
}): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  const token = await getDelegatedToken(args.admin, args.organizerProfileId);
  const payload = buildSessionInvitePayload(args.details);

  if (args.existingEventId) {
    if (args.details.attendees.length === 0) {
      const cancelled = await graphDeleteEvent(args.organizerEmail, args.existingEventId, token || undefined);
      return cancelled.ok
        ? { ok: true }
        : { ok: false, error: cancelled.message || cancelled.code || `http_${cancelled.status}` };
    }
    const patched = await graphPatchEvent(args.organizerEmail, args.existingEventId, payload, token || undefined);
    if (patched.ok) return { ok: true, eventId: args.existingEventId };
    if (patched.status !== 404) {
      return { ok: false, error: patched.message || patched.code || `http_${patched.status}` };
    }
  }

  if (args.details.attendees.length === 0) return { ok: true };
  const created = await graphCreateEvent(args.organizerEmail, payload, token || undefined);
  if (!created.ok) return { ok: false, error: created.message || created.code || `http_${created.status}` };
  const eventId = (created.event as { id?: string } | undefined)?.id;
  return { ok: true, eventId };
}

/** Withdraws a meeting invite when the session it belongs to is deleted. */
export async function cancelSessionCalendarInvite(args: {
  admin: SupabaseClient;
  organizerProfileId: string;
  organizerEmail: string;
  eventId: string;
}): Promise<boolean> {
  const token = await getDelegatedToken(args.admin, args.organizerProfileId);
  const result = await graphDeleteEvent(args.organizerEmail, args.eventId, token || undefined);
  return result.ok;
}

// ---------- Work plan payload builders ----------

export interface DesiredRemoteRule {
  marker: string;
  orbitId: string;
  weekday: string; // lowercase graph day, e.g. 'tuesday'
  from: string; // YYYY-MM-DD rule start
}

export interface DesiredTimeOff {
  marker: string;
  orbitId: string;
  subject: string;
  allDay: boolean;
  startDate: string;
  startTime?: string;
  endDate: string;
  endTime?: string;
}

/**
 * A remote rule is always `weekly` + `noEnd`, because Graph accepts nothing else: `pattern.type`
 * must be `weekly` and `range.type` must be `noEnd` (verified against a live tenant — a bounded
 * or one-day rule is rejected with 400). A pattern carrying `valid_to` therefore stays remote in
 * the plan and is reverted to office/unspecified by the stale sweep once that date has passed.
 */
export function buildRemoteRulePayload(rule: DesiredRemoteRule): Record<string, unknown> {
  return {
    start: { dateTime: `${rule.from}T08:00:00.0000000`, timeZone: ATHENS_TIMEZONE },
    end: { dateTime: `${rule.from}T17:00:00.0000000`, timeZone: ATHENS_TIMEZONE },
    workLocationType: 'remote',
    recurrence: {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: [rule.weekday] },
      range: { type: 'noEnd', recurrenceTimeZone: ATHENS_TIMEZONE },
    },
  };
}

/**
 * Work-plan occurrences can only ever be `timeOff`: Graph refuses a `remote` occurrence outright
 * ("Only TimeOff work plan occurrences can be created via this endpoint"), and a timeOff one may
 * not carry a recurrenceId or be converted afterwards. That is why the plan holds recurring
 * remote patterns and nothing else, and why a single declared remote day is a calendar event.
 *
 * An all-day segment must end at 00:00 of the day AFTER its last day; `T23:59:59` is rejected
 * with "Invalid end time for IsAllDay segment".
 */
export function buildTimeOffPayload(t: DesiredTimeOff): Record<string, unknown> {
  const startDateTime = t.startTime ? `${t.startDate}T${t.startTime}` : `${t.startDate}T00:00:00`;
  const endDateTime = t.endTime ? `${t.endDate}T${t.endTime}` : `${addDays(t.endDate, 1)}T00:00:00`;
  return {
    start: { dateTime: `${startDateTime}.0000000`, timeZone: ATHENS_TIMEZONE },
    end: { dateTime: `${endDateTime}.0000000`, timeZone: ATHENS_TIMEZONE },
    workLocationType: 'timeOff',
    timeOffDetails: { subject: t.subject, isAllDay: t.allDay },
  };
}

// ---------- Profile sync ----------

/**
 * Coalesces concurrent syncs of the same profile into the run already in flight.
 *
 * ponytail: single-instance guard. Two overlapping runs both read "no ref yet" and then both POST
 * to Graph, which has no dedupe for our marker property — the calendar gets two identical events
 * and the orphan is never reconciled away. A warm serverless instance reuses this map; the race
 * only survives across cold instances (ceiling). Upgrade path: a DB advisory lock on the profile.
 */
const inFlightSyncs = new Map<string, Promise<OutlookSyncResult>>();

export async function syncOutlookForProfile(
  admin: SupabaseClient,
  profileId: string
): Promise<OutlookSyncResult> {
  const running = inFlightSyncs.get(profileId);
  if (running) return running;
  const run = runOutlookSync(admin, profileId).finally(() => { inFlightSyncs.delete(profileId); });
  inFlightSyncs.set(profileId, run);
  return run;
}

async function runOutlookSync(admin: SupabaseClient, profileId: string): Promise<OutlookSyncResult> {
  const result: OutlookSyncResult = { ok: false, created: 0, updated: 0, deleted: 0, unchanged: 0, mailboxErrors: 0 };

  if (!hasGraphCredentials()) {
    result.skipped = 'no_credentials';
    return result;
  }
  const settings = await getGraphSettings(admin);
  if (!settings.enabled) {
    result.skipped = 'disabled';
    return result;
  }

  const { data: profile } = await admin.from('profiles').select('id, work_email').eq('id', profileId).maybeSingle();
  if (!profile?.work_email) {
    result.skipped = 'no_mailbox';
    return result;
  }

  const today = athensTodayStr();
  const horizonEnd = addDays(today, settings.horizonDays - 1);

  // Work plan mirroring needs a delegated token (application tokens are unsupported there)
  const delegatedToken = await getDelegatedToken(admin, profileId);

  const desired = await computeDesiredEvents(admin, settings, profileId, today, horizonEnd);
  const existing = await loadExistingRefs(admin, profileId);

  for (const ev of desired.events.values()) {
    const ref = existing.get(ev.marker);
    if (ref?.external_id && !ref.deleted_at) {
      const current = await graphGetEvent(profile.work_email, ref.external_id);
      if (!current.ok) {
        if (isMailboxMissing(current)) {
          result.mailboxErrors += 1;
          await recordMailboxException(admin, profileId, current.code || 'mailbox_not_found');
          result.ok = true;
          continue;
        }
        result.skipped = `graph_error:${current.code || current.status}`;
        return result;
      }
      const needsPatch = eventDrifted(current.event, ev);
      if (needsPatch) {
        const payload = ev.allDay ? buildAllDayPayload(ev) : buildTimedPayload(ev);
        delete payload.singleValueExtendedProperties;
        const patched = await graphPatchEvent(profile.work_email, ref.external_id, payload);
        if (!patched.ok) {
          result.skipped = `graph_error:${patched.code || patched.status}`;
          return result;
        }
        result.updated += 1;
      } else {
        result.unchanged += 1;
      }
    } else {
      const payload = ev.allDay ? buildAllDayPayload(ev) : buildTimedPayload(ev);
      const created = await graphCreateEvent(profile.work_email, payload);
      if (!created.ok) {
        if (isMailboxMissing(created)) {
          result.mailboxErrors += 1;
          await recordMailboxException(admin, profileId, created.code || 'mailbox_not_found');
          result.ok = true;
          continue;
        }
        result.skipped = `graph_error:${created.code || created.status}`;
        return result;
      }
      await admin.from('external_refs').insert({
        provider: 'm365',
        profile_id: profileId,
        orbit_kind: ev.orbitKind,
        orbit_id: ev.orbitId,
        external_id: String(created.event?.id),
        marker: ev.marker,
      });
      result.created += 1;
    }
  }

  // Delete stale Orbit-created events (cancelled leave, shrunk range, legacy remote events)
  for (const ref of existing.values()) {
    if (desired.eventMarkers().has(ref.marker)) continue;
    if (!ref.external_id || ref.deleted_at) continue;
    const deleted = await graphDeleteEvent(profile.work_email, ref.external_id);
    if (!deleted.ok) {
      if (!isMailboxMissing(deleted)) {
        result.skipped = `graph_error:${deleted.code || deleted.status}`;
        return result;
      }
      // Event already gone (e.g. deleted manually in Outlook) — just drop the ref
    }
    await admin.from('external_refs').update({ deleted_at: new Date().toISOString() }).eq('id', ref.id);
    result.deleted += 1;
  }

  // ---------- Work plan mirroring (delegated) ----------
  if (delegatedToken) {
    result.workPlan = await syncWorkPlan(admin, delegatedToken, profile.work_email, settings, profileId, today, horizonEnd);
  }

  // Legacy "Working remotely" calendar events (pre-work-plan) — removed regardless of delegated connect
  await cleanupLegacyRemoteEvents(admin, profileId, profile.work_email, result);

  result.ok = true;
  return result;
}

async function cleanupLegacyRemoteEvents(
  admin: SupabaseClient,
  profileId: string,
  mailboxEmail: string,
  result: OutlookSyncResult
) {
  const { data: refs } = await admin
    .from('external_refs')
    .select('id, marker, external_id, deleted_at')
    .eq('provider', 'm365')
    .eq('profile_id', profileId)
    .eq('orbit_kind', 'remote')
    .like('marker', 'remote:pat:%')
    .is('deleted_at', null);
  for (const ref of (refs || []) as Array<{ id: string; external_id: string | null }>) {
    if (!ref.external_id) continue;
    const res = await graphDeleteEvent(mailboxEmail, ref.external_id);
    if (!res.ok && !isForbidden(res) && !isMailboxMissing(res)) {
      result.skipped = `graph_error:${res.code || res.status}`;
      return;
    }
    await admin.from('external_refs').update({ deleted_at: new Date().toISOString() }).eq('id', ref.id);
    result.deleted += 1;
  }
}

async function syncWorkPlan(
  admin: SupabaseClient,
  token: string,
  mailboxEmail: string,
  settings: GraphSettings,
  profileId: string,
  today: string,
  horizonEnd: string
): Promise<WorkPlanSummary> {
  const summary: WorkPlanSummary = { created: 0, updated: 0, deleted: 0, unchanged: 0, errors: [] };

  /**
   * Graph writes fail for two different reasons and they need different responses: a 403 means
   * consent is gone for the whole plan, so the pass aborts; anything else is recorded and the pass
   * carries on. Every non-403 failure used to be silently `continue`d, which is how months of
   * rejected writes went unnoticed.
   */
  const noteFailure = (op: string, r: GraphResult): boolean => {
    if (r.ok) return false;
    if (isForbidden(r)) {
      summary.skipped = `graph_error:${r.code || r.status}`;
      return true;
    }
    summary.errors.push(`${op}:${r.code || r.status}`);
    console.error(`outlook work plan ${op} failed for ${profileId}: ${r.status} ${r.code || ''} ${r.message || ''}`);
    return false;
  };

  // Remote rules (recurrences): one `weekly` rule per remote-pattern weekday. Ad-hoc declared days
  // have no work-plan representation at all (Graph takes `timeOff` occurrences only), so they are
  // mirrored as calendar events by computeDesiredEvents instead.
  const { data: patterns } = await admin
    .from('remote_patterns')
    .select('id, weekday, valid_from')
    .eq('profile_id', profileId)
    .in('mode', ['remote_gr', 'remote_abroad'])
    .lte('valid_from', horizonEnd)
    .or(`valid_to.is.null,valid_to.gte.${today}`);

  const desiredRules = new Map<string, DesiredRemoteRule>();
  const patternWeekday = new Map<string, string>();
  for (const p of (patterns || []) as Array<{ id: string; weekday: string; valid_from: string }>) {
    const wd = graphWeekday(p.weekday);
    if (!wd) continue;
    patternWeekday.set(p.id, wd);
    desiredRules.set(`wprec:pat:${p.id}`, {
      marker: `wprec:pat:${p.id}`,
      orbitId: p.id,
      weekday: wd,
      from: p.valid_from,
    });
  }

  // Time-off occurrences: leave days
  const desiredTimeOff = new Map<string, DesiredTimeOff>();
  const { data: leaves } = await admin
    .from('leave_requests')
    .select('id, start_date, end_date, half_day_start, half_day_end')
    .eq('profile_id', profileId)
    .in('status', ['approved', 'in_progress', 'taken'])
    .lte('start_date', horizonEnd)
    .gte('end_date', today);

  for (const leave of (leaves || []) as Array<{ id: string; start_date: string; end_date: string; half_day_start: boolean; half_day_end: boolean }>) {
    const start = leave.start_date < today ? today : leave.start_date;
    const end = leave.end_date > horizonEnd ? horizonEnd : leave.end_date;

    if (leave.half_day_start || leave.half_day_end) {
      if (leave.half_day_start && leave.start_date >= start && leave.start_date <= end) {
        desiredTimeOff.set(`wpto:${leave.id}:start`, {
          marker: `wpto:${leave.id}:start`, orbitId: leave.id, subject: settings.halfDayLabel,
          allDay: false, startDate: leave.start_date, startTime: '09:00:00', endDate: leave.start_date, endTime: '13:00:00',
        });
      }
      if (leave.half_day_end && leave.end_date >= start && leave.end_date <= end) {
        desiredTimeOff.set(`wpto:${leave.id}:end`, {
          marker: `wpto:${leave.id}:end`, orbitId: leave.id, subject: settings.halfDayLabel,
          allDay: false, startDate: leave.end_date, startTime: '13:00:00', endDate: leave.end_date, endTime: '17:00:00',
        });
      }
      if (leave.half_day_start && leave.half_day_end && leave.start_date === leave.end_date) continue;
      const fullStart = leave.half_day_start ? addDays(leave.start_date, 1) : leave.start_date;
      const fullEnd = leave.half_day_end ? addDays(leave.end_date, -1) : leave.end_date;
      if (fullStart > fullEnd) continue;
      desiredTimeOff.set(`wpto:${leave.id}:full`, {
        marker: `wpto:${leave.id}:full`, orbitId: leave.id, subject: settings.leaveLabel,
        allDay: true, startDate: fullStart, endDate: fullEnd,
      });
    } else {
      desiredTimeOff.set(`wpto:${leave.id}`, {
        marker: `wpto:${leave.id}`, orbitId: leave.id, subject: settings.leaveLabel,
        allDay: true, startDate: start, endDate: end,
      });
    }
  }

  // No ad-hoc remote block here on purpose: Graph rejects `remote` work-plan occurrences with
  // "Only TimeOff work plan occurrences can be created via this endpoint", so a single declared
  // day cannot live in the plan. computeDesiredEvents gives it a calendar event instead, and the
  // stale sweep below leaves those events alone because they carry a desired event marker.

  const existingRefs = await loadWorkPlanRefs(admin, profileId);

  // Office days: every work_schedule weekday that is NOT a remote-pattern day is an office day.
  // Orbit ensures the plan shows `office` explicitly so the calendar reads at a glance.
  const { data: profRow } = await admin.from('profiles').select('work_schedule').eq('id', profileId).maybeSingle();
  const workSchedule: string[] = profRow?.work_schedule || [];
  const patternWeekdays = new Set(Array.from(desiredRules.values()).map(r => r.weekday));
  const desiredOffice = new Map<string, string>(); // graph weekday -> marker
  for (const day of workSchedule) {
    const wd = graphWeekday(day);
    if (!wd || patternWeekdays.has(wd)) continue;
    desiredOffice.set(wd, `wprec:off:${wd}`);
  }

  // Reconcile remote rules against the user's EXISTING work plan.
  // The plan has one recurring rule per weekday; Orbit flips the matching rule to `remote`
  // (never creating overlapping segments — Graph rejects those), and reverts to `office`
  // when the Orbit pattern no longer calls for remote that day.
  const existingRules = await wpListRecurrences(token, mailboxEmail);
  if (!existingRules.ok) {
    // Must fail closed: without the live rule list we would not recognise the user's own rules
    // and would create duplicates alongside them.
    return { ...summary, skipped: `graph_error:${existingRules.code || existingRules.status}` };
  }
  const rulesByWeekday = new Map<string, Record<string, unknown>>();
  for (const r of (existingRules.event?.value as Array<Record<string, unknown>> | undefined) || []) {
    const days = (r.recurrence as { pattern?: { daysOfWeek?: string[] } } | undefined)?.pattern?.daysOfWeek || [];
    if (days.length === 1 && !rulesByWeekday.has(days[0])) {
      rulesByWeekday.set(days[0], r);
    }
  }

  /**
   * Graph replaces work-plan rule ids when it regenerates a plan (editing it in Outlook does this),
   * which used to leave every `external_ref` pointing at a dead id and cost a doomed PUT per weekday
   * on every single sync. Re-point the ref at the live rule for the weekday and report whether that
   * rule is already in the wanted state.
   */
  const liveRule = async (
    refId: string,
    refExternalId: string | null,
    wd: string,
    want: 'office' | 'remote'
  ): Promise<{ id: string; done: boolean } | null> => {
    const live = rulesByWeekday.get(wd);
    if (!live) {
      await admin.from('external_refs').update({ deleted_at: new Date().toISOString() }).eq('id', refId);
      return null;
    }
    if (String(live.id) !== refExternalId) {
      await admin.from('external_refs').update({ external_id: String(live.id) }).eq('id', refId);
    }
    return { id: String(live.id), done: live.workLocationType === want };
  };

  for (const rule of desiredRules.values()) {
    const ref = existingRefs.get(rule.marker);
    if (ref?.external_id && !ref.deleted_at) {
      const live = await liveRule(ref.id, ref.external_id, rule.weekday, 'remote');
      if (live) {
        if (live.done) {
          summary.unchanged += 1;
          continue;
        }
        const current = rulesByWeekday.get(rule.weekday) || {};
        const res = await wpUpdateRecurrence(token, mailboxEmail, live.id, { ...current, workLocationType: 'remote' });
        if (noteFailure('set-remote-rule', res)) return summary;
        if (res.ok) summary.updated += 1;
        continue;
      }
    }

    const existing = rulesByWeekday.get(rule.weekday);
    if (existing) {
      if (existing.workLocationType === 'remote') {
        // Already remote in the plan — nothing to do (may be the user's own plan)
        continue;
      }
      // Flip the user's rule for this weekday to remote
      const res = await wpUpdateRecurrence(token, mailboxEmail, String(existing.id), { ...existing, workLocationType: 'remote' });
      if (noteFailure('flip-remote-rule', res)) return summary;
      if (!res.ok) continue;
      await admin.from('external_refs').insert({
        provider: 'm365', profile_id: profileId, orbit_kind: 'remote', orbit_id: rule.orbitId,
        external_id: String(existing.id), marker: rule.marker,
      });
      summary.updated += 1;
      continue;
    }

    // No plan rule for this weekday — create one (08:00–17:00 segment, `noEnd` weekly recurrence)
    const res = await wpCreateRecurrence(token, mailboxEmail, buildRemoteRulePayload(rule));
    if (noteFailure('create-remote-rule', res)) return summary;
    if (!res.ok) continue;
    await admin.from('external_refs').insert({
      provider: 'm365', profile_id: profileId, orbit_kind: 'remote', orbit_id: rule.orbitId,
      external_id: String(res.event?.id), marker: rule.marker,
    });
    summary.created += 1;
  }

  // Office rules: flip/ensure `office` for every non-remote work-schedule weekday
  for (const [wd, marker] of desiredOffice) {
    const ref = existingRefs.get(marker);
    if (ref?.external_id && !ref.deleted_at) {
      const live = await liveRule(ref.id, ref.external_id, wd, 'office');
      if (live) {
        if (live.done) {
          summary.unchanged += 1;
          continue;
        }
        const current = rulesByWeekday.get(wd) || {};
        const res = await wpUpdateRecurrence(token, mailboxEmail, live.id, { ...current, workLocationType: 'office' });
        if (noteFailure('set-office-rule', res)) return summary;
        if (res.ok) summary.updated += 1;
        continue;
      }
    }
    const existing = rulesByWeekday.get(wd);
    if (existing) {
      if (existing.workLocationType === 'office') continue;
      const res = await wpUpdateRecurrence(token, mailboxEmail, String(existing.id), { ...existing, workLocationType: 'office' });
      if (noteFailure('flip-office-rule', res)) return summary;
      if (!res.ok) continue;
      await admin.from('external_refs').insert({
        provider: 'm365', profile_id: profileId, orbit_kind: 'remote', orbit_id: profileId,
        external_id: String(existing.id), marker,
      });
      summary.updated += 1;
      continue;
    }
    // Weekday has no plan rule at all — create an office rule
    const res = await wpCreateRecurrence(token, mailboxEmail, {
      start: { dateTime: `${today}T08:00:00.0000000`, timeZone: ATHENS_TIMEZONE },
      end: { dateTime: `${today}T17:00:00.0000000`, timeZone: ATHENS_TIMEZONE },
      workLocationType: 'office',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: [wd] },
        range: { type: 'noEnd', startDate: today, recurrenceTimeZone: ATHENS_TIMEZONE },
      },
    });
    if (noteFailure('create-office-rule', res)) return summary;
    if (!res.ok) continue;
    await admin.from('external_refs').insert({
      provider: 'm365', profile_id: profileId, orbit_kind: 'remote', orbit_id: profileId,
      external_id: String(res.event?.id), marker,
    });
    summary.created += 1;
  }

  // Time-off: create or PUT
  for (const t of desiredTimeOff.values()) {
    const ref = existingRefs.get(t.marker);
    const payload = buildTimeOffPayload(t);
    if (ref?.external_id && !ref.deleted_at) {
      const res = await wpUpdateOccurrence(token, mailboxEmail, ref.external_id, payload);
      if (noteFailure('update-timeoff', res)) return summary;
      if (res.ok) {
        summary.updated += 1;
        continue;
      }
      if (!isGone(res)) continue; // recorded; leave it for the next pass
      // Occurrence is no longer in the plan — retire the ref and recreate it below
      await admin.from('external_refs').update({ deleted_at: new Date().toISOString() }).eq('id', ref.id);
    }
    const res = await wpCreateOccurrence(token, mailboxEmail, payload);
    if (noteFailure('create-timeoff', res)) return summary;
    if (!res.ok) continue;
    await admin.from('external_refs').insert({
      provider: 'm365', profile_id: profileId,
      orbit_kind: 'leave', orbit_id: t.orbitId,
      external_id: String(res.event?.id), marker: t.marker,
    });
    summary.created += 1;
  }

  // Stale work plan artifacts
  const desiredOfficeMarkers = new Set(desiredOffice.values());
  for (const ref of existingRefs.values()) {
    if (desiredRules.has(ref.marker) || desiredTimeOff.has(ref.marker) || desiredOfficeMarkers.has(ref.marker)) continue;
    if (!ref.external_id || ref.deleted_at) continue;

    if (ref.marker.startsWith('wprec:off:')) {
      // Office rule no longer desired (weekday became remote or left the work schedule) — revert to unspecified
      const wd = ref.marker.replace('wprec:off:', '');
      const existing = rulesByWeekday.get(wd);
      if (existing && String(existing.id) === ref.external_id) {
        const res = await wpUpdateRecurrence(token, mailboxEmail, ref.external_id, { ...existing, workLocationType: 'unspecified' });
        if (noteFailure('revert-office-rule', res)) return summary;
      } else {
        const res = await wpDeleteRecurrence(token, mailboxEmail, ref.external_id);
        if (noteFailure('delete-office-rule', res)) return summary;
      }
      await admin.from('external_refs').update({ deleted_at: new Date().toISOString() }).eq('id', ref.id);
      summary.deleted += 1;
      continue;
    }

    // Remote calendar events, deleted as events: pre-work-plan remote patterns (legacy markers, no
    // longer produced by anything) and ad-hoc declared days that dropped out of the horizon.
    if (ref.marker.startsWith('remote:day:') || ref.marker.startsWith('remote:pat:')) {
      const res = await graphDeleteEvent(mailboxEmail, ref.external_id);
      if (!res.ok && !isForbidden(res) && !isGone(res)) {
        return { ...summary, skipped: `graph_error:${res.code || res.status}` };
      }
      await admin.from('external_refs').update({ deleted_at: new Date().toISOString() }).eq('id', ref.id);
      summary.deleted += 1;
      continue;
    }

    // leave: events are managed by the calendar-event path — never touch here
    if (!ref.marker.startsWith('wprec:') && !ref.marker.startsWith('wpto:')) continue;

    const isRule = ref.marker.startsWith('wprec:');
    if (isRule) {
      // Restore the weekday rule to the baseline (`unspecified`) when we flipped it,
      // or delete rules we created once their Orbit pattern is gone
      const patternId = ref.marker.replace('wprec:pat:', '');
      const wd = patternWeekday.get(patternId);
      const existing = wd ? rulesByWeekday.get(wd) : undefined;
      if (existing && String(existing.id) === ref.external_id) {
        const revertTo = wd && desiredOffice.has(wd) ? 'office' : 'unspecified';
        const res = await wpUpdateRecurrence(token, mailboxEmail, ref.external_id, { ...existing, workLocationType: revertTo });
        if (noteFailure('revert-remote-rule', res)) return summary;
      } else {
        const res = await wpDeleteRecurrence(token, mailboxEmail, ref.external_id);
        if (noteFailure('delete-remote-rule', res)) return summary;
      }
      await admin.from('external_refs').update({ deleted_at: new Date().toISOString() }).eq('id', ref.id);
      summary.deleted += 1;
      continue;
    }

    const res = await wpDeleteOccurrence(token, mailboxEmail, ref.external_id);
    if (noteFailure('delete-timeoff', res)) return summary;
    await admin.from('external_refs').update({ deleted_at: new Date().toISOString() }).eq('id', ref.id);
    summary.deleted += 1;
  }

  return summary;
}

async function loadWorkPlanRefs(admin: SupabaseClient, profileId: string): Promise<Map<string, { id: string; marker: string; external_id: string | null; deleted_at: string | null }>> {
  // Query by profile_id so refs of DELETED records are still found and cleaned up
  const { data } = await admin
    .from('external_refs')
    .select('id, marker, external_id, deleted_at')
    .eq('provider', 'm365')
    .eq('profile_id', profileId)
    .in('orbit_kind', ['leave', 'remote']);
  const map = new Map<string, { id: string; marker: string; external_id: string | null; deleted_at: string | null }>();
  (data || []).forEach((r: { id: string; marker: string; external_id: string | null; deleted_at: string | null }) => map.set(r.marker, r));
  return map;
}

function isForbidden(r: { status: number; code?: string }): boolean {
  return r.status === 403 || r.code === 'Authorization_RequestDenied' || r.code === 'AuthenticationError';
}

function isGone(r: { status: number; code?: string }): boolean {
  return r.status === 404 || r.code === 'ErrorItemNotFound' || r.code === 'ResourceNotFound' || r.code === 'Request_ResourceNotFound';
}

function eventDrifted(event: Record<string, unknown> | undefined, ev: DesiredEvent): boolean {
  if (!event) return true;
  const start = (event.start as { dateTime?: string; timeZone?: string }) || {};
  const end = (event.end as { dateTime?: string; timeZone?: string }) || {};
  const startDateTime = (start.dateTime || '').slice(0, 19);
  const endDateTime = (end.dateTime || '').slice(0, 19);
  const showAs = event.showAs as string | undefined;
  const type = event.type as string | undefined;

  if (showAs !== ev.showAs) return true;
  if (type !== 'singleInstance') return true;

  const expectedStart = ev.allDay ? `${ev.startDate}T00:00:00` : `${ev.startDate}T${ev.startTime || '09:00'}:00`;
  const expectedEnd = ev.allDay ? `${ev.endDate}T00:00:00` : `${ev.endDate}T${ev.endTime || '17:00'}:00`;
  if (startDateTime !== expectedStart || endDateTime !== expectedEnd) return true;

  return false;
}

function isMailboxMissing(r: { status: number; code?: string }): boolean {
  return r.status === 404 ||
    r.code === 'ResourceNotFound' ||
    r.code === 'Request_ResourceNotFound' ||
    r.code === 'MailboxNotFound' ||
    r.code === 'ErrorInvalidUser';
}

async function recordMailboxException(admin: SupabaseClient, profileId: string, code: string) {
  const { data: existing } = await admin
    .from('integration_outbox')
    .select('id')
    .eq('provider', 'm365')
    .eq('status', 'exception')
    .eq('payload->>profile_id', profileId)
    .limit(1);
  if (existing && existing.length > 0) return;
  await admin.from('integration_outbox').insert({
    provider: 'm365',
    operation: 'mailbox_error',
    orbit_kind: 'status',
    orbit_id: profileId,
    payload: { profile_id: profileId },
    idempotency_key: `m365:mailbox:${profileId}`,
    ordering_key: `m365:${profileId}`,
    status: 'exception',
    last_error: `mailbox_not_found:${code}`,
  });
}

// ---------- Desired events (leave + ad-hoc declared remote days) ----------

interface DesiredSet {
  events: Map<string, DesiredEvent>;
  eventMarkers: () => Set<string>;
}

async function computeDesiredEvents(
  admin: SupabaseClient,
  settings: GraphSettings,
  profileId: string,
  today: string,
  horizonEnd: string
): Promise<DesiredSet> {
  const events = new Map<string, DesiredEvent>();
  const leaveRanges: Array<{ start: string; end: string }> = [];

  const { data: leaves } = await admin
    .from('leave_requests')
    .select('id, start_date, end_date, half_day_start, half_day_end')
    .eq('profile_id', profileId)
    .in('status', ['approved', 'in_progress', 'taken'])
    .lte('start_date', horizonEnd)
    .gte('end_date', today);

  for (const leave of (leaves || []) as Array<{ id: string; start_date: string; end_date: string; half_day_start: boolean; half_day_end: boolean }>) {
    const start = leave.start_date < today ? today : leave.start_date;
    const end = leave.end_date > horizonEnd ? horizonEnd : leave.end_date;
    leaveRanges.push({ start, end });

    if (leave.half_day_start || leave.half_day_end) {
      if (leave.half_day_start && leave.start_date >= start && leave.start_date <= end) {
        events.set(`leave:${leave.id}`, {
          marker: `leave:${leave.id}`, orbitKind: 'leave', orbitId: leave.id, subject: settings.halfDayLabel,
          allDay: false, startDate: leave.start_date, endDate: leave.start_date,
          startTime: '09:00', endTime: '13:00', showAs: 'oof',
        });
      }
      if (leave.half_day_end && leave.end_date >= start && leave.end_date <= end) {
        events.set(`leave:${leave.id}:end`, {
          marker: `leave:${leave.id}:end`, orbitKind: 'leave', orbitId: leave.id, subject: settings.halfDayLabel,
          allDay: false, startDate: leave.end_date, endDate: leave.end_date,
          startTime: '13:00', endTime: '17:00', showAs: 'oof',
        });
      }
      if (leave.half_day_start && leave.half_day_end && leave.start_date === leave.end_date) continue;
      const fullStart = leave.half_day_start ? addDays(leave.start_date, 1) : leave.start_date;
      const fullEnd = leave.half_day_end ? addDays(leave.end_date, -1) : leave.end_date;
      if (fullStart > fullEnd) continue;
      events.set(`leave:${leave.id}:full`, {
        marker: `leave:${leave.id}:full`, orbitKind: 'leave', orbitId: leave.id, subject: settings.leaveLabel,
        allDay: true, startDate: fullStart, endDate: addDays(fullEnd, 1), showAs: 'oof',
      });
    } else {
      events.set(`leave:${leave.id}`, {
        marker: `leave:${leave.id}`, orbitKind: 'leave', orbitId: leave.id, subject: settings.leaveLabel,
        allDay: true, startDate: start, endDate: addDays(end, 1), showAs: 'oof',
      });
    }
  }

  // Ad-hoc declared remote days become calendar events, because the Outlook work plan cannot hold
  // one: a `remote` work-plan occurrence is rejected ("Only TimeOff work plan occurrences can be
  // created via this endpoint") and a one-off rule is rejected too (`range.type` must be `noEnd`).
  // A day a remote *pattern* already covers keeps only its recurring rule, so every remote day has
  // exactly one representation, and a day inside leave keeps only the leave event (leave wins).
  const { data: adHocRemote } = await admin
    .from('remote_days')
    .select('id, date')
    .eq('profile_id', profileId)
    .in('mode', ['remote_gr', 'remote_abroad'])
    .gte('date', today)
    .lte('date', horizonEnd);

  const { data: remotePatterns } = await admin
    .from('remote_patterns')
    .select('weekday, valid_from, valid_to')
    .eq('profile_id', profileId)
    .in('mode', ['remote_gr', 'remote_abroad'])
    .lte('valid_from', horizonEnd)
    .or(`valid_to.is.null,valid_to.gte.${today}`);

  for (const rd of (adHocRemote || []) as Array<{ id: string; date: string }>) {
    if (remotePatternCovers((remotePatterns || []) as RemotePatternRow[], rd.date)) continue;
    if (leaveRanges.some(l => rd.date >= l.start && rd.date <= l.end)) continue;
    events.set(`remote:day:${rd.id}`, {
      marker: `remote:day:${rd.id}`, orbitKind: 'remote', orbitId: rd.id, subject: settings.remoteLabel,
      allDay: true, startDate: rd.date, endDate: addDays(rd.date, 1), showAs: 'workingElsewhere',
    });
  }

  return {
    events,
    eventMarkers: () => new Set(events.keys()),
  };
}

async function loadExistingRefs(
  admin: SupabaseClient,
  profileId: string
): Promise<Map<string, { id: string; marker: string; external_id: string | null; deleted_at: string | null }>> {
  // Query by profile_id (not orbit_id) so refs of DELETED records are still found and cleaned up
  const { data } = await admin
    .from('external_refs')
    .select('id, marker, external_id, deleted_at')
    .eq('provider', 'm365')
    .eq('profile_id', profileId)
    .in('orbit_kind', ['leave', 'remote'])
    .not('marker', 'like', 'wprec:%')
    .not('marker', 'like', 'wpto:%');
  const map = new Map<string, { id: string; marker: string; external_id: string | null; deleted_at: string | null }>();
  (data || []).forEach((r: { id: string; marker: string; external_id: string | null; deleted_at: string | null }) => map.set(r.marker, r));
  return map;
}

// ---------- Date helpers (Europe/Athens local strings) ----------

function athensTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ATHENS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(dateStr: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: ATHENS_TIMEZONE, weekday: 'short' }).format(new Date(`${dateStr}T12:00:00Z`));
}

interface RemotePatternRow {
  weekday: string;
  valid_from: string;
  valid_to: string | null;
}

/** A remote pattern already covers this date, so that day must not get a second artifact. */
function remotePatternCovers(patterns: RemotePatternRow[], dateStr: string): boolean {
  const wd = weekdayOf(dateStr);
  return patterns.some(p => p.weekday === wd && dateStr >= p.valid_from && (!p.valid_to || dateStr <= p.valid_to));
}

const WEEKDAY_MAP: Record<string, string> = {
  Mon: 'monday', Tue: 'tuesday', Wed: 'wednesday', Thu: 'thursday', Fri: 'friday', Sat: 'saturday', Sun: 'sunday',
};

function graphWeekday(short: string): string | null {
  return WEEKDAY_MAP[short] || null;
}
