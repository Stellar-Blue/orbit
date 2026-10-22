import { createBrowserClient } from '@supabase/ssr';

/**
 * The invoices and contract-documents buckets are private (migration 0063), so their
 * links have to be signed on read. One hour outlives a page visit without leaving a
 * long-lived URL in circulation.
 */
export const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Demo workspace switch. When on, every builder below resolves `{ data: [], error: null }` without
 * a network call, so the sample UI can be exercised (and optimistic updates applied) without ever
 * touching — or failing against — the real project.
 *
 * Set once at provider boot from the demo cookie; a real session never turns it on.
 */
let demoDataMode = false;

export function setDemoDataMode(on: boolean): void {
  demoDataMode = on;
}

const EMPTY_RESULT = { data: [] as unknown[], error: null };

/** A chainable thenable: `from(...).select(...).eq(...)` all resolve to the empty result. */
function createDemoClient(): unknown {
  const proxy: unknown = new Proxy(function noop() {}, {
    get: (_target, prop) => {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(EMPTY_RESULT);
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'toString') return () => '[demo supabase client]';
      return () => proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}

/**
 * Browser-side Supabase client for client components and authentication actions.
 */
function createRealClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dev-placeholder'
  );
}

/** Keeps the fully inferred client type, so callers keep their `data` typing. */
type BrowserClient = ReturnType<typeof createRealClient>;

export function getSupabaseBrowserClient(): BrowserClient {
  if (demoDataMode) return createDemoClient() as BrowserClient;
  return createRealClient();
}
