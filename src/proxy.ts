import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { DEMO_COOKIE, DEMO_ENTRY_PATH } from '@/lib/demo-mode';

/**
 * Cookie set by the login page's local "Enter Workspace" bypass. Only honoured while
 * DEV_AUTH_MODE is on outside production, so a first visit still lands on /login.
 */
export const DEV_WORKSPACE_COOKIE = 'orbit_dev_workspace';

/**
 * Session gate + Slack-onboarding gate.
 *
 * 1. Anyone without a Supabase session is sent to /login (with `next`), so the workspace can no
 *    longer be opened by an anonymous visitor — it used to render the app shell with a placeholder
 *    identity. `/oauth/token` and `/.well-known` are machine endpoints and authenticate themselves.
 * 2. Slack onboarding (§2.1): a profile the admin has marked slack_required (and without
 *    onboarding_completed_at, or with a revoked Slack token) is routed to /onboarding for every
 *    app route, preserving the intended destination. Users not flagged as required skip the flow
 *    entirely, and active admin exemptions (incl. outage grace) lift the gate.
 *
 * Local prototyping (`DEV_AUTH_MODE=true`, non-production) skips both gates, but only after the
 * login page's dev button has set {@link DEV_WORKSPACE_COOKIE} — opening the app in `npm run dev`
 * still shows the login page first.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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

  const devMode = process.env.DEV_AUTH_MODE === 'true' && process.env.NODE_ENV !== 'production';
  const devWorkspace = devMode && request.cookies.get(DEV_WORKSPACE_COOKIE)?.value === '1';
  // The public demo is deliberately open: `/demo` plants the cookie, and the app then renders only
  // sample rows (the provider never reaches Supabase in that mode).
  const demoWorkspace = request.cookies.get(DEMO_COOKIE)?.value === '1'
    || pathname === DEMO_ENTRY_PATH
    || pathname.startsWith(`${DEMO_ENTRY_PATH}/`);
  /** Machine endpoints authenticate with their own credentials, never a browser session. */
  const isMachineRoute = pathname.startsWith('/oauth/token') || pathname.startsWith('/.well-known');

  const { data: { user } } = await supabase.auth.getUser();

  // No session: the workspace is closed. Nobody — first-time visitor or expired session — may see
  // it with a placeholder identity, so send them to the login page and remember where they wanted
  // to go.
  if (!user && !devWorkspace && !demoWorkspace && !isMachineRoute) {
    const url = new URL('/login', request.url);
    if (pathname !== '/') url.searchParams.set('next', pathname + search);
    const redirect = NextResponse.redirect(url);
    // Carry any refreshed auth cookies onto the redirect, or this hop drops them.
    response.cookies.getAll().forEach(c => redirect.cookies.set(c));
    return redirect;
  }

  // Local prototype mode, the public demo, or a machine route: nothing else to gate.
  if (devMode || demoWorkspace || !user) {
    return response;
  }

  // Onboarding is the Slack gate's own destination; running the gate on it would loop.
  if (pathname.startsWith('/onboarding')) {
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
  matcher: ['/((?!api|_next/static|_next/image|login|auth|token|favicon.ico|.*\\..*).*)'],
};
