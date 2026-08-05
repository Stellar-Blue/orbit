import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { slackOAuthUrl } from '@/lib/integrations/server';
import { GATED_EMPLOYMENT_TYPES } from '@/lib/integrations/types';

export async function GET(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, employment_type')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!GATED_EMPLOYMENT_TYPES.includes(profile.employment_type as unknown as (typeof GATED_EMPLOYMENT_TYPES)[number])) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const next = request.nextUrl.searchParams.get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const state = JSON.stringify({ profile_id: profile.id, next: safeNext, nonce: crypto.randomUUID() });
  const stateB64 = Buffer.from(state).toString('base64url');

  const url = slackOAuthUrl(stateB64);
  if (!url) {
    return NextResponse.json(
      { error: 'Slack is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.' },
      { status: 503 }
    );
  }

  const response = NextResponse.redirect(url);
  response.cookies.set('slack_oauth_state', stateB64, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return response;
}
