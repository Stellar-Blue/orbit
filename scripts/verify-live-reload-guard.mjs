/**
 * Live-reload guard verification — proves a failed refetch can never blank a grid.
 *
 * The bug this pins down: the realtime channel tells each table's reloader to refetch after a
 * write. `reloadLiveTable` used to answer `[]` for BOTH "this table is empty" and "the request
 * failed / the gate blocked me", so one bad fetch of `payments` (a 15 MB table — attached
 * documents live in the row as base64 data URLs) replaced the ledger with zero rows. Saving a
 * payment fired that event, so the grid emptied on save.
 *
 * The contract now: `null` means the read did not happen, and every consumer must leave its slice
 * alone. The checks below fail if any reloader starts applying a `null` result.
 *
 * Structural, source-level, offline:   node scripts/verify-live-reload-guard.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../src/lib/auth-context.tsx'), 'utf8');

let passed = 0;
function ok(label) {
  passed++;
  console.log(`✅ PASSED: ${label}`);
}

// ---------------------------------------------------------------------------
// 1. `reloadLiveTable` signals "no read happened" with null
// ---------------------------------------------------------------------------
const fnStart = source.indexOf('const reloadLiveTable = async');
assert(fnStart !== -1, 'reloadLiveTable not found — did it get renamed?');
const fnEnd = source.indexOf('\n  };', fnStart);
assert(fnEnd !== -1, 'could not delimit the reloadLiveTable body');
const fn = source.slice(fnStart, fnEnd);

assert.match(fn, /Promise<any\[\] \| null>/, 'reloadLiveTable must be typed as possibly-null rows');
ok('reloadLiveTable declares a possibly-null result');

assert.doesNotMatch(
  fn,
  /return \[\];/,
  'reloadLiveTable must never answer [] for a read that did not happen'
);
ok('no bare "return []" anywhere in reloadLiveTable');

assert.match(fn, /if \(gate === 'admin' && !admin\) return null;/, 'admin gate must refuse with null');
assert.match(fn, /if \(gate === 'own' && !admin && !myId\) \{[\s\S]*?return null;/, 'own gate must refuse with null');
assert.match(fn, /if \(error\) \{[\s\S]*?return null;/, 'a failed query must answer null');
assert.match(fn, /catch \(e\) \{[\s\S]*?return null;/, 'a thrown query must answer null');
ok('gate refusals, query errors and throws all answer null');

// An empty answer is only believable for a live session: anonymous RLS selects return nothing
// without erroring, so this is the quiet version of the same wipe.
assert.match(
  fn,
  /if \(!data\?\.length\) \{[\s\S]*?getSession\(\)[\s\S]*?return null;/,
  'an empty result without a session must not be applied'
);
ok('an empty result is rejected when the session is gone');

// ---------------------------------------------------------------------------
// 2. Every consumer of a reload skips its write when the read failed
// ---------------------------------------------------------------------------
const consumersStart = source.indexOf('const reloadLiveProfiles = async');
const consumersEnd = source.indexOf('// Derived / enriched slices');
assert(consumersStart !== -1 && consumersEnd > consumersStart, 'could not delimit the reloaders');

/** Guard conditions of the shape `if (!a || !b) return;`. */
function guardNames(block) {
  const names = new Set();
  for (const [, condition] of block.matchAll(/if \(([^)]*)\)\s*return;/g)) {
    if (!condition.includes('!')) continue;
    for (const [, name] of condition.matchAll(/!(\w+)/g)) names.add(name);
  }
  return names;
}

/** Split a call list on the commas that sit outside nested parentheses. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
}

// Each reloaded table must be guarded before the first state write. Walking the source instead of
// a hardcoded list means a NEW reloader is covered the moment it is added.
const reloaderCalls = [...source.matchAll(/const \[([^\]]+)\] = await Promise\.all\(\[([\s\S]*?)\]\);/g)]
  .filter(m => m.index >= consumersStart && m.index < consumersEnd && m[2].includes('reloadLiveTable'));

assert(reloaderCalls.length >= 5, `expected several reloaders, found ${reloaderCalls.length}`);

for (const call of reloaderCalls) {
  const names = call[1].split(',').map(n => n.trim()).filter(Boolean);
  const elements = splitTopLevel(call[2]);
  assert.strictEqual(
    names.length,
    elements.length,
    `expected one Promise.all element per destructured name, got ${names.length} vs ${elements.length}`
  );

  const after = source.slice(call.index + call[0].length);
  const firstWrite = after.search(/\n\s*set[A-Z]\w*\(/);
  const guarded = guardNames(firstWrite === -1 ? after : after.slice(0, firstWrite));

  // Only the reloaded tables need the guard; `fetchProfilePhones` answers null to mean "keep the
  // value you already have", which its own caller handles.
  const fromReload = names.filter((name, i) => elements[i].includes('reloadLiveTable('));
  const unguarded = fromReload.filter(name => !guarded.has(name));
  assert.deepStrictEqual(
    unguarded,
    [],
    `reloader [${names.join(', ')}] writes state without a null guard for: ${unguarded.join(', ')}`
  );
}
ok(`${reloaderCalls.length} enriched reloaders guard every reloaded table before writing state`);

// The flat one-table-one-slice bindings go through their own tiny guard.
assert.match(
  source,
  /on\(table, async \(\) => \{\s*const rows = await reloadLiveTable\(table, gate\);\s*if \(rows\) apply\(rows\);\s*\}\)/,
  'the flat bindings must skip the state write when the read failed'
);
ok('flat table bindings skip a failed read');

// ---------------------------------------------------------------------------
// 3. The reload gate agrees with the initial load
// ---------------------------------------------------------------------------
const loaderDecision = source.match(/\.eq\('profile_id', matchedId\)\.eq\('role', 'admin'\)[\s\S]{0,200}?sessionIsAdminRef\.current = isAdmin;/);
assert(loaderDecision, "the first load's authoritative role answer must be remembered for the live gate");
ok("the loader records its authoritative admin answer");

assert.match(
  source,
  /const liveIsAdmin = sessionIsAdminRef\.current[\s\S]{0,160}profiles\.some\(/,
  'the live gate must consult the remembered answer, not only the profiles slice'
);
ok('the live gate consults the remembered answer too');

console.log(`\n🎉 ${passed} LIVE RELOAD GUARD CHECK(S) PASSED\n`);
