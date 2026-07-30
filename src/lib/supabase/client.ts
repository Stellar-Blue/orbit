import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client for client components and authentication actions.
 */
export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dev-placeholder'
  );
}
