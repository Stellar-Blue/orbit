import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-user delegated Microsoft auth (work plans only accept delegated tokens).
 * Access + refresh tokens stored encrypted in Vault, one JSON secret per user.
 * No per-user secrets ever touch logs.
 */

export interface MsalTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
}

export function msalTokenSecretName(profileId: string): string {
  return `ms365_token:${profileId}`;
}

export function hasMsalCredentials(): boolean {
  return !!(process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET && process.env.GRAPH_TENANT_ID);
}

export function msalAuthorizeUrl(state: string): string | null {
  if (!hasMsalCredentials()) return null;
  const redirectUri = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/msal/callback`
    : `http://localhost:3000/api/msal/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'Calendars.ReadWrite offline_access openid profile',
    response_mode: 'query',
    state,
  });
  return `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeMsalCode(code: string): Promise<MsalTokens | null> {
  if (!hasMsalCredentials()) return null;
  const redirectUri = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/msal/callback`
    : `http://localhost:3000/api/msal/callback`;
  const res = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID!,
      client_secret: process.env.GRAPH_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: 'Calendars.ReadWrite offline_access openid profile',
    }).toString(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.access_token || !data.refresh_token) return null;
  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    scope: data.scope as string,
  };
}

export async function refreshMsalToken(tokens: MsalTokens): Promise<MsalTokens> {
  const res = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID!,
      client_secret: process.env.GRAPH_CLIENT_SECRET!,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
      scope: 'Calendars.ReadWrite offline_access openid profile',
    }).toString(),
  });
  if (!res.ok) throw new Error('msal_refresh_failed');
  const data = await res.json();
  if (!data.access_token || !data.refresh_token) throw new Error('msal_refresh_failed');
  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    scope: data.scope as string,
  };
}

// ---------- Vault persistence (via public SECURITY DEFINER wrappers) ----------

export async function storeMsalTokens(admin: SupabaseClient, profileId: string, tokens: MsalTokens): Promise<boolean> {
  const { error } = await admin.rpc('vault_set_secret', {
    p_name: msalTokenSecretName(profileId),
    p_secret: JSON.stringify(tokens),
  });
  return !error;
}

export async function loadMsalTokens(admin: SupabaseClient, profileId: string): Promise<MsalTokens | null> {
  const { data, error } = await admin.rpc('vault_get_secret', { p_name: msalTokenSecretName(profileId) });
  if (error || !data) return null;
  try {
    return JSON.parse(data as string) as MsalTokens;
  } catch {
    return null;
  }
}

export async function deleteMsalTokens(admin: SupabaseClient, profileId: string): Promise<void> {
  await admin.rpc('vault_delete_secret', { p_name: msalTokenSecretName(profileId) });
}

/**
 * Resolve a fresh delegated access token for a profile (refresh if expired).
 * Returns null if the user has no stored session or refresh fails (revoked consent).
 */
export async function getDelegatedToken(admin: SupabaseClient, profileId: string): Promise<string | null> {
  let tokens = await loadMsalTokens(admin, profileId);
  if (!tokens) return null;
  if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  try {
    tokens = await refreshMsalToken(tokens);
  } catch {
    // Refresh failed (revoked / invalidated) — clear so UI can show "reconnect"
    await deleteMsalTokens(admin, profileId);
    // The UI reads connection state from employee_integrations, and nothing else downgrades it on
    // expiry: without this it keeps claiming "Connected" while every work-plan write is skipped.
    await admin
      .from('employee_integrations')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('profile_id', profileId)
      .eq('provider', 'm365');
    return null;
  }
  await storeMsalTokens(admin, profileId, tokens);
  return tokens.access_token;
}
