/**
 * Public demo workspace.
 *
 * `/demo` is the only way in: it sets this cookie and opens the app, which then runs entirely on
 * the sample rows in `mock-data.ts` — no Supabase session, no company data. Leaving the demo clears
 * the cookie, so the middleware puts the visitor back on the login page.
 *
 * Server (proxy) and client (provider, banner) read the same cookie, so there is exactly one
 * definition of "this browser is in the demo".
 */
export const DEMO_COOKIE = 'orbit_demo';

/** Entry path. Kept here so the proxy allowlist and the page cannot drift. */
export const DEMO_ENTRY_PATH = '/demo';

/** Eight hours: long enough for a walkthrough, short enough that a kiosk self-heals. */
const MAX_AGE_SECONDS = 60 * 60 * 8;

export function isDemoMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split(';')
    .some(part => part.trim() === `${DEMO_COOKIE}=1`);
}

export function enterDemoMode(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${DEMO_COOKIE}=1; path=/; SameSite=Lax; max-age=${MAX_AGE_SECONDS}`;
}

export function exitDemoMode(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${DEMO_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}
