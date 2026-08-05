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

export interface OutlookSyncResult {
  ok: boolean;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  skipped?: string;
  mailboxErrors: number;
  workPlan?: { created: number; updated: number; deleted: number; skipped?: string };
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

interface GraphEventPayload {
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  type: 'allDay' | 'singleInstance';
  showAs: 'oof' | 'workingElsewhere';
  singleValueExtendedProperties?: { id: string; value: string }[];
  id?: string;
}

type GraphResult =
  | { ok: true; event?: Record<string, unknown> }
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

export async function graphCreateEvent(mailboxEmail: string, payload: GraphEventPayload): Promise<GraphResult> {
  return graphRequest('POST', `${GRAPH_BASE}/users/${encodeURIComponent(mailboxEmail)}/calendar/events`, payload);
}

export async function graphPatchEvent(mailboxEmail: string, eventId: string, payload: Partial<GraphEventPayload>): Promise<GraphResult> {
  return graphRequest('PATCH', `${GRAPH_BASE}/users/${encodeURIComponent(mailboxEmail)}/calendar/events/${eventId}`, payload);
}

export async function graphGetEvent(mailboxEmail: string, eventId: string): Promise<GraphResult> {
  return graphRequest('GET', `${GRAPH_BASE}/users/${encodeURIComponent(mailboxEmail)}/calendar/events/${eventId}`);
}

export async function graphDeleteEvent(mailboxEmail: string, eventId: string): Promise<GraphResult> {
  return graphRequest('DELETE', `${GRAPH_BASE}/users/${encodeURIComponent(mailboxEmail)}/calendar/events/${eventId}`);
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

// ---------- Work plan payload builders ----------

export interface DesiredRemoteRule {
  marker: string;
  orbitId: string;
  weekday: string; // lowercase graph day, e.g. 'tuesday'
  from: string; // YYYY-MM-DD rule start
  to: string | null; // YYYY-MM-DD rule end (null = noEnd)
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

export function buildRemoteRulePayload(rule: DesiredRemoteRule): Record<string, unknown> {
  const hasEnd = !!rule.to && rule.to >= rule.from;
  return {
    start: { dateTime: `${rule.from}T00:00:00.0000000`, timeZone: ATHENS_TIMEZONE },
    end: { dateTime: `${rule.to || rule.from}T23:59:59.0000000`, timeZone: ATHENS_TIMEZONE },
    workLocationType: 'remote',
    recurrence: {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: [rule.weekday] },
      range: hasEnd
        ? { type: 'endDate', endDate: rule.to, recurrenceTimeZone: ATHENS_TIMEZONE }
        : { type: 'noEnd', recurrenceTimeZone: ATHENS_TIMEZONE },
    },
  };
}

export function buildTimeOffPayload(t: DesiredTimeOff): Record<string, unknown> {
  const startTime = t.startTime || '00:00:00';
  const endTime = t.endTime || '23:59:59';
  return {
    start: { dateTime: `${t.startDate}T${startTime}.0000000`, timeZone: ATHENS_TIMEZONE },
    end: { dateTime: `${t.endDate}T${endTime}.0000000`, timeZone: ATHENS_TIMEZONE },
    workLocationType: 'timeOff',
    timeOffDetails: { subject: t.subject, isAllDay: t.allDay },
  };
}

// ---------- Profile sync ----------

interface SyncOutlookOptions {
  onNoMailbox?: () => Promise<void>;
}

export async function syncOutlookForProfile(
  admin: SupabaseClient,
  profileId: string,
  options: SyncOutlookOptions = {}
): Promise<OutlookSyncResult> {
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
  const existing = await loadExistingRefs(admin, profileId, desired.eventMarkers());

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
    .like('marker', 'remote:%')
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
): Promise<{ created: number; updated: number; deleted: number; skipped?: string }> {
  const summary = { created: 0, updated: 0, deleted: 0 };

  // Remote rules (recurrences): Orbit remote patterns + ad-hoc remote days (one-day rules)
  const { data: patterns } = await admin
    .from('remote_patterns')
    .select('id, weekday, valid_from, valid_to')
    .eq('profile_id', profileId)
    .in('mode', ['remote_gr', 'remote_abroad'])
    .lte('valid_from', horizonEnd)
    .or(`valid_to.is.null,valid_to.gte.${today}`);

  const desiredRules = new Map<string, DesiredRemoteRule>();
  for (const p of (patterns || []) as Array<{ id: string; weekday: string; valid_from: string; valid_to: string | null }>) {
    const wd = graphWeekday(p.weekday);
    if (!wd) continue;
    desiredRules.set(`wprec:pat:${p.id}`, {
      marker: `wprec:pat:${p.id}`,
      orbitId: p.id,
      weekday: wd,
      from: p.valid_from,
      to: p.valid_to,
    });
  }

  const { data: remoteDays } = await admin
    .from('remote_days')
    .select('id, date')
    .eq('profile_id', profileId)
    .in('mode', ['remote_gr', 'remote_abroad'])
    .gte('date', today)
    .lte('date', horizonEnd);

  for (const rd of (remoteDays || []) as Array<{ id: string; date: string }>) {
    // Skip days already covered by a pattern rule (avoid duplicate rules for same weekday)
    const weekdayOfDay = graphWeekday(weekdayOf(rd.date));
    const covered = Array.from(desiredRules.values()).some(r =>
      r.weekday === weekdayOfDay && rd.date >= r.from && (!r.to || rd.date <= r.to)
    );
    if (covered) continue;
    desiredRules.set(`wprec:day:${rd.id}`, {
      marker: `wprec:day:${rd.id}`,
      orbitId: rd.id,
      weekday: weekdayOfDay || 'monday',
      from: rd.date,
      to: rd.date,
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

  const existingRefs = await loadWorkPlanRefs(admin, profileId);

  // Rules: create or PUT (idempotent full update)
  for (const rule of desiredRules.values()) {
    const ref = existingRefs.get(rule.marker);
    const payload = buildRemoteRulePayload(rule);
    if (ref?.external_id && !ref.deleted_at) {
      const res = await wpUpdateRecurrence(token, mailboxEmail, ref.external_id, payload);
      if (!res.ok) {
        if (isForbidden(res)) return { ...summary, skipped: `graph_error:${res.code || res.status}` };
        summary.updated += 1;
        continue;
      }
      summary.updated += 1;
    } else {
      const res = await wpCreateRecurrence(token, mailboxEmail, payload);
      if (!res.ok) {
        if (isForbidden(res)) return { ...summary, skipped: `graph_error:${res.code || res.status}` };
        continue;
      }
      await admin.from('external_refs').insert({
        provider: 'm365', profile_id: profileId, orbit_kind: 'remote', orbit_id: rule.orbitId,
        external_id: String(res.event?.id), marker: rule.marker,
      });
      summary.created += 1;
    }
  }

  // Time-off: create or PUT
  for (const t of desiredTimeOff.values()) {
    const ref = existingRefs.get(t.marker);
    const payload = buildTimeOffPayload(t);
    if (ref?.external_id && !ref.deleted_at) {
      const res = await wpUpdateOccurrence(token, mailboxEmail, ref.external_id, payload);
      if (!res.ok) {
        if (isForbidden(res)) return { ...summary, skipped: `graph_error:${res.code || res.status}` };
        summary.updated += 1;
        continue;
      }
      summary.updated += 1;
    } else {
      const res = await wpCreateOccurrence(token, mailboxEmail, payload);
      if (!res.ok) {
        if (isForbidden(res)) return { ...summary, skipped: `graph_error:${res.code || res.status}` };
        continue;
      }
      await admin.from('external_refs').insert({
        provider: 'm365', profile_id: profileId, orbit_kind: 'leave', orbit_id: t.orbitId,
        external_id: String(res.event?.id), marker: t.marker,
      });
      summary.created += 1;
    }
  }

  // Stale work plan artifacts
  for (const ref of existingRefs.values()) {
    if (desiredRules.has(ref.marker) || desiredTimeOff.has(ref.marker)) continue;
    if (!ref.external_id || ref.deleted_at) continue;

    // Legacy remote-day calendar events (replaced by work plan rules) — delete as events
    if (ref.marker.startsWith('remote:day:') || ref.marker.startsWith('remote:pat:')) {
      const res = await graphDeleteEvent(mailboxEmail, ref.external_id);
      if (!res.ok && !isForbidden(res)) {
        return { ...summary, skipped: `graph_error:${res.code || res.status}` };
      }
      await admin.from('external_refs').update({ deleted_at: new Date().toISOString() }).eq('id', ref.id);
      summary.deleted += 1;
      continue;
    }

    // leave: events are managed by the calendar-event path — never touch here
    if (!ref.marker.startsWith('wprec:') && !ref.marker.startsWith('wpto:')) continue;

    const isRule = ref.marker.startsWith('wprec:');
    const res = isRule
      ? await wpDeleteRecurrence(token, mailboxEmail, ref.external_id)
      : await wpDeleteOccurrence(token, mailboxEmail, ref.external_id);
    if (!res.ok && !isForbidden(res)) {
      return { ...summary, skipped: `graph_error:${res.code || res.status}` };
    }
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

// ---------- Desired events (leave only; remote lives in the work plan) ----------

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

  return {
    events,
    eventMarkers: () => new Set(events.keys()),
  };
}

async function loadExistingRefs(
  admin: SupabaseClient,
  profileId: string,
  desired: Set<string>
): Promise<Map<string, { id: string; marker: string; external_id: string | null; deleted_at: string | null }>> {
  // Query by profile_id (not orbit_id) so refs of DELETED records are still found and cleaned up
  const { data } = await admin
    .from('external_refs')
    .select('id, marker, external_id, deleted_at')
    .eq('provider', 'm365')
    .eq('profile_id', profileId)
    .eq('orbit_kind', 'leave');
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

const WEEKDAY_MAP: Record<string, string> = {
  Mon: 'monday', Tue: 'tuesday', Wed: 'wednesday', Thu: 'thursday', Fri: 'friday', Sat: 'saturday', Sun: 'sunday',
};

function graphWeekday(short: string): string | null {
  return WEEKDAY_MAP[short] || null;
}
