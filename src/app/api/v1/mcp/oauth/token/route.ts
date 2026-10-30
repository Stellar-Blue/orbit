import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const newToken = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;

// RFC 7636 S256: BASE64URL(SHA256(code_verifier)) must equal the stored code_challenge.
function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/**
 * Orbit MCP OAuth 2.0 Token Exchange Endpoint (§3)
 * Handles authorization_code exchange and refresh_token renewal for Claude AI operator connections.
 * Enforces ≤ 8-hour token validity ceiling.
 */
export async function POST(request: Request) {
  try {
    let grant_type = '';
    let code = '';
    let refresh_token = '';
    let code_verifier = '';
    let redirect_uri = '';
    let client_id = 'claude_ai';
    let scope = 'invoices.admin';


    // Parse Basic Auth header if present (standard for confidential OAuth clients)
    const authHeader = request.headers.get('authorization') || '';
    if (authHeader.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString('utf-8');
        const [id] = decoded.split(':');
        if (id) client_id = id;
      } catch {
        // Ignore malformed basic auth, fallback to body parameters
      }
    }

    // Parse either JSON body or application/x-www-form-urlencoded
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      grant_type = String(formData.get('grant_type') || '');
      code = String(formData.get('code') || '');
      refresh_token = String(formData.get('refresh_token') || '');
      code_verifier = String(formData.get('code_verifier') || '');
      redirect_uri = String(formData.get('redirect_uri') || '');
      if (!client_id || client_id === 'claude_ai') client_id = String(formData.get('client_id') || 'claude_ai');
    } else {
      const body = await request.json().catch(() => ({}));
      grant_type = body.grant_type;
      code = body.code;
      refresh_token = body.refresh_token;
      code_verifier = body.code_verifier || '';
      redirect_uri = body.redirect_uri || '';
      if (!client_id || client_id === 'claude_ai') client_id = body.client_id || 'claude_ai';
      scope = body.scope || 'invoices.admin';
    }

    const supabase = await getSupabaseAdminClient();

    // 1. Authorization Code Exchange
    if (grant_type === 'authorization_code') {
      if (!code) {
        return NextResponse.json({ error: 'invalid_request', error_description: 'Missing required code parameter.' }, { status: 400 });
      }

      let userId = '';
      
      // Look up authorization code in database
      const { data: codeRecord } = await supabase.from('mcp_oauth_codes').select('*').eq('code', code).single();
      if (codeRecord) {
        if (new Date(codeRecord.expires_at) < new Date()) {
          return NextResponse.json({ error: 'invalid_grant', error_description: 'Authorization code has expired. Please re-authorize via consent screen.' }, { status: 400 });
        }
        // Invalidate single-use authorization code before any check, so a failed attempt burns it
        await supabase.from('mcp_oauth_codes').delete().eq('code', code);

        if (!codeRecord.code_challenge || !pkceMatches(code_verifier, codeRecord.code_challenge)) {
          return NextResponse.json({ error: 'invalid_grant', error_description: 'PKCE verification failed.' }, { status: 400 });
        }
        if (redirect_uri !== codeRecord.redirect_uri) {
          return NextResponse.json({ error: 'invalid_grant', error_description: 'redirect_uri does not match the authorization request.' }, { status: 400 });
        }
        userId = codeRecord.user_id;
        client_id = codeRecord.client_id;
        scope = codeRecord.scope;
      } else {
        return NextResponse.json({ error: 'invalid_grant', error_description: 'Invalid or unknown OAuth authorization code.' }, { status: 400 });
      }

      // Ensure target profile is active & holds corporate admin privileges
      const { data: profile } = await supabase.from('profiles').select('id, status').or(`id.eq.${userId},auth_user_id.eq.${userId}`).maybeSingle();
      const canonicalId = profile?.id || userId;
      const { data: roleRow } = await supabase.from('user_roles').select('role').eq('profile_id', canonicalId).eq('role', 'admin').maybeSingle();
      if (!roleRow || (profile && profile.status === 'departed')) {
        return NextResponse.json({ error: 'access_denied', error_description: 'Mapped employee profile is departed or no longer holds admin role.' }, { status: 403 });
      }
      userId = canonicalId;

      // Generate access & refresh tokens (≤ 8h lifetime per §3)
      const accessToken = newToken('mcp_access');
      const refreshToken = newToken('mcp_refresh');
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

      try {
        await supabase.from('mcp_oauth_tokens').insert([{
          access_token: accessToken,
          refresh_token: refreshToken,
          user_id: userId,
          client_id,
          scope,
          expires_at: expiresAt
        }]);
      } catch (dbErr) {
        console.warn('Notice: Unable to cache generated tokens in mcp_oauth_tokens (dev simulator fallback):', dbErr);
      }

      return NextResponse.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 28800, // Exactly 8 hours in seconds
        refresh_token: refreshToken,
        scope
      });
    }

    // 2. Refresh Token Renewal
    if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return NextResponse.json({ error: 'invalid_request', error_description: 'Missing refresh_token parameter.' }, { status: 400 });
      }

      let userId = '';

      const { data: tokenRecord } = await supabase.from('mcp_oauth_tokens').select('*').eq('refresh_token', refresh_token).single();
      if (tokenRecord) {
        if (Date.now() - new Date(tokenRecord.created_at).getTime() > REFRESH_TOKEN_TTL_MS) {
          await supabase.from('mcp_oauth_tokens').delete().eq('refresh_token', refresh_token);
          return NextResponse.json({ error: 'invalid_grant', error_description: 'Expired or invalid refresh token.' }, { status: 400 });
        }
        userId = tokenRecord.user_id;
        client_id = tokenRecord.client_id;
        scope = tokenRecord.scope;
        await supabase.from('mcp_oauth_tokens').delete().eq('refresh_token', refresh_token);
      } else {
        return NextResponse.json({ error: 'invalid_grant', error_description: 'Expired or invalid refresh token.' }, { status: 400 });
      }

      // Enforce systemic revocation check: if employee disabled in directory, revoke MCP session at next call
      const { data: profile } = await supabase.from('profiles').select('id, status').or(`id.eq.${userId},auth_user_id.eq.${userId}`).maybeSingle();
      const canonicalId = profile?.id || userId;
      const { data: roleRow } = await supabase.from('user_roles').select('role').eq('profile_id', canonicalId).eq('role', 'admin').maybeSingle();
      if (!roleRow || (profile && profile.status === 'departed')) {
        return NextResponse.json({ error: 'access_denied', error_description: 'Account access revoked in enterprise directory.' }, { status: 403 });
      }
      userId = canonicalId;

      const newAccessToken = newToken('mcp_access');
      const newRefreshToken = newToken('mcp_refresh');
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

      try {
        await supabase.from('mcp_oauth_tokens').insert([{
          access_token: newAccessToken,
          refresh_token: newRefreshToken,
          user_id: userId,
          client_id,
          scope,
          expires_at: expiresAt
        }]);
      } catch (dbErr) {
        console.warn('Notice: Unable to update renewed tokens (dev simulator fallback):', dbErr);
      }

      return NextResponse.json({
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: 28800,
        refresh_token: newRefreshToken,
        scope
      });
    }

    return NextResponse.json({
      error: 'unsupported_grant_type',
      error_description: `Unsupported grant_type: '${grant_type}'. Must be 'authorization_code' or 'refresh_token'.`
    }, { status: 400 });

  } catch (ex: any) {
    return NextResponse.json({
      error: 'server_error',
      error_description: ex.message || 'Internal token exchange error.'
    }, { status: 500 });
  }
}
