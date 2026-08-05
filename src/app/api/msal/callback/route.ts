import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { exchangeMsalCode, storeMsalTokens } from '@/lib/integrations/msal';
import { getAdminClient } from '@/lib/integrations/server';

export async function GET(request: NextRequest) {
  const stateCookie = request.cookies.get('msal_oauth_state')?.value;
  const stateParam = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');
  const errorParam = request.nextUrl.searchParams.get('error');
  const fallback = new URL('/profile?msal=error', request.url);

  if (!stateCookie || !stateParam || stateCookie !== stateParam) {
    return NextResponse.redirect(fallback);
  }
  let state: { profile_id: string; next: string } | null = null;
  try {
    state = JSON.parse(Buffer.from(stateCookie, 'base64url').toString('utf8'));
  } catch {
    return NextResponse.redirect(fallback);
  }
  if (!state?.profile_id) return NextResponse.redirect(fallback);

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

  if (errorParam || !code) {
    return NextResponse.redirect(new URL('/profile?msal=cancelled', request.url));
  }

  const tokens = await exchangeMsalCode(code);
  if (!tokens) {
    return NextResponse.redirect(new URL('/profile?msal=exchange_failed', request.url));
  }

  const admin = getAdminClient();
  const stored = await storeMsalTokens(admin, state.profile_id, tokens);
  if (!stored) {
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

  const response = NextResponse.redirect(new URL(state.next, request.url));
  response.cookies.set('msal_oauth_state', '', { maxAge: 0, path: '/' });
  return response;
}
