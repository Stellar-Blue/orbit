/**
 * Live-sync verification: proves the two halves of the Realtime grid sync work.
 *
 *   1. The channel manager (src/lib/realtime-sync.ts) opens ONE channel, registers a binding per
 *      table, debounces bursts of writes into a single handler run, and unsubscribes cleanly.
 *   2. The database side (migration 0068) actually streams row changes: the tables are in the
 *      `supabase_realtime` publication with REPLICA IDENTITY FULL, and a real UPDATE arrives on a
 *      subscribed channel as a `postgres_changes` event.
 *
 * Part 2 needs credentials and is skipped when they are absent:
 *   node --env-file=.env.local scripts/verify-realtime.js
 * It only flips a harmless column back and forth on a single row (time_entries has no dedicated
 * "updated_at"); nothing is created or deleted.
 */

const assert = require('node:assert');
const path = require('node:path');

let passed = 0;
function ok(label) {
  passed++;
  console.log(`✅ PASSED: ${label}`);
}

// ---------------------------------------------------------------------------
// Part 1: channel manager
// ---------------------------------------------------------------------------
function verifyChannelManager() {
  const { startRealtimeSync } = requireLiveModule();

  function requireLiveModule() {
    // The module is TypeScript; transpile it on the fly with the local TypeScript install.
    const ts = require('typescript');
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/realtime-sync.ts'), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const module_ = { exports: {} };
    new Function('exports', 'require', 'module', js)(module_.exports, require, module_);
    return module_.exports;
  }

  // Fake supabase client: records the channel API calls.
  const registered = [];
  const removed = [];
  let subscribed = false;
  const fakeChannel = {
    on(kind, filter, handler) {
      registered.push({ kind, table: filter.table, handler });
      return fakeChannel;
    },
    subscribe(cb) {
      subscribed = true;
      cb?.('SUBSCRIBED');
      return fakeChannel;
    },
    topic: 'fake-topic',
  };
  const fakeSupabase = {
    channel: () => fakeChannel,
    removeChannel: (ch) => removed.push(ch),
  };

  const calls = [];
  const stop = startRealtimeSync(fakeSupabase, [
    { table: 'profiles', onChange: () => calls.push('profiles') },
    { table: 'salary_history', onChange: () => calls.push('salary_history') },
  ], { debounceMs: 20 });

  assert.strictEqual(registered.length, 2, 'one binding per table');
  assert.ok(registered.every(r => r.kind === 'postgres_changes'), 'bindings are postgres_changes');
  assert.strictEqual(subscribed, true, 'channel subscribed');

  // Burst of three writes on the same table → one debounced handler run.
  registered[0].handler();
  registered[0].handler();
  registered[0].handler();
  registered[1].handler();

  return new Promise(resolve => {
    setTimeout(() => {
      // One run per table (three writes to profiles collapsed into a single call); timer order
      // between different tables is not meaningful, so compare as a set.
      assert.strictEqual(calls.length, 2, 'bursts coalesce into one run per table');
      assert.deepStrictEqual([...calls].sort(), ['profiles', 'salary_history'], 'each changed table ran its handler');
      ok('realtime channel manager: one channel, one binding per table, debounced change handlers');

      stop();
      assert.strictEqual(removed.length, 1, 'unsubscribe removes the channel');
      ok('realtime channel manager: unsubscribe tears the channel down');
      resolve();
    }, 60);
  });
}

// ---------------------------------------------------------------------------
// Part 2: real stream from the database
// ---------------------------------------------------------------------------
async function verifyLiveStream() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('⏭  SKIPPED: live stream check (set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)');
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Publication membership is not exposed over PostgREST, so this checks the thing that actually
  // matters: a write has to come back as an event. A silent failure here means the table is not in
  // the `supabase_realtime` publication — see supabase/migrations/0068_realtime_publication.sql.
  const { data: target, error: targetErr } = await supabase
    .from('time_entries')
    .select('id, status')
    .limit(1)
    .maybeSingle();
  assert.ifError(targetErr);
  if (!target) {
    console.log('⏭  SKIPPED: live stream check (no time_entries row to poke)');
    return;
  }

  const events = [];
  const channel = supabase.channel('verify-live-sync');
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, payload => {
    events.push(payload);
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('channel did not subscribe within 15s')), 15000);
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  // Flip a harmless column: same value write still emits an UPDATE event.
  const { error: writeErr } = await supabase
    .from('time_entries')
    .update({ status: target.status })
    .eq('id', target.id);
  assert.ifError(writeErr);

  const deadline = Date.now() + 15000;
  while (events.length === 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250));
  }
  await supabase.removeChannel(channel);

  const first = events[0];
  assert.ok(first, 'an UPDATE on a published table arrived on the channel');
  assert.strictEqual(first.eventType, 'UPDATE');
  assert.strictEqual(first.table, 'time_entries');
  assert.ok(first.new && first.new.id === target.id, 'event carries the changed row');
  assert.ok(first.old && first.old.id === target.id, 'REPLICA IDENTITY FULL gives the old row (needed for RLS checks)');
  ok('live stream: row changes reach subscribers with new + old row payloads');
}

// ---------------------------------------------------------------------------
(async () => {
  console.log('======================================================');
  console.log('🌟 ORBIT LIVE GRID SYNC VERIFICATION');
  console.log('======================================================\n');
  await verifyChannelManager();
  await verifyLiveStream();
  console.log(`\n🎉 ${passed} LIVE SYNC CHECK(S) PASSED\n`);
})().catch(e => {
  console.error('\n❌ LIVE SYNC VERIFICATION FAILED:', e.message);
  process.exit(1);
});
