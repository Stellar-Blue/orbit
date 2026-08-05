import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { msalAuthorizeUrl } from '@/lib/integrations/msal';

export async function GET(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const next = request.nextUrl.searchParams.get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const state = JSON.stringify({ profile_id: profile.id, next: safeNext, nonce: crypto.randomUUID() });
  const stateB64 = Buffer.from(state).toString('base64url');

  const url = msalAuthorizeUrl(stateB64);
  if (!url) {
    return NextResponse.json({ error: 'Microsoft Graph is not configured.' }, { status: 503 });
  }

  const response = NextResponse.redirect(url);
  response.cookies.set('msal_oauth_state', stateB64, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return response;
}
