import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { exchangeMsalCode, storeMsalTokens } from '@/lib/integrations/msal';
import { getAdminClient } from '@/lib/integrations/server';
import { syncOutlookForProfile } from '@/lib/integrations/outlook';

export async function GET(request: NextRequest) {
  const stateCookie = request.cookies.get('msal_oauth_state')?.value;
  const stateParam = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');
  const errorParam = request.nextUrl.searchParams.get('error');

  if (!stateCookie || !stateParam || stateCookie !== stateParam) {
    // Almost always an origin mismatch: the cookie is set where sign-in started, so a callback on a
    // different host (or a fresh cookie jar) cannot see it.
    return NextResponse.redirect(new URL('/profile?msal=state', request.url));
  }
  let state: { profile_id: string; next: string } | null = null;
  try {
    state = JSON.parse(Buffer.from(stateCookie, 'base64url').toString('utf8'));
  } catch {
    return NextResponse.redirect(new URL('/profile?msal=state', request.url));
  }
  if (!state?.profile_id) return NextResponse.redirect(new URL('/profile?msal=state', request.url));

  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user?.id || '')
    .maybeSingle();
  if (!user || !profile || profile.id !== state.profile_id) {
    // The state was minted for one profile and the callback arrived on another session.
    return NextResponse.redirect(new URL('/profile?msal=identity', request.url));
  }

  if (errorParam || !code) {
    return NextResponse.redirect(new URL(`/profile?msal=cancelled${errorParam ? `&code=${encodeURIComponent(errorParam)}` : ''}`, request.url));
  }

  const { tokens, errorCode } = await exchangeMsalCode(code, request.nextUrl.origin);
  if (!tokens) {
    console.error('msal callback: exchange failed for profile', state.profile_id, errorCode ?? 'no code');
    return NextResponse.redirect(new URL(`/profile?msal=exchange_failed${errorCode ? `&code=${encodeURIComponent(errorCode)}` : ''}`, request.url));
  }

  const admin = getAdminClient();
  const stored = await storeMsalTokens(admin, state.profile_id, tokens);
  if (!stored) {
    console.error('msal callback: vault store failed for profile', state.profile_id);
    return NextResponse.redirect(new URL('/profile?msal=store_failed', request.url));
  }

  const now = new Date().toISOString();
  await admin.from('employee_integrations').upsert({
    profile_id: state.profile_id,
    provider: 'm365',
    status: 'connected',
    connected_at: now,
    last_synced_at: now,
  }, { onConflict: 'profile_id,provider' });

  // Mirror immediately so the work plan shows current leave/remote state without waiting for the nightly cron
  syncOutlookForProfile(admin, state.profile_id).catch(err => console.error('post-connect outlook sync error:', err));

  const response = NextResponse.redirect(new URL(state.next, request.url));
  response.cookies.set('msal_oauth_state', '', { maxAge: 0, path: '/' });
  return response;
}
