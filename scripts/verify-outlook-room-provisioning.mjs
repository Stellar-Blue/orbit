/**
 * Verification for syncing Orbit rooms into Outlook's Places directory.
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-outlook-room-provisioning.mjs
 *
 * The Graph calls need a tenant; what is asserted here is the shape sent to Graph, the delta that
 * decides whether to PATCH, the link the room info shows and the report an admin reads.
 */

import {
  describePlaceFailure, roomPlaceFields, roomPlacePatch, roomProvisionReport,
} from '@/lib/room-sync';
import { outlookRoomUrl } from '@/lib/spaces';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    if (details) console.log(`          └─ ${details}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    if (details) console.error(`          └─ ${details}`);
    failed++;
  }
}

const equal = (actual, expected, testName) =>
  assert(JSON.stringify(actual) === JSON.stringify(expected), testName, `got ${JSON.stringify(actual)}`);

// ---------------------------------------------------------------------------
// Outlook room link
// ---------------------------------------------------------------------------

equal(
  outlookRoomUrl('Athena@StellarBlue.eu'),
  'https://outlook.office.com/mail/Athena%40StellarBlue.eu/calendar',
  'the Outlook link opens the room mailbox calendar'
);

assert(outlookRoomUrl(null) === null, 'no mailbox means no Outlook link');
assert(outlookRoomUrl('   ') === null, 'a blank mailbox means no Outlook link');

// ---------------------------------------------------------------------------
// What an Orbit room looks like in Outlook
// ---------------------------------------------------------------------------

equal(
  roomPlaceFields({ name: '  Athena ', capacity: 8, location: 'Andrianoupoleos 14' }, 'Main'),
  { displayName: 'Athena', capacity: 8, building: 'Andrianoupoleos 14', floorLabel: 'Main' },
  'name, capacity, location and floor are carried over'
);

equal(
  roomPlaceFields({ name: 'Room', capacity: 0, location: '' }, null, { building: 'HQ', floor: 'Ground' }),
  { displayName: 'Room', capacity: 1, building: 'HQ', floorLabel: 'Ground' },
  'a missing location/floor and a bad capacity fall back safely'
);

equal(
  roomPlacePatch(
    { displayName: 'Athena', capacity: 8, building: 'Andrianoupoleos 14', floorLabel: 'Main' },
    roomPlaceFields({ name: 'Athena', capacity: 8, location: 'Andrianoupoleos 14' }, 'Main')
  ),
  {},
  'a room already matching Outlook is not PATCHed'
);

equal(
  roomPlacePatch(
    { displayName: 'Old name', capacity: 4, building: 'HQ', floorLabel: 'Main' },
    roomPlaceFields({ name: 'Athena', capacity: 8, location: 'HQ' }, 'Main')
  ),
  { displayName: 'Athena', capacity: 8 },
  'only the drifted fields are PATCHed'
);

equal(
  roomPlacePatch(
    { displayName: 'Athena', capacity: 8, building: '', floorLabel: null },
    roomPlaceFields({ name: 'Athena', capacity: 8, location: 'HQ' }, 'Ground')
  ),
  { building: 'HQ', floorLabel: 'Ground' },
  'a missing Outlook building/floor is filled in'
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const created = roomProvisionReport([
  { space_id: 'a', name: 'Athena', outcome: 'created', outlook_email: 'athena@stellarblue.eu', backfilled: 2, sync: { ok: true, created: 1, updated: 0, deleted: 0, clashes: 0, issues: [] } },
]);
assert(created.ok, 'a clean run reports ok');
assert(created.summary.includes('1 room created'), 'the summary counts created rooms', created.summary);

const unchanged = roomProvisionReport([
  { space_id: 'a', name: 'Athena', outcome: 'unchanged' },
]);
assert(unchanged.ok && unchanged.summary.includes('already in Outlook'), 'an in-step room is reported as such', unchanged.summary);

const empty = roomProvisionReport([]);
assert(empty.ok && empty.summary.includes('no room'), 'nothing to do is not a failure', empty.summary);

const refuse = roomProvisionReport([
  { space_id: 'a', name: 'Athena', outcome: 'failed', message: 'Orbit may not create Outlook rooms.' },
]);
assert(!refuse.ok, 'a failed room makes the run fail');
assert(refuse.summary.includes('1 room failed'), 'the summary counts failed rooms', refuse.summary);
assert(refuse.problems.some(line => line.includes('Athena') && line.includes('may not create')), 'the failure names the room and the reason');

const problem = roomProvisionReport([
  { space_id: 'a', name: 'Athena', outcome: 'created', subscription: { state: 'skipped', reason: 'live updates off' } },
]);
assert(!problem.ok && problem.problems.some(line => line.startsWith('Athena:')), 'a sync problem is reported against its room');

const skipped = roomProvisionReport([
  { space_id: 'a', name: 'Desk', outcome: 'skipped', message: 'Only rooms booked by the hour can have an Outlook room mailbox.' },
]);
assert(!skipped.ok && skipped.problems[0].includes('booked by the hour'), 'a targeted whole-day room explains why it was skipped');

// ---------------------------------------------------------------------------
// Graph failure sentences
// ---------------------------------------------------------------------------

const denied = describePlaceFailure({ status: 403 }, 'create');
assert(denied.includes('Place.ReadWrite.All'), 'a refusal names the missing Graph permission', denied);
assert(denied.includes('MailRecipient') && denied.includes('TenantPlacesManagement'), 'a refusal names the missing Exchange roles', denied);
assert(describePlaceFailure({ status: 404 }, 'read').includes('does not list this room'), 'a missing place is explained');
assert(describePlaceFailure({ status: 0, code: 'no_token' }, 'create').includes('not configured'), 'a missing token is explained');
assert(describePlaceFailure({ status: 400, code: 'BadRequest', message: 'nope' }, 'update').includes('BadRequest'), 'other failures keep the Graph code');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
