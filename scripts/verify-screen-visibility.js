/**
 * Runnable check for the screen-visibility catalogue (ponytail rule: non-trivial matching
 * leaves one runnable check; no framework, no fixtures).
 *
 *   node scripts/verify-screen-visibility.js
 *
 * The interesting part is route matching: nested routes must resolve to their parent screen
 * (`/people/<id>` → People Directory) without prefix collisions leaking through
 * (`/leavesomething` must NOT match `/leave`).
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'screens.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const mod = { exports: {} };
new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod);
const S = mod.exports;

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};

const keyFor = p => (S.screenForPath(p) || {}).key || null;
const blocked = (p, hidden) => (S.hiddenScreenForPath(p, hidden) || {}).key || null;

// --- catalogue ---------------------------------------------------------------
check('every hideable screen has a unique key', new Set(S.HIDEABLE_SCREENS.map(s => s.key)).size, S.HIDEABLE_SCREENS.length);
check('Home is not hideable', keyFor('/'), null);
check('admin-only screens are not hideable', [keyFor('/payroll'), keyFor('/reports'), keyFor('/settings')], [null, null, null]);

// --- exact and nested routes -------------------------------------------------
check('exact path resolves', keyFor('/timesheets'), 'timesheets');
check('nested route resolves to its parent screen', keyFor('/people/34ebcb6d-84a0'), 'people');
check('trailing segment on a leaf screen resolves too', keyFor('/timesheets/2026-09'), 'timesheets');

// --- prefix collisions -------------------------------------------------------
check('a longer unrelated segment does not match', keyFor('/leavesomething'), null);
check('a longer unrelated segment does not match (timesheets)', keyFor('/timesheetsx'), null);

// --- gating ------------------------------------------------------------------
check('hidden screen blocks the route', blocked('/timesheets', ['timesheets']), 'timesheets');
check('hidden screen blocks nested routes', blocked('/people/abc', ['people']), 'people');
check('visible screen passes', blocked('/timesheets', ['compensation']), null);
check('no hidden keys → nothing blocked', blocked('/timesheets', []), null);
check('empty/unknown path is never blocked', blocked('/nope', ['timesheets']), null);
check('null pathname is never blocked', blocked(null, ['timesheets']), null);

// --- row narrowing -----------------------------------------------------------
check(
  'only hidden=true rows become keys',
  S.toHiddenScreenKeys([{ screen_key: 'leave', hidden: true }, { screen_key: 'remote', hidden: false }]),
  ['leave'],
);
check('missing rows → no keys', S.toHiddenScreenKeys(null), []);

console.log(failed === 0 ? '\nAll screen-visibility checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
