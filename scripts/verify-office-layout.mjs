/**
 * Verification for the 3D floor-plan maths.
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-office-layout.mjs
 *
 * The three.js canvas is not testable here; everything the editor computes before it draws — where a
 * room lands, how a corner drag resizes it, where a chair may go — is a pure function and is covered.
 */

import {
  DESK_PRESETS,
  MIN_DESK_SIZE,
  MIN_ROOM_SIZE,
  SEAT_MARGIN,
  SNAP_STEP,
  autoLayoutRooms,
  clampDeskToRoom,
  clampPointToRoom,
  clampRoomToFloor,
  clampSeatToRoom,
  defaultDeskSize,
  defaultRoomSize,
  deskFootprint,
  deskRow,
  freeSeatIds,
  isInsideRoom,
  isLShaped,
  resizeFromCorner,
  roomNotch,
  roomOutline,
  roomRects,
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

// ---- desks -------------------------------------------------------------------------
assert(
  defaultDeskSize('single').width === 1.4 && DESK_PRESETS.length >= 4,
  'A new desk starts from a real-world footprint',
  DESK_PRESETS.map(preset => preset.label).join(', ')
);
assert(
  deskFootprint({ width: 2, depth: 1, rotation: 0 }).width === 2,
  'An unrotated desk takes exactly its own width'
);
assert(
  Math.abs(deskFootprint({ width: 2, depth: 1, rotation: 90 }).width - 1) < 1e-9,
  'A desk turned 90° takes its depth where its width was'
);
const tightDesk = clampDeskToRoom(desks, { width: 1.4, depth: 0.7, rotation: 0 }, 100, -100);
assert(
  tightDesk.x === 5 - 0.7 - 0.05 && tightDesk.z === -(3 - 0.35 - 0.05),
  'A desk cannot be dragged through a wall',
  `x ${tightDesk.x} · z ${tightDesk.z}`
);
const row = deskRow(desks, 4, { size: { width: 1.4, depth: 0.7 } });
assert(row.length === 4, 'A desk row adds one desk per place');
assert(
  row.every(desk => clampDeskToRoom(desks, desk, desk.x, desk.z).x === desk.x),
  'Every desk in a row fits inside the room'
);
assert(
  new Set(row.map(desk => desk.x)).size === 4,
  'A desk row never stacks two desks on one spot'
);
assert(
  deskRow({ room_width: 2, room_depth: 2 }, 6).every(desk => desk.width >= MIN_DESK_SIZE),
  'A row squeezed into a narrow room stops at the minimum desk size'
);
assert(deskRow(desks, 0).length === 0, 'Zero places means no desks');
assert(
  resizeFromCorner({ room_width: 1.4, room_depth: 0.7 }, 0, 0, 'se', { x: -0.7, z: -0.35 }, MIN_DESK_SIZE).room_width === MIN_DESK_SIZE,
  'A desk corner drag stops at the desk minimum, not the room minimum'
);

// ---- room shapes -------------------------------------------------------------------
const lRoom = {
  room_width: 8, room_depth: 6, room_shape: 'l',
  notch_width: 3, notch_depth: 2, notch_corner: 'ne',
};

assert(!isLShaped({ room_shape: 'rect' }) && isLShaped(lRoom), 'A room knows whether it is an L');
assert(roomOutline({ room_width: 8, room_depth: 6 }).length === 4, 'A rectangle is four corners');
assert(roomOutline(lRoom).length === 6, 'An L adds the two corners of its step');
assert(
  roomOutline(lRoom).some(point => point.x === 1 && point.z === -1) &&
  roomOutline(lRoom).some(point => point.x === 4 && point.z === -1),
  'The outline steps around the missing corner',
  roomOutline(lRoom).map(point => `(${point.x},${point.z})`).join(' ')
);
assert(
  roomOutline({ ...lRoom, notch_corner: 'sw' }).some(point => point.x === -4 && point.z === 1),
  'Mirroring the corner mirrors the step'
);
assert(roomRects({ room_width: 8, room_depth: 6 }).length === 1, 'A rectangle is one band');
assert(roomRects(lRoom).length === 2, 'An L is two bands');
assert(
  !isInsideRoom(lRoom, 3.2, -2.6),
  'A point inside the missing corner is outside the room'
);
assert(isInsideRoom(lRoom, -3, -2.6) && isInsideRoom(lRoom, 3.2, 2), 'The two arms of the L are inside');

const pushed = clampPointToRoom(lRoom, 3.2, -2.6, 0.3);
assert(
  isInsideRoom(lRoom, pushed.x, pushed.z) && !isInsideRoom(lRoom, 3.2, -2.6),
  'A chair dragged into the missing corner is pushed back into the room',
  `→ (${pushed.x}, ${pushed.z})`
);
const clampedChair = clampSeatToRoom(lRoom, 3.2, -2.6);
assert(
  isInsideRoom(lRoom, clampedChair.x, clampedChair.z),
  'Seat clamping follows the room shape',
  `→ (${clampedChair.x}, ${clampedChair.z})`
);
assert(
  roomNotch({ ...lRoom, notch_width: 20, notch_depth: 20 }).width === 7,
  'A notch can never swallow the whole room',
  `clamped to ${roomNotch({ ...lRoom, notch_width: 20, notch_depth: 20 }).width} m`
);

console.log('\n================================================================');
console.log(`${passed} passed · ${failed} failed`);
console.log('================================================================');
process.exit(failed === 0 ? 0 : 1);
