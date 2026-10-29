/**
 * Screen visibility — the catalogue of screens an admin can hide from non-admins.
 *
 * The keys are stored in `screen_visibility` (migration 0071); an absent row means visible.
 * Enforcement is deliberately UI-only:
 *   - `Sidebar` drops hidden links,
 *   - `AppLayoutWrapper` swaps the page for a "not available" card on a hidden route.
 *
 * It is NOT a security boundary. Hiding a screen does not change what the API or RLS let
 * that user read or write — it only removes the surface. Anything genuinely confidential
 * must be protected by a policy (as `/payroll` and `/reports` already are).
 *
 * Admins always see every screen; `currentUser.role` is forced to 'employee' by both
 * "View as Employee" and "Preview as …", so preview mode naturally honours the switches.
 *
 * Not listed here, on purpose:
 *   - Home (`/`) — hiding it would leave the app with no landing page.
 *   - admin-only screens (`/payroll`, `/reports`, `/contracts`, `/invoices`,
 *     `/counterparties`, `/company-leave`, `/settings`) — already unreachable for employees.
 */

export interface AppScreen {
  /** Stable key persisted in `screen_visibility.screen_key`. Renaming breaks saved settings. */
  key: string;
  path: string;
  label: string;
  /** Shown in the admin toggle list to explain what the screen is. */
  hint: string;
}

export const HIDEABLE_SCREENS: AppScreen[] = [
  { key: 'profile', path: '/profile', label: 'My Profile', hint: 'Personal details, photo and integrations' },
  { key: 'leave', path: '/leave', label: 'Leave Management', hint: 'Balance, calendar and filing leave requests' },
  { key: 'remote', path: '/remote', label: 'Remote Work Log', hint: 'Remote declarations and pattern auto-fill' },
  { key: 'timesheets', path: '/timesheets', label: 'Timesheets', hint: 'Logging hours and the admin review/setup tabs' },
  { key: 'compensation', path: '/compensation', label: 'Compensation & Payroll', hint: "The employee's own pay ledger" },
  { key: 'people', path: '/people', label: 'People Directory', hint: 'Company-wide employee directory' },
  { key: 'spaces', path: '/spaces', label: 'Spaces', hint: 'Declaring rooms and booking a seat for the day' },
];

/** The screen owning this path, matching nested routes too (`/people/<id>` → People Directory). */
export function screenForPath(pathname: string | null | undefined): AppScreen | null {
  if (!pathname) return null;
  return HIDEABLE_SCREENS.find(s => pathname === s.path || pathname.startsWith(`${s.path}/`)) || null;
}

/** The hidden screen this path resolves to, or null when the route is allowed. */
export function hiddenScreenForPath(pathname: string | null | undefined, hiddenKeys: string[] | null | undefined): AppScreen | null {
  const screen = screenForPath(pathname);
  if (!screen || !hiddenKeys || hiddenKeys.length === 0) return null;
  return hiddenKeys.includes(screen.key) ? screen : null;
}

/** Narrow the raw `screen_visibility` rows down to the hidden keys the UI cares about. */
export function toHiddenScreenKeys(rows: Array<{ screen_key: string; hidden: boolean }> | null | undefined): string[] {
  return (rows || []).filter(r => r.hidden).map(r => r.screen_key);
}
