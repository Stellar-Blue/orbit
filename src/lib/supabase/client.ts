import { createBrowserClient } from '@supabase/ssr';

/**
 * The invoices and contract-documents buckets are private (migration 0063), so their
 * links have to be signed on read. One hour outlives a page visit without leaving a
 * long-lived URL in circulation.
 */
export const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Browser-side Supabase client for client components and authentication actions.
 */
export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dev-placeholder'
  );
}
