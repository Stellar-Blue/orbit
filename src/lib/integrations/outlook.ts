import { SupabaseClient } from '@supabase/supabase-js';
import { ATHENS_TIMEZONE } from './types';

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

// ---------- Token (client credentials, admin-consented) ----------

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
  if (res.status === 401 || res.status === 400) {
    const body = await res.json().catch(() => ({}));
    if (body.error === 'invalid_client') return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  tokenCache = { token: data.access_token as string, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

// ---------- Graph event CRUD ----------

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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  retries = 2
): Promise<GraphResult> {
  const token = await getGraphToken();
  if (!token) return { ok: false, status: 0, code: 'no_token' };
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429 && retries > 0) {
    const wait = Number(res.headers.get('retry-after') || 5) * 1000;
    await new Promise(r => setTimeout(r, Math.min(wait, 30_000)));
    return graphRequest(method, url, body, retries - 1);
  }
  if ((res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) && retries > 0) {
    await new Promise(r => setTimeout(r, 5_000));
    return graphRequest(method, url, body, retries - 1);
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

// ---------- Event payload builders ----------

export interface DesiredEvent {
  marker: string; // unique per Orbit record/day — also stored as the open extended property value
  orbitKind: 'leave' | 'remote';
  orbitId: string;
  subject: string;
  allDay: boolean;
  startDate: string; // YYYY-MM-DD (Athens)
  endDate: string; // YYYY-MM-DD (Athens, exclusive for all-day, inclusive day for timed)
  showAs: 'oof' | 'workingElsewhere';
  startTime?: string; // HH:mm for timed events
  endTime?: string;
}

export function buildAllDayPayload(ev: DesiredEvent): GraphEventPayload {
  // Graph rejects `type: allDay` for application-permission tokens ("Requested value 'allDay' was not found").
  // 24h singleInstance events from midnight render as all-day rows in Outlook and carry showAs oof/workingElsewhere,
  // which is what scheduling assistants key on.
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

  const desired = await computeDesiredEvents(admin, settings, profileId, today, horizonEnd);
  const existing = await loadExistingRefs(admin, profileId, desired);

  for (const ev of desired.values()) {
    const ref = existing.get(ev.marker);
    if (ref?.external_id && !ref.deleted_at) {
      // Verify & patch drift
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
        orbit_kind: ev.orbitKind,
        orbit_id: ev.orbitId,
        external_id: String(created.event?.id),
        marker: ev.marker,
      });
      result.created += 1;
    }
  }

  // Delete stale Orbit-created events (cancelled leave, removed remote day, shrunk range)
  for (const ref of existing.values()) {
    if (desired.has(ref.marker)) continue;
    if (!ref.external_id || ref.deleted_at) continue;
    const deleted = await graphDeleteEvent(profile.work_email, ref.external_id);
    if (!deleted.ok) {
      result.skipped = `graph_error:${deleted.code || deleted.status}`;
      return result;
    }
    await admin.from('external_refs').update({ deleted_at: new Date().toISOString() }).eq('id', ref.id);
    result.deleted += 1;
  }

  result.ok = true;
  return result;
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
  // App-only tokens create 24h singleInstance events; drift if Graph stores something else
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
  // Visible once — dedupe by checking for an existing exception row for this profile
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

async function computeDesiredEvents(
  admin: SupabaseClient,
  settings: GraphSettings,
  profileId: string,
  today: string,
  horizonEnd: string
): Promise<Map<string, DesiredEvent>> {
  const desired = new Map<string, DesiredEvent>();

  const { data: leaves } = await admin
    .from('leave_requests')
    .select('id, start_date, end_date, half_day_start, half_day_end')
    .eq('profile_id', profileId)
    .in('status', ['approved', 'in_progress', 'taken'])
    .lte('start_date', horizonEnd)
    .gte('end_date', today);

  const leaveDays = new Set<string>();
  for (const leave of (leaves || []) as Array<{ id: string; start_date: string; end_date: string; half_day_start: boolean; half_day_end: boolean }>) {
    const start = leave.start_date < today ? today : leave.start_date;
    const end = leave.end_date > horizonEnd ? horizonEnd : leave.end_date;

    if (leave.half_day_start || leave.half_day_end) {
      // Half-day: timed event covering the half (morning 09:00–13:00 or afternoon 13:00–17:00 Athens)
      if (leave.half_day_start && leave.start_date >= start && leave.start_date <= end) {
        desired.set(`leave:${leave.id}`, {
          marker: `leave:${leave.id}`,
          orbitKind: 'leave',
          orbitId: leave.id,
          subject: settings.halfDayLabel,
          allDay: false,
          startDate: leave.start_date,
          endDate: leave.start_date,
          startTime: '09:00',
          endTime: '13:00',
          showAs: 'oof',
        });
        leaveDays.add(leave.start_date);
      }
      if (leave.half_day_end && leave.end_date >= start && leave.end_date <= end) {
        desired.set(`leave:${leave.id}:end`, {
          marker: `leave:${leave.id}:end`,
          orbitKind: 'leave',
          orbitId: leave.id,
          subject: settings.halfDayLabel,
          allDay: false,
          startDate: leave.end_date,
          endDate: leave.end_date,
          startTime: '13:00',
          endTime: '17:00',
          showAs: 'oof',
        });
        leaveDays.add(leave.end_date);
      }
      // If only half-days and no full range, skip the all-day span
      if (leave.half_day_start && leave.half_day_end && leave.start_date === leave.end_date) continue;
      const fullStart = leave.half_day_start ? addDays(leave.start_date, 1) : leave.start_date;
      const fullEnd = leave.half_day_end ? addDays(leave.end_date, -1) : leave.end_date;
      if (fullStart > fullEnd) continue;
      desired.set(`leave:${leave.id}:full`, {
        marker: `leave:${leave.id}:full`,
        orbitKind: 'leave',
        orbitId: leave.id,
        subject: settings.leaveLabel,
        allDay: true,
        startDate: fullStart,
        endDate: addDays(fullEnd, 1), // exclusive
        showAs: 'oof',
      });
      forEachDay(fullStart, fullEnd, d => leaveDays.add(d));
    } else {
      desired.set(`leave:${leave.id}`, {
        marker: `leave:${leave.id}`,
        orbitKind: 'leave',
        orbitId: leave.id,
        subject: settings.leaveLabel,
        allDay: true,
        startDate: start,
        endDate: addDays(end, 1), // all-day events use exclusive end
        showAs: 'oof',
      });
      forEachDay(start, end, d => leaveDays.add(d));
    }
  }

  // Remote days (declared rows)
  const { data: remoteDays } = await admin
    .from('remote_days')
    .select('id, date, mode')
    .eq('profile_id', profileId)
    .in('mode', ['remote_gr', 'remote_abroad'])
    .gte('date', today)
    .lte('date', horizonEnd);

  for (const rd of (remoteDays || []) as Array<{ id: string; date: string }>) {
    if (leaveDays.has(rd.date)) continue; // leave wins
    desired.set(`remote:day:${rd.id}`, {
      marker: `remote:day:${rd.id}`,
      orbitKind: 'remote',
      orbitId: rd.id,
      subject: settings.remoteLabel,
      allDay: true,
      startDate: rd.date,
      endDate: addDays(rd.date, 1),
      showAs: 'workingElsewhere',
    });
  }

  // Remote patterns (recurring weekly) — expanded into per-day desired events
  const { data: patterns } = await admin
    .from('remote_patterns')
    .select('id, weekday, valid_from, valid_to')
    .eq('profile_id', profileId)
    .in('mode', ['remote_gr', 'remote_abroad'])
    .lte('valid_from', horizonEnd)
    .or(`valid_to.is.null,valid_to.gte.${today}`);

  const weekdayIndex: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  for (const p of (patterns || []) as Array<{ id: string; weekday: string; valid_from: string; valid_to: string | null }>) {
    const wd = weekdayIndex[p.weekday];
    if (wd === undefined) continue;
    const from = p.valid_from > today ? p.valid_from : today;
    const to = p.valid_to && p.valid_to < horizonEnd ? p.valid_to : horizonEnd;
    let cursor = from;
    while (cursor <= to) {
      const idx = weekdayIndexOf(cursor);
      if (idx === wd && !leaveDays.has(cursor)) {
        desired.set(`remote:pat:${p.id}:${cursor}`, {
          marker: `remote:pat:${p.id}:${cursor}`,
          orbitKind: 'remote',
          orbitId: p.id,
          subject: settings.remoteLabel,
          allDay: true,
          startDate: cursor,
          endDate: addDays(cursor, 1),
          showAs: 'workingElsewhere',
        });
      }
      cursor = addDays(cursor, 1);
    }
  }

  return desired;
}

async function loadExistingRefs(
  admin: SupabaseClient,
  profileId: string,
  desired: Map<string, DesiredEvent>
): Promise<Map<string, { id: string; marker: string; external_id: string | null; deleted_at: string | null }>> {
  const orbitIds = Array.from(new Set(desired.values().map(d => d.orbitId)));
  const { data } = await admin
    .from('external_refs')
    .select('id, marker, external_id, deleted_at')
    .eq('provider', 'm365')
    .in('orbit_kind', ['leave', 'remote'])
    .in('orbit_id', orbitIds);
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

function weekdayIndexOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

function forEachDay(from: string, to: string, fn: (d: string) => void): void {
  let d = from;
  while (d <= to) {
    fn(d);
    d = addDays(d, 1);
  }
}
