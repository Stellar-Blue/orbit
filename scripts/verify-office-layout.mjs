/**
 * Verification for the 3D floor-plan maths.
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-office-layout.mjs
 *
 * The three.js canvas is not testable here; everything the editor computes before it draws — where a
 * room lands, how a corner drag resizes it, where a chair may go — is a pure function and is covered.
 */

import {
  MIN_ROOM_SIZE,
  SEAT_MARGIN,
  SNAP_STEP,
  autoLayoutRooms,
  clampRoomToFloor,
  clampSeatToRoom,
  defaultRoomSize,
  freeSeatIds,
  resizeFromCorner,
  roomSize,
  seatGrid,
  seatLabel,
  snap,
} from '@/lib/office-layout';

let passed = 0;
let failed = 0;

function assert(condition, name, details = '') {
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    if (details) console.log(`          └─ ${details}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${name}`);
    if (details) console.error(`          └─ ${details}`);
    failed++;
  }
}

console.log('================================================================');
console.log('🚀 ORBIT 3D FLOOR PLAN - VERIFICATION');
console.log('================================================================\n');

const floor = { width: 24, depth: 16 };
const desks = { id: 'desks', room_width: 10, room_depth: 6 };
const conf = { id: 'conf', room_width: 7, room_depth: 5 };

assert(snap(1.13) === 1.25 && snap(-1.13) === -1.25, 'Drag maths snaps to the 25 cm grid', `${SNAP_STEP} m`);
assert(
  roomSize({}).width === 4 && roomSize({}).depth === 3.5,
  'A room with no geometry gets the default footprint'
);
assert(
  roomSize({ room_width: 0.5, room_depth: 0.5 }).width === MIN_ROOM_SIZE,
  'A room never collapses below the minimum size',
  `${MIN_ROOM_SIZE} m`
);
assert(
  defaultRoomSize('time_range').width < defaultRoomSize('whole_day').width,
  'Timed rooms start smaller than whole-day desk areas'
);

const placed = autoLayoutRooms([desks, conf], floor);

assert(placed.size === 2, 'Auto layout places every room');
assert(
  [...placed.values()].every(position => (
    Math.abs(position.pos_x) + desks.room_width / 2 <= floor.width / 2
    || Math.abs(position.pos_x) - conf.room_width / 2 <= floor.width / 2
  )),
  'Auto layout keeps rooms inside the slab'
);
assert(
  placed.get('desks').pos_x !== placed.get('conf').pos_x || placed.get('desks').pos_z !== placed.get('conf').pos_z,
  'Auto layout never stacks two rooms on the same spot'
);

const clamped = clampRoomToFloor(desks, floor, 100, -100);
assert(
  clamped.x === floor.width / 2 - 5 && clamped.z === -(floor.depth / 2 - 3),
  'A room dragged past the edge stops at the wall',
  `x ${clamped.x} · z ${clamped.z}`
);

const resized = resizeFromCorner(desks, 0, 0, 'se', { x: 7, z: 3 });
assert(
  resized.room_width === 12 && resized.room_depth === 6,
  'Pulling the south-east corner grows the room away from the north-west one',
  `${resized.room_width} × ${resized.room_depth} m at (${resized.pos_x}, ${resized.pos_z})`
);
assert(
  resized.pos_x - resized.room_width / 2 === -5 && resized.pos_z - resized.room_depth / 2 === -3,
  'The opposite corner stays pinned while resizing'
);
assert(
  resizeFromCorner(desks, 0, 0, 'se', { x: -5, z: -3 }).room_width === MIN_ROOM_SIZE,
  'A corner dragged onto its anchor keeps the minimum room size'
);

const pinched = clampSeatToRoom(desks, 100, 100);
assert(
  pinched.x === desks.room_width / 2 - SEAT_MARGIN && pinched.z === desks.room_depth / 2 - SEAT_MARGIN,
  'A chair cannot be dragged into a wall',
  `x ${pinched.x} · z ${pinched.z}`
);

const grid = seatGrid(desks, 12);
assert(grid.length === 12, 'The seat grid holds exactly the room capacity');
assert(
  grid.every(seat => clampSeatToRoom(desks, seat.x, seat.z).x === seat.x && clampSeatToRoom(desks, seat.x, seat.z).z === seat.z),
  'Every generated chair sits inside its room'
);
assert(
  new Set(grid.map(seat => `${seat.x}:${seat.z}`)).size === 12,
  'No two chairs are generated on the same spot'
);
assert(seatGrid(desks, 0).length === 0, 'A room with no capacity gets no chairs');

const seats = [
  { id: 's1', space_id: 'desks', x: 0, z: 0, rotation: 0, active: true },
  { id: 's2', space_id: 'desks', x: 1, z: 0, rotation: 0, active: true },
  { id: 's3', space_id: 'desks', x: 2, z: 0, rotation: 0, active: false },
];
assert(
  freeSeatIds(seats, ['s1']).join(',') === 's2',
  'Free seats exclude the ones booked and the ones switched off'
);
assert(
  seatLabel({ id: 'x', space_id: 'desks', x: 0, z: 0, rotation: 0, active: true, label: null }, 4) === 'S5',
  'An unnamed chair is labelled by its place in the room'
);
assert(
  seatLabel({ ...seats[0], label: 'Window' }, 0) === 'Window',
  'A named chair keeps its name'
);

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
