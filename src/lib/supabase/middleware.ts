import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware session updater to refresh Supabase cookies and protect administrative routes.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // Resilient OAuth token interception: if Supabase redirects to site root / instead of /auth/callback with a code parameter, reroute to callback handler
  if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.has('code')) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = '/auth/callback';
    return NextResponse.redirect(callbackUrl);
  }

  // If running locally in DEV_AUTH_MODE, skip automatic redirects so UI prototyping & page viewing work without Azure AD
  const isDevAuth = process.env.DEV_AUTH_MODE === 'true';
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

  if (isDevAuth && !isProd) {
    return supabaseResponse;
  }

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
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run any logic between createServerClient and supabase.auth.getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicOrApiRoute = 
    request.nextUrl.pathname.startsWith('/login') || 
    request.nextUrl.pathname.startsWith('/auth') ||
    request.nextUrl.pathname.startsWith('/api/') ||
    request.nextUrl.pathname.startsWith('/token') ||
    request.nextUrl.pathname.startsWith('/oauth/token') ||
    request.nextUrl.pathname.startsWith('/.well-known');

  // If no authenticated session exists and not navigating to public/API routes, redirect to /login
  if (!user && !isPublicOrApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    if (request.nextUrl.pathname.includes('authorize')) {
      url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(url);
  }

  // If already authenticated and attempting to access /login, redirect back to primary workspace
  if (user && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
