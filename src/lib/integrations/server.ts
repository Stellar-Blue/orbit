import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ATHENS_TIMEZONE, DEFAULT_SLACK_SETTINGS } from './types';
import type { IntegrationSettings } from './types';

const SLACK_API = 'https://slack.com/api';

/**
 * Server-side integration helpers. Every function requires an admin (service role)
 * Supabase client — never call these with anon/user scoped clients.
 */

export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dev-placeholder';
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ---------- Europe/Athens time helpers ----------

export function athensToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ATHENS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

export function athensDateAt(dateStr: string, hour: number, minute = 0, second = 0): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  // Wall-clock time interpreted as UTC, minus Athens' UTC offset at that date
  const wallUtc = Date.UTC(y, mo - 1, d, hour, minute, second);
  const offsetMs = athensOffsetMs(new Date(wallUtc));
  return new Date(wallUtc - offsetMs);
}

function athensOffsetMs(utcDate: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ATHENS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(utcDate);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value || 0);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - utcDate.getTime();
}

export function athensEndOfDayUnix(dateStr: string): number {
  return Math.floor(athensDateAt(dateStr, 23, 59, 59).getTime() / 1000);
}

// ---------- Vault (encrypted secrets) ----------

export async function setVaultSecret(admin: SupabaseClient, name: string, secret: string): Promise<string | null> {
  // vault schema is not exposed via PostgREST — use the public SECURITY DEFINER wrappers
  const { data, error } = await admin.rpc('vault_set_secret', { p_name: name, p_secret: secret });
  if (error) return null;
  return data as string;
}

export async function getVaultSecret(admin: SupabaseClient, name: string): Promise<string | null> {
  const { data, error } = await admin.rpc('vault_get_secret', { p_name: name });
  if (error) return null;
  return (data as string | null) || null;
}

export async function deleteVaultSecret(admin: SupabaseClient, name: string): Promise<void> {
  await admin.rpc('vault_delete_secret', { p_name: name });
}

export function slackTokenSecretName(profileId: string): string {
  return `slack_token:${profileId}`;
}

// ---------- Slack API ----------

export interface SlackProfileResult {
  ok: boolean;
  error?: string;
  retryAfterSeconds?: number;
  status_text?: string;
  status_emoji?: string;
  status_expiration?: number;
}

async function slackFetch(path: string, token: string, body: Record<string, string>): Promise<SlackProfileResult> {
  const params = new URLSearchParams(body).toString();
  const res = await fetch(`${SLACK_API}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const retryAfter = Number(res.headers.get('retry-after') || 0);
  if (res.status === 429) {
    return { ok: false, error: 'rate_limited', retryAfterSeconds: retryAfter || 60 };
  }
  if (res.status >= 500 || res.status === 408) {
    return { ok: false, error: `http_${res.status}` };
  }
  const data = await res.json();
  return { ok: data.ok, error: data.error, retryAfterSeconds: retryAfter, status_text: data.profile?.status_text, status_emoji: data.profile?.status_emoji, status_expiration: data.profile?.status_expiration };
}

export async function slackGetProfile(token: string): Promise<SlackProfileResult> {
  return slackFetch('users.profile.get', token, {});
}

export async function slackSetProfile(token: string, profile: { status_text: string; status_emoji: string; status_expiration: number }): Promise<SlackProfileResult> {
  return slackFetch('users.profile.set', token, {
    profile: JSON.stringify(profile),
  });
}

// ---------- Settings ----------

export async function getSlackSettings(admin: SupabaseClient): Promise<IntegrationSettings> {
  const { data } = await admin.from('integration_settings').select('key,value').eq('provider', 'slack');
  const map: Record<string, string> = {};
  (data || []).forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });
  return {
    leave_label: map.leave_label ?? DEFAULT_SLACK_SETTINGS.leave_label,
    leave_emoji: map.leave_emoji ?? DEFAULT_SLACK_SETTINGS.leave_emoji,
    remote_label: map.remote_label ?? DEFAULT_SLACK_SETTINGS.remote_label,
    remote_emoji: map.remote_emoji ?? DEFAULT_SLACK_SETTINGS.remote_emoji,
    half_day_label: map.half_day_label ?? DEFAULT_SLACK_SETTINGS.half_day_label,
  };
}

// ---------- Outbox ----------

export interface OutboxOp {
  provider: 'slack' | 'm365';
  operation: string;
  orbit_kind: string;
  orbit_id: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  ordering_key: string;
}

export async function enqueueOutbox(admin: SupabaseClient, ops: OutboxOp[]): Promise<number> {
  if (ops.length === 0) return 0;
  const { error } = await admin.from('integration_outbox').upsert(
    ops.map(o => ({
      provider: o.provider,
      operation: o.operation,
      orbit_kind: o.orbit_kind,
      orbit_id: o.orbit_id,
      payload: o.payload,
      idempotency_key: o.idempotency_key,
      ordering_key: o.ordering_key,
      status: 'pending',
      attempts: 0,
    })),
    { onConflict: 'idempotency_key', ignoreDuplicates: true }
  );
  if (error) {
    console.error('enqueueOutbox error:', error);
    return 0;
  }
  return ops.length;
}

// ---------- Daily state computation ----------

export interface DayState {
  kind: 'leave' | 'remote' | 'none';
  label: string;
  emoji: string;
  expirationTs: number;
  leaveId?: string;
}

export async function computeDayState(
  admin: SupabaseClient,
  settings: IntegrationSettings,
  profileId: string,
  dateStr: string
): Promise<DayState> {
  const today = athensToday();

  const { data: leaveRows } = await admin
    .from('leave_requests')
    .select('id, start_date, end_date, half_day_start, half_day_end')
    .eq('profile_id', profileId)
    .in('status', ['approved', 'in_progress', 'taken'])
    .lte('start_date', dateStr)
    .gte('end_date', dateStr)
    .limit(1);

  const leave = leaveRows?.[0];
  if (leave) {
    const isHalfDay = !!leave.half_day_start || !!leave.half_day_end;
    const isToday = dateStr === today;
    return {
      kind: 'leave',
      label: isHalfDay ? settings.half_day_label : settings.leave_label,
      emoji: settings.leave_emoji,
      expirationTs: isToday ? athensEndOfDayUnix(dateStr) : athensEndOfDayUnix(leave.end_date),
      leaveId: leave.id,
    };
  }

  const { data: remoteRow } = await admin
    .from('remote_days')
    .select('mode')
    .eq('profile_id', profileId)
    .eq('date', dateStr)
    .maybeSingle();

  const isRemote = remoteRow ? (remoteRow.mode === 'remote_gr' || remoteRow.mode === 'remote_abroad') : null;
  if (isRemote === null) {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: ATHENS_TIMEZONE, weekday: 'short' })
      .format(new Date(`${dateStr}T12:00:00Z`));
    const { data: pattern } = await admin
      .from('remote_patterns')
      .select('mode')
      .eq('profile_id', profileId)
      .eq('weekday', weekday)
      .lte('valid_from', dateStr)
      .or(`valid_to.is.null,valid_to.gte.${dateStr}`)
      .maybeSingle();
    if (pattern && (pattern.mode === 'remote_gr' || pattern.mode === 'remote_abroad')) {
      return {
        kind: 'remote',
        label: settings.remote_label,
        emoji: settings.remote_emoji,
        expirationTs: athensEndOfDayUnix(dateStr),
      };
    }
    return { kind: 'none', label: '', emoji: '', expirationTs: 0 };
  }

  if (isRemote) {
    return {
      kind: 'remote',
      label: settings.remote_label,
      emoji: settings.remote_emoji,
      expirationTs: athensEndOfDayUnix(dateStr),
    };
  }
  return { kind: 'none', label: '', emoji: '', expirationTs: 0 };
}

// ---------- Slack status delivery ("never fight the human") ----------

interface OutboxRowLike {
  id: string;
  payload: Record<string, unknown>;
  attempts?: number;
}

export interface DeliverySummary {
  delivered: number;
  skipped: number;
  failed: number;
  exceptions: number;
}

export async function deliverSlackOutbox(admin: SupabaseClient, limit = 50): Promise<DeliverySummary> {
  const summary: DeliverySummary = { delivered: 0, skipped: 0, failed: 0, exceptions: 0 };
  const settings = await getSlackSettings(admin);

  // Due = never tried (next_retry_at IS NULL, the usual case) OR a backoff that has elapsed.
  // Both must live in ONE `.or`: chaining `.lte()` with a separate `.or('…is.null')` ANDs them,
  // so the query matched nothing and every op sat pending forever. Retries land in 'failed' with
  // a next_retry_at (see handleSlackApiError), so those rows have to be selected too — the
  // partial index over ('pending','failed') is the tell.
  const nowIso = new Date().toISOString();
  const { data: rows } = await admin
    .from('integration_outbox')
    .select('*')
    .eq('provider', 'slack')
    .in('status', ['pending', 'failed'])
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order('ordering_key', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit);

  const today = athensToday();
  for (const row of (rows || []) as OutboxRowLike[]) {
    const { profile_id, date } = row.payload as { profile_id: string; date: string };

    // Slack status is day-scoped: only today's op may be written. A past-dated mirror would only
    // push a status that already expired, and a future-dated one (e.g. a remote day added for
    // tomorrow) would flip the employee to remote now instead of on that day. Retire both — the
    // morning job enqueues today's op when the day actually starts (cron/integration-daily).
    if (!date || date !== today) {
      await markOutbox(row.id, 'skipped', !date ? 'missing_date' : date < today ? 'stale_date' : 'future_date', admin);
      summary.skipped += 1;
      continue;
    }

    const { data: integration } = await admin
      .from('employee_integrations')
      .select('*')
      .eq('profile_id', profile_id)
      .eq('provider', 'slack')
      .maybeSingle();

    if (!integration || integration.status !== 'connected') {
      await markOutbox(row.id, 'exception', integration ? `integration_status:${integration.status}` : 'no_slack_integration', admin);
      summary.exceptions += 1;
      continue;
    }

    const token = await getVaultSecret(admin, slackTokenSecretName(profile_id));
    if (!token) {
      await markOutbox(row.id, 'exception', 'token_missing', admin);
      summary.exceptions += 1;
      continue;
    }

    const state = await computeDayState(admin, settings, profile_id, date);

    if (state.kind === 'none') {
      // Clear: only if the current status is the one Orbit set (never clobber a human's status)
      const current = await slackGetProfile(token);
      if (!current.ok) {
        await handleSlackApiError(row, current, admin, profile_id);
        if (current.error === 'invalid_auth' || current.error === 'account_inactive' || current.error === 'not_authed') summary.exceptions += 1;
        else summary.failed += 1;
        continue;
      }
      const lastText = integration.last_set_status_text || '';
      const lastEmoji = integration.last_set_status_emoji || '';
      const ours = (current.status_text === lastText && current.status_emoji === lastEmoji && current.status_expiration && current.status_expiration > Math.floor(Date.now() / 1000));
      if (ours) {
        const res = await slackSetProfile(token, { status_text: '', status_emoji: '', status_expiration: 0 });
        if (!res.ok) {
          await handleSlackApiError(row, res, admin, profile_id);
          summary.failed += 1;
          continue;
        }
        await admin.from('employee_integrations').update({
          last_set_status_text: null, last_set_status_emoji: null, last_set_expiration_ts: null, last_synced_at: new Date().toISOString(),
        }).eq('id', integration.id);
        await markOutbox(row.id, 'delivered', null, admin);
        summary.delivered += 1;
      } else {
        // Human set something (or Orbit's status already expired on its own) — do nothing, log skip
        await admin.from('employee_integrations').update({ last_synced_at: new Date().toISOString() }).eq('id', integration.id);
        await markOutbox(row.id, 'skipped', current.status_text ? 'human_status_preserved' : 'already_cleared', admin);
        summary.skipped += 1;
      }
      continue;
    }

    const statusText = state.label;
    const current = await slackGetProfile(token);
    if (!current.ok) {
      await handleSlackApiError(row, current, admin, profile_id);
      if (current.error === 'invalid_auth' || current.error === 'account_inactive' || current.error === 'not_authed') summary.exceptions += 1;
      else summary.failed += 1;
      continue;
    }

    const lastSetMatches = current.status_text === (integration.last_set_status_text || '') && current.status_emoji === (integration.last_set_status_emoji || '');
    const emptyOrOurs = (!current.status_text && !current.status_emoji) || lastSetMatches;

    if (!emptyOrOurs) {
      await admin.from('employee_integrations').update({ last_synced_at: new Date().toISOString() }).eq('id', integration.id);
      await markOutbox(row.id, 'skipped', 'human_status_preserved', admin);
      summary.skipped += 1;
      continue;
    }

    const res = await slackSetProfile(token, {
      status_text: statusText,
      status_emoji: state.emoji,
      status_expiration: state.expirationTs,
    });
    if (!res.ok) {
      await handleSlackApiError(row, res, admin, profile_id);
      if (res.error === 'invalid_auth' || res.error === 'account_inactive' || res.error === 'not_authed') summary.exceptions += 1;
      else summary.failed += 1;
      continue;
    }

    await admin.from('employee_integrations').update({
      last_set_status_text: statusText,
      last_set_status_emoji: state.emoji,
      last_set_expiration_ts: state.expirationTs,
      last_synced_at: new Date().toISOString(),
    }).eq('id', integration.id);
    await markOutbox(row.id, 'delivered', null, admin);
    summary.delivered += 1;
  }

  return summary;
}

async function handleSlackApiError(row: OutboxRowLike, result: SlackProfileResult, admin: SupabaseClient, profileId: string) {
  const attempts = (row.attempts || 0) + 1;
  if (result.error === 'invalid_auth' || result.error === 'account_inactive' || result.error === 'not_authed') {
    await admin.from('employee_integrations').update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('profile_id', profileId).eq('provider', 'slack');
    await markOutbox(row.id, 'exception', `token_revoked:${result.error}`, admin);
    return;
  }
  const backoffSec = Math.min(3600, Math.pow(2, attempts) * 60) + (result.retryAfterSeconds || 0);
  await admin.from('integration_outbox').update({
    attempts,
    status: 'failed',
    next_retry_at: new Date(Date.now() + backoffSec * 1000).toISOString(),
    last_error: result.error || 'unknown',
  }).eq('id', row.id);
}

async function markOutbox(id: string, status: string, lastError: string | null, admin: SupabaseClient) {
  await admin.from('integration_outbox').update({
    status,
    last_error: lastError,
    delivered_at: status === 'delivered' || status === 'skipped' || status === 'exception' ? new Date().toISOString() : null,
  }).eq('id', id);
}

// ---------- Slack OAuth ----------

export interface SlackOAuthExchangeResult {
  ok: boolean;
  error?: string;
  accessToken?: string;
  authedUserId?: string;
}

export async function exchangeSlackCode(code: string): Promise<SlackOAuthExchangeResult> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'slack_not_configured' };
  }
  try {
    const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/callback` : `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/slack/callback`,
      }).toString(),
    });
    if (res.status >= 500 || res.status === 408) {
      return { ok: false, error: 'slack_outage' };
    }
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || 'slack_error' };
    // User-scope-only installs put the token in authed_user.access_token (no bot token exists)
    const accessToken = (data.access_token as string | undefined) || (data.authed_user?.access_token as string | undefined);
    if (!accessToken) return { ok: false, error: 'no_access_token' };
    return {
      ok: true,
      accessToken,
      authedUserId: data.authed_user?.id as string | undefined,
    };
  } catch {
    return { ok: false, error: 'slack_outage' };
  }
}

export function slackOAuthUrl(state: string): string | null {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return null;
  const redirectUri = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/callback`
    : `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/slack/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    // This app has no bot user — user-token scopes go in `user_scope` (comma-separated).
    // Passing them in `scope` is treated as bot scopes and Slack rejects it with "Invalid permissions requested".
    user_scope: 'users.profile:read,users.profile:write',
    state,
    redirect_uri: redirectUri,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}
