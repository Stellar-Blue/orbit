import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { msalAuthorizeUrl } from '@/lib/integrations/msal';

export async function GET(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Local dev runs on a mock identity and deliberately has no Supabase session, so sending the
  // browser to /login would loop forever with no explanation. Name the reason instead.
  if (!user) {
    const reason = process.env.DEV_AUTH_MODE === 'true' ? '/profile?msal=no_session' : '/login';
    return NextResponse.redirect(new URL(reason, request.url));
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.redirect(new URL('/profile?msal=no_profile', request.url));
  }

  const next = request.nextUrl.searchParams.get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const state = JSON.stringify({ profile_id: profile.id, next: safeNext, nonce: crypto.randomUUID() });
  const stateB64 = Buffer.from(state).toString('base64url');

  const url = msalAuthorizeUrl(stateB64, request.nextUrl.origin);
  if (!url) {
    // A raw JSON body told the user nothing; the profile page explains it in place.
    console.error('msal connect: GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / GRAPH_TENANT_ID not set');
    return NextResponse.redirect(new URL('/profile?msal=not_configured', request.url));
  }

  const response = NextResponse.redirect(url);
  response.cookies.set('msal_oauth_state', stateB64, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return response;
}
