/**
 * Runnable check for the route → data-slice catalogue (same style as the other verify-* scripts:
 * no framework, no fixtures).
 *
 *   node scripts/verify-data-slices.js
 *
 * The point of this file is that a screen must not pay for tables it never renders, so the
 * assertions pin the expensive ones (payments, invoices, time entries, Attio rows) away from the
 * routes that do not show them, and pin dependency order for the slices that join.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'data-slices.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const mod = { exports: {} };
new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod);
const D = mod.exports;

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};

const route = p => D.withDependencies(D.slicesForPath(p));
const tables = p => new Set(D.tablesForSlices(route(p)));

// --- the egress win: heavy tables stay off the routes that do not render them ----------------
check('dashboard shows leave, remote days, salary and contracts',
  D.slicesForPath('/'), ['leave', 'remoteDays', 'salary', 'contracts']);
check('dashboard never loads the payroll or invoice ledgers',
  ['payments', 'invoices', 'invoice_documents', 'time_entries', 'attio_events']
    .filter(t => tables('/').has(t)), []);
check('leave screen loads leave but not remote, salary or commercial',
  D.slicesForPath('/leave'), ['leave']);
check('payroll loads payments but not invoices',
  ['payments', 'invoices'].filter(t => tables('/payroll').has(t)), ['payments']);
check('invoices screen loads invoices and time entries but not payments',
  ['invoices', 'time_entries', 'payments'].filter(t => tables('/invoices').has(t)), ['invoices', 'time_entries']);
check('settings loads the admin config slices',
  ['rate_cards', 'invoices', 'counterparties', 'coverage_groups', 'remote_policies'].filter(t => tables('/settings').has(t)),
  ['rate_cards', 'invoices', 'counterparties', 'coverage_groups', 'remote_policies']);
check('people loads the per-employee quota and entitlement tables it renders',
  ['employee_contracts', 'leave_entitlements', 'remote_policies'].filter(t => tables('/people').has(t)),
  ['employee_contracts', 'leave_entitlements', 'remote_policies']);

// --- dependency order ------------------------------------------------------------------------
check('contracts load before the slices that join against them',
  route('/invoices').filter(k => ['contracts', 'commercial', 'invoices'].includes(k)),
  ['contracts', 'commercial', 'invoices']);
check('dependencies are de-duplicated',
  route('/settings').length, new Set(route('/settings')).size);
check('a slice is never listed after one of its dependents',
  route('/settings').filter(k => k === 'commercial' || k === 'invoices'),
  ['commercial', 'invoices']);
check('contracts screen gets the rate-card matrix it renders',
  tables('/contracts').has('rate_card_entries'), true);

// --- route matching --------------------------------------------------------------------------
check('nested detail routes inherit their parent slices',
  D.slicesForPath('/people/34ebcb6d'), D.slicesForPath('/people'));
check('trailing slashes normalise', D.slicesForPath('/leave/'), D.slicesForPath('/leave'));
check('unrelated routes need no slice', D.slicesForPath('/profile'), []);

// --- catalogue integrity ---------------------------------------------------------------------
check('every routed slice has a table list',
  Object.keys(D.SLICE_TABLES).sort(), Object.keys(D.SLICE_DEPENDENCIES).sort());
const knownSlices = new Set(Object.keys(D.SLICE_TABLES));
const unknownDeps = Object.entries(D.SLICE_DEPENDENCIES)
  .flatMap(([, deps]) => deps.filter(d => !knownSlices.has(d)));
check('every dependency names a real slice', unknownDeps, []);
const routedUnknown = ['/', '/leave', '/remote', '/payroll', '/people', '/contracts',
  '/counterparties', '/invoices', '/reports', '/timesheets', '/settings', '/reconciliation']
  .flatMap(p => D.slicesForPath(p).filter(k => !knownSlices.has(k)));
check('every routed slice exists', routedUnknown, []);

console.log(failed === 0 ? '\nAll data-slice checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
