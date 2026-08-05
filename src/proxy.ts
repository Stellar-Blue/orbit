import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { GATED_EMPLOYMENT_TYPES } from '@/lib/integrations/types';

/**
 * Mandatory Slack-onboarding gate (§2.1):
 * routes any profile without onboarding_completed_at (or with a revoked Slack token)
 * to /onboarding for every app route, preserving the intended destination.
 * Contractors are exempt. Active admin exemptions (incl. outage grace) lift the gate.
 * Disabled entirely in DEV_AUTH_MODE so local mock sessions are unaffected.
 */
export async function proxy(request: NextRequest) {
  if (process.env.DEV_AUTH_MODE === 'true') {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

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
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.next();
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, employment_type, onboarding_completed_at')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.next();
  }

  // Contractors and non-gated types skip the flow entirely
  if (!GATED_EMPLOYMENT_TYPES.includes(profile.employment_type as unknown as (typeof GATED_EMPLOYMENT_TYPES)[number])) {
    return NextResponse.next();
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
    return NextResponse.next();
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
      return NextResponse.next();
    }
  }

  const next = pathname + (request.nextUrl.search || '');
  const url = new URL('/onboarding', request.url);
  url.searchParams.set('next', next === '/' ? '/' : next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|login|auth|token|onboarding|favicon.ico|.*\\..*).*)'],
};
