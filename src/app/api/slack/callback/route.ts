import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { exchangeSlackCode, getAdminClient, setVaultSecret, slackTokenSecretName, slackGetProfile } from '@/lib/integrations/server';

export async function GET(request: NextRequest) {
  const stateCookie = request.cookies.get('slack_oauth_state')?.value;
  const stateParam = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');
  const errorParam = request.nextUrl.searchParams.get('error');

  const fallback = new URL('/onboarding?error=slack_oauth_failed', request.url);

  if (!stateCookie || !stateParam || stateCookie !== stateParam) {
    return NextResponse.redirect(fallback);
  }

  let state: { profile_id: string; next: string } | null = null;
  try {
    state = JSON.parse(Buffer.from(stateCookie, 'base64url').toString('utf8'));
  } catch {
    return NextResponse.redirect(fallback);
  }
  if (!state || !state.profile_id) return NextResponse.redirect(fallback);

  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user?.id || '')
    .maybeSingle();

  if (!user || !profile || profile.id !== state.profile_id) {
    return NextResponse.redirect(fallback);
  }

  if (errorParam) {
    // User cancelled (e.g. access_denied) — re-present the gate, no grace.
    return NextResponse.redirect(new URL(`/onboarding?error=${encodeURIComponent(errorParam)}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/onboarding?error=slack_missing_code', request.url));
  }

  const exchange = await exchangeSlackCode(code);

  if (!exchange.ok) {
    // Slack-side outage (5xx/timeout) → auto-grant 72h grace so Slack incidents never lock Orbit.
    if (exchange.error === 'slack_outage') {
      const admin = getAdminClient();
      const now = new Date();
      await admin.from('integration_exemptions').insert({
        profile_id: state.profile_id,
        provider: 'slack',
        reason: 'Automatic grace: Slack-side outage during OAuth handshake',
        granted_by: null,
        expires_at: new Date(now.getTime() + 72 * 3600 * 1000).toISOString(),
      });
      await admin.from('audit_log').insert({
        action: 'integration_grace_granted',
        table_name: 'integration_exemptions',
        actor_profile_id: state.profile_id,
        after_data: { provider: 'slack', reason: 'slack_outage', expires_at: new Date(now.getTime() + 72 * 3600 * 1000).toISOString() },
      });
      return NextResponse.redirect(new URL('/onboarding?grace=1', request.url));
    }
    return NextResponse.redirect(new URL(`/onboarding?error=slack_oauth_failed`, request.url));
  }

  // Test the token with a profile read before trusting it (per spec §2.1)
  const test = await slackGetProfile(exchange.accessToken!);
  if (!test.ok) {
    return NextResponse.redirect(new URL(`/onboarding?error=slack_token_unusable&reason=${encodeURIComponent(test.error || '')}`, request.url));
  }

  const admin = getAdminClient();
  const tokenRef = await setVaultSecret(admin, slackTokenSecretName(state.profile_id), exchange.accessToken!);
  if (!tokenRef) {
    return NextResponse.redirect(new URL('/onboarding?error=token_store_failed', request.url));
  }

  const now = new Date().toISOString();
  await admin.from('employee_integrations').upsert({
    profile_id: state.profile_id,
    provider: 'slack',
    external_user_id: exchange.authedUserId || null,
    token_ref: tokenRef,
    status: 'connected',
    connected_at: now,
    last_synced_at: now,
  }, { onConflict: 'profile_id,provider' });

  await admin.from('profiles').update({ onboarding_completed_at: now }).eq('id', state.profile_id);

  const response = NextResponse.redirect(new URL(state.next, request.url));
  response.cookies.set('slack_oauth_state', '', { maxAge: 0, path: '/' });
  return response;
}
