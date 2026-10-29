/**
 * Route → data-slice map. Orbit used to fetch every table on load, on every screen, which made
 * the dashboard pay for payroll ledgers, invoice PDFs and Attio mirrors it never renders.
 *
 * A slice is a named bundle of tables plus the state they feed. The provider loads the slice a
 * route actually needs (and its dependencies), caches it for the rest of the session and never
 * fetches it again — so a second visit is instant and only the first one costs egress.
 *
 * Adding a screen: list the slices its `useAuth()` destructuring needs here. Anything not listed
 * stays unloaded, exactly like a server route that does not query that table.
 *
 * Not listed here because they are needed everywhere (loaded once at boot): the directory
 * (`profiles`, `user_roles`, `teams`, …), job-role metadata, public holidays, leave types,
 * `screen_visibility`, `company_profile`, `leave_policy` and `integration_settings`.
 */

export type DataSliceKey =
  | 'leave'
  | 'remoteDays'
  | 'remote'
  | 'salary'
  | 'payments'
  | 'contracts'
  | 'commercial'
  | 'invoices'
  | 'budget'
  | 'timesheets'
  | 'people'
  | 'integrations'
  | 'policies'
  | 'spaces';

/** Slices that must be loaded before this one, because it joins against their rows. */
export const SLICE_DEPENDENCIES: Record<DataSliceKey, DataSliceKey[]> = {
  leave: [],
  remoteDays: [],
  remote: ['remoteDays', 'leave', 'policies'],
  salary: [],
  payments: ['salary'],
  contracts: [],
  commercial: ['contracts'],
  invoices: ['commercial'],
  budget: ['invoices'],
  timesheets: ['leave', 'contracts'],
  people: [],
  integrations: [],
  policies: [],
  spaces: [],
};

/**
 * Tables owned by each slice. Also the realtime allowlist: a slice that was never loaded has no
 * subscription, so a change elsewhere in the company cannot pull a table this screen never shows.
 */
export const SLICE_TABLES: Record<DataSliceKey, string[]> = {
  leave: [
    'leave_requests', 'leave_entitlements', 'mandatory_leaves',
    'coverage_groups', 'coverage_group_members', 'leave_exception_requests',
  ],
  remoteDays: ['remote_days'],
  remote: ['remote_patterns', 'remote_amendments', 'remote_quota_requests'],
  salary: ['payment_types', 'salary_history', 'payment_document_types'],
  payments: ['payments'],
  contracts: [
    'counterparties', 'contracts', 'roles', 'counterparty_roles',
    'tier_model_versions', 'counterparty_tiers', 'counterparty_tier_history', 'counterparty_tier_overrides',
  ],
  commercial: [
    'catalog_modules', 'catalog_items', 'contract_lines', 'contract_line_groups',
    'contract_schedule', 'attio_links', 'counterparty_contacts', 'attio_events', 'contract_timesheets',
    'rate_cards', 'rate_card_entries',
  ],
  invoices: [
    'invoices', 'invoice_links', 'invoice_categories', 'invoice_documents',
    'invoice_payments', 'invoice_allocations', 'receipts', 'budget_categories',
  ],
  budget: ['budgets', 'budget_lines', 'recurring_commitments'],
  timesheets: [
    'projects', 'work_items', 'project_assignments', 'project_role_forecasts',
    'time_entries', 'timesheet_periods',
  ],
  people: ['employee_contracts'],
  integrations: ['employee_integrations', 'integration_exemptions'],
  policies: ['remote_policies'],
  spaces: ['space_types', 'spaces', 'space_sessions', 'space_bookings', 'space_seats', 'space_desks', 'office_floors'],
};

/** Slices each route renders. Nested routes (`/people/<id>`) inherit their parent's list. */
export function slicesForPath(pathname: string | null | undefined): DataSliceKey[] {
  const path = (pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (path === '/') return ['leave', 'remoteDays', 'salary', 'contracts'];
  if (path.startsWith('/company-leave')) return ['leave'];
  if (path.startsWith('/leave')) return ['leave'];
  if (path.startsWith('/remote')) return ['remote'];
  if (path.startsWith('/reconciliation')) return ['remote'];
  if (path.startsWith('/payroll')) return ['payments'];
  if (path.startsWith('/compensation')) return ['payments'];
  if (path.startsWith('/people')) return ['people', 'integrations', 'leave', 'policies'];
  if (path.startsWith('/counterparties')) return ['commercial', 'invoices'];
  if (path.startsWith('/contracts')) return ['commercial', 'invoices', 'timesheets'];
  if (path.startsWith('/invoices')) return ['invoices', 'timesheets', 'salary'];
  if (path.startsWith('/reports')) return ['budget', 'salary'];
  if (path.startsWith('/spaces')) return ['spaces'];
  if (path.startsWith('/timesheets')) return ['timesheets'];
  if (path.startsWith('/settings')) return ['commercial', 'invoices', 'leave', 'integrations', 'salary', 'policies', 'spaces'];
  return [];
}

/**
 * Expand a route's slices with their dependencies, oldest dependency first, so a caller can load
 * them in order. Duplicates are dropped.
 */
export function withDependencies(keys: DataSliceKey[]): DataSliceKey[] {
  const ordered: DataSliceKey[] = [];
  const visit = (key: DataSliceKey) => {
    if (ordered.includes(key)) return;
    SLICE_DEPENDENCIES[key].forEach(visit);
    ordered.push(key);
  };
  keys.forEach(visit);
  return ordered;
}

/** Tables a route's slices own — the realtime allowlist for the active screen. */
export function tablesForSlices(keys: Iterable<DataSliceKey>): string[] {
  const tables = new Set<string>();
  for (const key of keys) SLICE_TABLES[key].forEach(t => tables.add(t));
  return Array.from(tables);
}
