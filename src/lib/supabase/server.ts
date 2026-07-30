import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client & Dev Auth Safety Enforcement
 * NON-NEGOTIABLE GUARANTEE: If DEV_AUTH_MODE is set to true in production environments
 * (NODE_ENV=production or VERCEL_ENV=production), startup hard-fails immediately.
 */

export function assertNoDevAuthInProduction() {
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  const isDevAuth = process.env.DEV_AUTH_MODE === 'true';

  if (isProd && isDevAuth) {
    throw new Error(
      "FATAL SECURITY GUARD: DEV_AUTH_MODE is enabled in a production environment! " +
      "This represents a fatal configuration flaw. Application booting terminated."
    );
  }
}

export async function getSupabaseServerClient() {
  assertNoDevAuthInProduction();

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dev-placeholder',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  );
}
