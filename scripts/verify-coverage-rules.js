/**
 * Runnable check for the coverage-rule engine (no test framework, no fixtures — ponytail rule).
 *
 *   node scripts/verify-coverage-rules.js
 *
 * Transpiles `src/lib/coverage-rules.ts` and drives the pure helpers that decide whether an
 * employee adding a remote day or a leave request would leave their group short-staffed.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'coverage-rules.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const mod = { exports: {} };
new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod);
const C = mod.exports;

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};

const team = (over = {}) => ({
  id: 'g1', name: 'Engineering', scope_type: 'team', team_id: 't1',
  max_remote_per_day: 1, max_leave_per_day: null, active: true, ...over,
});
const custom = (over = {}) => ({
  id: 'g2', name: 'Support desk', scope_type: 'custom', team_id: null,
  max_remote_per_day: null, max_leave_per_day: 2, active: true, ...over,
});
const row = (day, remote, leave, rn = null, ln = null) => ({
  day, remote_count: remote, leave_count: leave, remote_names: rn, leave_names: ln,
});

// --- caps -------------------------------------------------------------------
check('unset cap → no restriction', C.coverageCap(team({ max_remote_per_day: null }), 'remote'), null);
check('inactive group → no restriction', C.coverageCap(team({ active: false }), 'remote'), null);
check('leave cap is read separately', C.coverageCap(custom(), 'leave'), 2);
check('remote cap ignores leave cap', C.coverageCap(custom(), 'remote'), null);
check('groupsWithCap keeps only the capped kind', C.groupsWithCap([team(), custom()], 'leave').map(g => g.id), ['g2']);

// --- membership -------------------------------------------------------------
check(
  'team scope resolves from team_id',
  C.coverageGroupsForProfile('p1', 't1', [team(), custom()], [], 'remote').map(g => g.id),
  ['g1'],
);
check(
  'team scope ignores a different team',
  C.coverageGroupsForProfile('p1', 't9', [team()], [], 'remote').map(g => g.id),
  [],
);
check(
  'custom scope resolves from the member list',
  C.coverageGroupsForProfile('p1', null, [team(), custom()], [{ group_id: 'g2', profile_id: 'p1' }], 'leave').map(g => g.id),
  ['g2'],
);
check(
  'custom scope ignores non-members',
  C.coverageGroupsForProfile('p9', null, [custom()], [{ group_id: 'g2', profile_id: 'p1' }], 'leave').map(g => g.id),
  [],
);

// --- violation detection ----------------------------------------------------
const days = [row('2026-03-02', 1, 0, 'Anna Zerva'), row('2026-03-03', 0, 0), row('2026-03-04', 3, 0)];

check(
  'cap 1 with one colleague away blocks the next one',
  C.findCoverageViolations({ group: team(), kind: 'remote', rows: days }).map(v => [v.day, v.others, v.cap, v.names]),
  [['2026-03-02', 1, 1, ['Anna Zerva']], ['2026-03-04', 3, 1, []]],
);
check(
  'already counted on that day → no new slot consumed',
  C.findCoverageViolations({ group: team(), kind: 'remote', rows: days, selfCountedDates: new Set(['2026-03-02']) })
    .map(v => v.day),
  ['2026-03-04'],
);
check(
  'free day never violates',
  C.findCoverageViolations({ group: team(), kind: 'remote', rows: [days[1]] }),
  [],
);
check(
  'cap 2 tolerates one colleague away',
  C.findCoverageViolations({ group: team({ max_remote_per_day: 2 }), kind: 'remote', rows: [row('2026-03-02', 2, 0)] }).map(v => v.day),
  ['2026-03-02'],
);
check(
  'leave violations read leave_count, not remote_count',
  C.findCoverageViolations({ group: custom(), kind: 'leave', rows: [row('2026-03-02', 99, 2, null, 'Anna Zerva, Nikos Georgiou')] })
    .map(v => [v.day, v.others, v.cap, v.names]),
  [['2026-03-02', 2, 2, ['Anna Zerva', 'Nikos Georgiou']]],
);
check(
  'uncapped kind never violates',
  C.findCoverageViolations({ group: team(), kind: 'leave', rows: [row('2026-03-02', 9, 9)] }),
  [],
);

// --- RPC row normalisation --------------------------------------------------
check(
  'RPC rows are coerced to numbers and clean day keys',
  C.toCoverageLoadRows([{ day: '2026-03-02T00:00:00', remote_count: '2', leave_count: null, remote_names: null, leave_names: null }]),
  [{ day: '2026-03-02', remote_count: 2, leave_count: 0, remote_names: null, leave_names: null }],
);
check('missing RPC payload → empty list', C.toCoverageLoadRows(undefined), []);

// --- date range -------------------------------------------------------------
check('range is inclusive', C.expandDateRange('2026-03-02', '2026-03-04'), ['2026-03-02', '2026-03-03', '2026-03-04']);
check('reversed range → empty', C.expandDateRange('2026-03-04', '2026-03-02'), []);
check('single day range', C.expandDateRange('2026-03-02', '2026-03-02'), ['2026-03-02']);

// --- messages ---------------------------------------------------------------
const v = C.findCoverageViolations({ group: team(), kind: 'remote', rows: [row('2026-03-02', 1, 0, 'Anna Zerva')] })[0];
check(
  'violation message names the rule, the cap and who is away',
  C.describeViolation(v),
  'Engineering coverage rule: at most 1 can be remote per day — 1 already remote on 2026-03-02 (Anna Zerva).',
);
check(
  'office note explains a demoted auto-fill day',
  C.coverageOfficeNote(v),
  'Office (Engineering coverage cap of 1 remote per day reached)',
);
check('violationOnDay finds the matching day', C.violationOnDay([v], '2026-03-02').day, '2026-03-02');
check('violationOnDay returns null on a free day', C.violationOnDay([v], '2026-03-09'), null);

console.log(failed === 0 ? '\nAll coverage-rule checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
