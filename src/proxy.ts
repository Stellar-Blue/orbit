import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Slack-onboarding gate (§2.1):
 * routes any profile the admin has marked slack_required (and without
 * onboarding_completed_at, or with a revoked Slack token) to /onboarding for
 * every app route, preserving the intended destination.
 * Users the admin has not flagged as required skip the flow entirely.
 * Active admin exemptions (incl. outage grace) also lift the gate.
 * Disabled entirely in DEV_AUTH_MODE so local mock sessions are unaffected.
 */
export async function proxy(request: NextRequest) {
  if (process.env.DEV_AUTH_MODE === 'true') {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // getUser() below rotates the Supabase refresh token. Those new cookies must reach
  // BOTH the route handler (via request) and the browser (via the returned response),
  // or every API route sees a stale token and 401s once the access token expires.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dev-placeholder',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return response;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, slack_required, onboarding_completed_at')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!profile) {
    return response;
  }

  // Only users the admin has marked as required are gated
  if (!profile.slack_required) {
    return response;
  }

  // Active exemption (admin deferral or outage grace) lifts the gate
  const now = new Date().toISOString();
  const { data: exemption } = await supabase
    .from('integration_exemptions')
    .select('id')
    .eq('profile_id', profile.id)
    .eq('provider', 'slack')
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .limit(1)
    .maybeSingle();
  if (exemption) {
    return response;
  }

  if (profile.onboarding_completed_at) {
    // Re-arm the gate if the Slack token was later revoked
    const { data: integration } = await supabase
      .from('employee_integrations')
      .select('status')
      .eq('profile_id', profile.id)
      .eq('provider', 'slack')
      .maybeSingle();
    if (!integration || integration.status !== 'revoked') {
      return response;
    }
  }

  const next = pathname + (request.nextUrl.search || '');
  const url = new URL('/onboarding', request.url);
  url.searchParams.set('next', next === '/' ? '/' : next);
  const redirect = NextResponse.redirect(url);
  // Carry any refreshed auth cookies onto the redirect, or this hop drops them.
  response.cookies.getAll().forEach(c => redirect.cookies.set(c));
  return redirect;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|login|auth|token|onboarding|favicon.ico|.*\\..*).*)'],
};
