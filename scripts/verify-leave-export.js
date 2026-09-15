/**
 * Runnable check for the leave export filters (no test framework, no fixtures — ponytail rule).
 *
 *   node scripts/verify-leave-export.js
 *
 * Transpiles `src/lib/leave-export.ts` and drives the pure helpers: period windows (full year /
 * year-to-date / single month), status + active-employee filters, and per-employee grouping.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'leave-export.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const mod = { exports: {} };
new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod);
const L = mod.exports;

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};

const profiles = [
  { id: 'p1', first_name: 'Eleni', last_name: 'Papadopoulou', work_email: 'eleni@sb.gr', status: 'active', employment_type: 'full_time' },
  { id: 'p2', first_name: 'Nikos', last_name: 'Georgiou', work_email: 'nikos@sb.gr', status: 'departed', employment_type: 'full_time' },
  { id: 'p3', first_name: 'Anna', last_name: 'Zerva', work_email: 'anna@sb.gr', status: 'active', employment_type: 'full_time' },
];

// p1: Jan (approved), Feb (pending), Dec→Jan 2027 straddle. p2: departed, Mar (approved). p3: Mar (approved half).
const leaves = [
  { id: 'l1', profile_id: 'p1', leave_type_id: 'lt-annual', start_date: '2026-01-05', end_date: '2026-01-09', working_days: 5, status: 'approved', origin: 'employee' },
  { id: 'l2', profile_id: 'p1', leave_type_id: 'lt-annual', start_date: '2026-02-10', end_date: '2026-02-11', working_days: 2, status: 'pending', origin: 'employee' },
  { id: 'l3', profile_id: 'p2', leave_type_id: 'lt-annual', start_date: '2026-03-02', end_date: '2026-03-06', working_days: 5, status: 'approved', origin: 'employee' },
  { id: 'l4', profile_id: 'p3', leave_type_id: 'lt-annual', start_date: '2026-03-16', end_date: '2026-03-17', working_days: 2, status: 'taken', origin: 'employee' },
  { id: 'l5', profile_id: 'p1', leave_type_id: 'lt-annual', start_date: '2026-08-10', end_date: '2026-08-14', working_days: 5, status: 'approved', origin: 'mandatory' },
  { id: 'l6', profile_id: 'p3', leave_type_id: 'lt-annual', start_date: '2026-12-28', end_date: '2027-01-04', working_days: 6, status: 'approved', origin: 'employee' },
];
const leaveTypes = [{ id: 'lt-annual', name_en: 'Annual Leave', name_el: 'Άδεια' }];
const today = new Date('2026-08-15T12:00:00');

const base = { year: 2026, period: 'full_year', month: 3, approvedOnly: false, activeOnly: false };
const ids = list => list.map(r => r.id).sort();

// 1. Full year keeps everything overlapping 2026, including the Dec→Jan straddle.
check('full year → all leaves', ids(L.filterLeaveExport(leaves, base, profiles, today)), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);

// 1b. Year to date stops at `today`.
check('year to date → up to today', ids(L.filterLeaveExport(leaves, { ...base, period: 'ytd' }, profiles, today)), ['l1', 'l2', 'l3', 'l4', 'l5']);
check('ytd window label', L.leaveExportWindow({ ...base, period: 'ytd' }, today).to, '2026-08-15');

// 1c. Single month window.
check('single month (March)', ids(L.filterLeaveExport(leaves, { ...base, period: 'month', month: 3 }, profiles, today)), ['l3', 'l4']);
check('single month (January)', ids(L.filterLeaveExport(leaves, { ...base, period: 'month', month: 1 }, profiles, today)), ['l1']);
check('month window ends on last day', L.leaveExportWindow({ ...base, period: 'month', month: 2 }, today).to, '2026-02-28');

// 2. Approved-only drops the pending February request.
check('approved only', ids(L.filterLeaveExport(leaves, { ...base, approvedOnly: true }, profiles, today)), ['l1', 'l3', 'l4', 'l5', 'l6']);
check('approved only, March', ids(L.filterLeaveExport(leaves, { ...base, approvedOnly: true, period: 'month', month: 3 }, profiles, today)), ['l3', 'l4']);

// 3. Active employees only drops the departed Nikos.
check('active employees only', ids(L.filterLeaveExport(leaves, { ...base, activeOnly: true }, profiles, today)), ['l1', 'l2', 'l4', 'l5', 'l6']);
check('active + approved + ytd combined', ids(L.filterLeaveExport(leaves, { ...base, approvedOnly: true, activeOnly: true, period: 'ytd' }, profiles, today)), ['l1', 'l4', 'l5']);

// 4. Grouped per employee: contiguous blocks, surname order, newest leave first, subtotal per block.
const groups = L.groupLeavesByEmployee(L.filterLeaveExport(leaves, base, profiles, today), profiles);
check('group order by employee surname', groups.map(g => g.name), ['Nikos Georgiou', 'Eleni Papadopoulou', 'Anna Zerva']);
check('group leaves newest first', groups[1].leaves.map(r => r.start_date), ['2026-08-10', '2026-02-10', '2026-01-05']);
check('group totals', groups.map(g => g.totalDays), [5, 12, 8]);
check('unknown employee is named', L.groupLeavesByEmployee([{ ...leaves[0], profile_id: 'ghost' }], profiles)[0].name, 'Unknown Employee');

// Ledger rows: name/email once per block, no title banner, headers first.
const aoa = L.detailedLedgerAoa(groups, leaveTypes);
check('ledger headers are row 1 of the sheet', [L.DETAILED_LEDGER_HEADERS, ...aoa][0][0], 'Employee Name');
check('ledger is one row per leave', aoa.length, 6);
check('ledger names once per employee block', aoa.map(r => r[0]), ['Nikos Georgiou', 'Eleni Papadopoulou', '', '', 'Anna Zerva', '']);
check('ledger category for mandatory origin', aoa[1][4], 'Annual Leave');
check('ledger status/origin upper-cased', [aoa[1][6], aoa[1][7]], ['APPROVED', 'MANDATORY']);

// Self-describing scope label.
check('scope label lists every filter', L.leaveExportScopeLabel({ year: 2026, period: 'month', month: 3, approvedOnly: true, activeOnly: true }, today), 'Single month (March 2026) · approved & deducted only · active employees only');
check('scope label omits employees for personal reports', L.leaveExportScopeLabel({ year: 2026, period: 'month', month: 3, approvedOnly: true, activeOnly: false }, today, { employees: false }), 'Single month (March 2026) · approved & deducted only');
check('employees helper filters departed', L.leaveExportEmployees(profiles, true).map(p => p.id), ['p1', 'p3']);

// XLSX round-trip: the detailed ledger sheet starts with the column headers (no title banner).
const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([L.DETAILED_LEDGER_HEADERS, ...aoa]), 'Detailed_Ledger_2026');
const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(back.Sheets['Detailed_Ledger_2026'], { header: 1, raw: true });
check('xlsx ledger row 1 is the column header row', rows[0], L.DETAILED_LEDGER_HEADERS);
check('xlsx ledger has no title banner', rows.flat().filter(v => typeof v === 'string' && v.includes('LEDGER')).length, 0);
check('xlsx ledger keeps one row per leave', rows.length - 1, aoa.length);
check('xlsx ledger groups the employee name once', rows.slice(1).map(r => r[0]), ['Nikos Georgiou', 'Eleni Papadopoulou', '', '', 'Anna Zerva', '']);

console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
