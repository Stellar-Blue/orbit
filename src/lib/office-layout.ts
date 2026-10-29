import type { OfficeFloor, RoomCornerName, Space, SpaceDesk, SpaceSeat, SpaceType } from '@/lib/types';

/**
 * Floor-plan maths shared by the 3D editor, the employee view and the tests.
 *
 * Coordinates are metres on a right-handed plane: X east, Z south, Y up. A room's position is its
 * centre; seats are stored relative to that centre so moving or resizing a room keeps them inside.
 */

/** Smallest room the editor allows, so a box never collapses into a line. */
export const MIN_ROOM_SIZE = 1.4;
/** Gap the auto-layout keeps between rooms and the floor edge. */
const LAYOUT_GAP = 1.2;
/** How close to a wall a seat may be dragged. */
export const SEAT_MARGIN = 0.35;
/** Editor snapping, in metres. */
export const SNAP_STEP = 0.25;

export type RoomCorner = RoomCornerName;

/** The parts of a room the shape maths needs; furniture clamping accepts a bare partial room too. */
export type RoomLike = Pick<Space, 'room_width' | 'room_depth'> &
  Partial<Pick<Space, 'room_shape' | 'notch_width' | 'notch_depth' | 'notch_corner'>>;

export const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

/** Snap to the editor grid; drag maths runs through this so saved values stay tidy. */
export const snap = (value: number, step = SNAP_STEP) => Math.round((Number(value) || 0) / step) * step;

export const roomSize = (room: Pick<Space, 'room_width' | 'room_depth'>) => ({
  width: Math.max(Number(room.room_width) || 4, MIN_ROOM_SIZE),
  depth: Math.max(Number(room.room_depth) || 3.5, MIN_ROOM_SIZE),
});

/** Default footprint for a room, sized by how it is booked. */
export function defaultRoomSize(mode: SpaceType['booking_mode']): { width: number; depth: number } {
  return mode === 'time_range' ? { width: 6, depth: 4.5 } : { width: 8, depth: 5 };
}

/**
 * Where a room goes when nobody has placed it yet: fill the floor in rows, largest rooms first so a
 * desk area does not leave unusable gaps around it.
 */
export function autoLayoutRooms(
  rooms: Array<Pick<Space, 'id' | 'room_width' | 'room_depth'>>,
  floor: Pick<OfficeFloor, 'width' | 'depth'>
): Map<string, { pos_x: number; pos_z: number }> {
  const placed = new Map<string, { pos_x: number; pos_z: number }>();
  const left = -floor.width / 2 + LAYOUT_GAP;
  const top = -floor.depth / 2 + LAYOUT_GAP;
  const right = floor.width / 2 - LAYOUT_GAP;
  let cursorX = left;
  let cursorZ = top;
  let rowDepth = 0;

  const ordered = [...rooms].sort((a, b) => (Number(b.room_width) || 4) - (Number(a.room_width) || 4));
  ordered.forEach(room => {
    const { width, depth } = roomSize(room);
    if (cursorX + width > right && cursorX > left) {
      cursorX = left;
      cursorZ += rowDepth + LAYOUT_GAP;
      rowDepth = 0;
    }
    placed.set(room.id, {
      pos_x: round2(cursorX + width / 2),
      pos_z: round2(cursorZ + depth / 2),
    });
    cursorX += width + LAYOUT_GAP;
    rowDepth = Math.max(rowDepth, depth);
  });
  return placed;
}

/** Keep a whole room on the floor slab. */
export function clampRoomToFloor(
  room: Pick<Space, 'room_width' | 'room_depth'>,
  floor: Pick<OfficeFloor, 'width' | 'depth'>,
  posX: number,
  posZ: number
): { x: number; z: number } {
  const { width, depth } = roomSize(room);
  const maxX = Math.max(floor.width / 2 - width / 2, 0);
  const maxZ = Math.max(floor.depth / 2 - depth / 2, 0);
  return {
    x: snap(Math.min(Math.max(posX, -maxX), maxX)),
    z: snap(Math.min(Math.max(posZ, -maxZ), maxZ)),
  };
}

/**
 * Resize from a dragged corner while the opposite corner stays where it is — the familiar corner
 * handle behaviour, so the room grows away from the hand instead of jumping around its centre.
 */
export function resizeFromCorner(
  room: Pick<Space, 'room_width' | 'room_depth'>,
  posX: number,
  posZ: number,
  corner: RoomCorner,
  point: { x: number; z: number },
  /** Smallest side the drag may leave behind — rooms and desks have different floors. */
  minimum = MIN_ROOM_SIZE
): { pos_x: number; pos_z: number; room_width: number; room_depth: number } {
  const { width, depth } = roomSize(room);
  const west = posX - width / 2;
  const east = posX + width / 2;
  const north = posZ - depth / 2;
  const south = posZ + depth / 2;

  const movingWest = corner === 'nw' || corner === 'sw';
  const movingNorth = corner === 'nw' || corner === 'ne';
  const anchorX = movingWest ? east : west;
  const anchorZ = movingNorth ? south : north;

  const nextWidth = Math.max(minimum, Math.abs(snap(point.x) - anchorX));
  const nextDepth = Math.max(minimum, Math.abs(snap(point.z) - anchorZ));

  return {
    room_width: round2(nextWidth),
    room_depth: round2(nextDepth),
    pos_x: round2(movingWest ? anchorX - nextWidth / 2 : anchorX + nextWidth / 2),
    pos_z: round2(movingNorth ? anchorZ - nextDepth / 2 : anchorZ + nextDepth / 2),
  };
}

/** Can this room be drawn as an L? A notch must leave at least a metre of room either side. */
export const MIN_NOTCH_GAP = 1;

export const isLShaped = (room: Pick<Space, 'room_shape'>) => room.room_shape === 'l';

/** The notch clamped to something a room can actually have. */
export function roomNotch(
  room: Pick<Space, 'room_width' | 'room_depth' | 'notch_width' | 'notch_depth' | 'notch_corner'>
): { width: number; depth: number; corner: RoomCornerName } {
  const { width, depth } = roomSize(room);
  return {
    width: Math.min(Math.max(Number(room.notch_width) || 0, 0), Math.max(width - MIN_NOTCH_GAP, 0)),
    depth: Math.min(Math.max(Number(room.notch_depth) || 0, 0), Math.max(depth - MIN_NOTCH_GAP, 0)),
    corner: room.notch_corner || 'ne',
  };
}

/**
 * The room's footprint as a polygon in local metres, going round the edge. A rectangle is four
 * corners; an L-shaped room is six, stepping around the corner it is missing.
 */
export function roomOutline(room: RoomLike): Array<{ x: number; z: number }> {
  const { width, depth } = roomSize(room);
  const halfW = width / 2;
  const halfD = depth / 2;
  if (!isLShaped(room as Pick<Space, 'room_shape'>)) {
    return [
      { x: -halfW, z: -halfD },
      { x: halfW, z: -halfD },
      { x: halfW, z: halfD },
      { x: -halfW, z: halfD },
    ];
  }

  const notch = roomNotch({ ...room, room_width: width, room_depth: depth });
  if (notch.width <= 0 || notch.depth <= 0) {
    return [
      { x: -halfW, z: -halfD },
      { x: halfW, z: -halfD },
      { x: halfW, z: halfD },
      { x: -halfW, z: halfD },
    ];
  }

  // Built for the north-east corner, then mirrored for the other three.
  const sx = notch.corner === 'ne' || notch.corner === 'se' ? 1 : -1;
  const sz = notch.corner === 'sw' || notch.corner === 'se' ? 1 : -1;
  const innerX = halfW - notch.width;
  const innerZ = halfD - notch.depth;
  return [
    { x: sx * -halfW, z: sz * -halfD },
    { x: sx * innerX, z: sz * -halfD },
    { x: sx * innerX, z: sz * innerZ },
    { x: sx * halfW, z: sz * innerZ },
    { x: sx * halfW, z: sz * halfD },
    { x: sx * -halfW, z: sz * halfD },
  ];
}

/**
 * A room as one or two rectangles the furniture can live in. An L is the union of the two bands that
 * survive the notch, which is what clamping and hit-testing need.
 */
export function roomRects(room: RoomLike): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
  const { width, depth } = roomSize(room);
  const halfW = width / 2;
  const halfD = depth / 2;
  const full = { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD };
  if (!isLShaped(room as Pick<Space, 'room_shape'>)) return [full];

  const notch = roomNotch({ ...room, room_width: width, room_depth: depth });
  if (notch.width <= 0 || notch.depth <= 0) return [full];

  const sx = notch.corner === 'ne' || notch.corner === 'se' ? 1 : -1;
  const sz = notch.corner === 'sw' || notch.corner === 'se' ? 1 : -1;
  const innerX = halfW - notch.width;
  const innerZ = halfD - notch.depth;

  return [
    // The band on the far side of the notch, full width.
    { minX: -halfW, maxX: halfW, minZ: sz > 0 ? -halfD : -innerZ, maxZ: sz > 0 ? innerZ : halfD },
    // The band on the far side of the notch, full depth.
    { minX: sx > 0 ? -halfW : -innerX, maxX: sx > 0 ? innerX : halfW, minZ: -halfD, maxZ: halfD },
  ];
}

/** Is this local point inside the room's footprint? */
export function isInsideRoom(room: RoomLike, x: number, z: number): boolean {
  return roomRects(room).some(rect => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ);
}

/**
 * Push a point into the room, keeping `margin` clear of every wall. For an L it lands in whichever of
 * the two bands is nearest, which is what a person dragging furniture would expect.
 */
export function clampPointToRoom(
  room: RoomLike,
  x: number,
  z: number,
  marginX: number,
  marginZ: number = marginX
): { x: number; z: number } {
  let best: { x: number; z: number } | null = null;
  let bestDistance = Infinity;
  roomRects(room).forEach(rect => {
    const candidateX = Math.min(Math.max(x, rect.minX + marginX), rect.maxX - marginX);
    const candidateZ = Math.min(Math.max(z, rect.minZ + marginZ), rect.maxZ - marginZ);
    const distance = (candidateX - x) ** 2 + (candidateZ - z) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: candidateX, z: candidateZ };
    }
  });
  return best || { x, z };
}

/** Footprints the editor offers as starting points, in metres. */
export const DESK_PRESETS = [
  { id: 'single', label: 'Desk', width: 1.4, depth: 0.7 },
  { id: 'compact', label: 'Compact desk', width: 1.1, depth: 0.6 },
  { id: 'bench', label: 'Bench seat', width: 2.4, depth: 0.75 },
  { id: 'table', label: 'Shared table', width: 2.8, depth: 1.1 },
  { id: 'meeting', label: 'Meeting table', width: 3.2, depth: 1.4 },
] as const;

export const MIN_DESK_SIZE = 0.6;

export const defaultDeskSize = (preset: (typeof DESK_PRESETS)[number]['id'] = 'single') => {
  const entry = DESK_PRESETS.find(presetEntry => presetEntry.id === preset) || DESK_PRESETS[0];
  return { width: entry.width, depth: entry.depth };
};

/**
 * A desk is rotated about its centre, so the space it actually needs is its bounding box. Keeping
 * the box inside the room is what stops a rotated desk from poking through a wall.
 */
export function deskFootprint(desk: Pick<SpaceDesk, 'width' | 'depth' | 'rotation'>): { width: number; depth: number } {
  const angle = (Number(desk.rotation) || 0) * (Math.PI / 180);
  const width = Math.max(Number(desk.width) || 1.4, MIN_DESK_SIZE);
  const depth = Math.max(Number(desk.depth) || 0.7, MIN_DESK_SIZE);
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  return { width: width * cos + depth * sin, depth: width * sin + depth * cos };
}

/** Keep a dragged desk inside its room, measured by what the desk actually occupies. */
export function clampDeskToRoom(
  room: RoomLike,
  desk: Pick<SpaceDesk, 'width' | 'depth' | 'rotation'>,
  x: number,
  z: number
): { x: number; z: number } {
  const footprint = deskFootprint(desk);
  return clampPointToRoom(room, x, z, footprint.width / 2 + 0.05, footprint.depth / 2 + 0.05);
}

/**
 * A row of desks along one wall — the way a whole-day area is actually furnished. The row squeezes
 * its gaps (then the desks) rather than overflowing a room that is too narrow for it.
 */
export function deskRow(
  room: Pick<Space, 'room_width' | 'room_depth'>,
  count: number,
  options: { size?: { width: number; depth: number }; gap?: number; along?: 'north' | 'south' } = {}
): Array<{ x: number; z: number; width: number; depth: number }> {
  const total = Math.max(0, Math.round(count));
  if (total === 0) return [];
  const size = options.size || defaultDeskSize('single');
  const gap = options.gap ?? 0.5;
  const { width: roomWidth, depth: roomDepth } = roomSize(room);
  const usable = Math.max(roomWidth - SEAT_MARGIN * 2, size.width);
  const wanted = total * size.width + (total - 1) * gap;
  const scale = wanted > usable ? usable / wanted : 1;
  const deskWidth = Math.max(MIN_DESK_SIZE, size.width * scale);
  const spacing = total > 1 ? ((usable - deskWidth * total) / (total - 1)) : 0;
  const startX = -((total - 1) * (deskWidth + spacing)) / 2;
  const z = (options.along === 'south' ? 1 : -1) * Math.max(roomDepth / 2 - size.depth / 2 - SEAT_MARGIN, 0);

  return Array.from({ length: total }, (_, index) => ({
    x: round2(startX + index * (deskWidth + spacing)),
    z: round2(z),
    width: round2(deskWidth),
    depth: size.depth,
  }));
}

/**
 * Keep a seat inside its room, leaving a margin so it never sits in a wall. Dragging snaps the point
 * to the grid first, so a chair can be pushed right up to the limit without overshooting it.
 */
export function clampSeatToRoom(
  room: RoomLike,
  x: number,
  z: number
): { x: number; z: number } {
  return clampPointToRoom(room, x, z, SEAT_MARGIN);
}

/**
 * A grid of seat positions inside a room. Used when a room is first drawn and by "regenerate seats",
 * so the count always matches the room's capacity.
 */
export function seatGrid(
  room: Pick<Space, 'room_width' | 'room_depth'>,
  count: number
): Array<{ x: number; z: number }> {
  const total = Math.max(0, Math.round(count));
  if (total === 0) return [];
  const { width, depth } = roomSize(room);
  const usableWidth = Math.max(width - SEAT_MARGIN * 2, 0.5);
  const usableDepth = Math.max(depth - SEAT_MARGIN * 2, 0.5);
  const cols = Math.max(1, Math.min(total, Math.ceil(Math.sqrt(total * (usableWidth / usableDepth)))));
  const rows = Math.max(1, Math.ceil(total / cols));
  const seats: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < total; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    seats.push({
      x: round2(((col + 0.5) / cols) * usableWidth - usableWidth / 2),
      z: round2(((row + 0.5) / rows) * usableDepth - usableDepth / 2),
    });
  }
  return seats;
}

/** Free seats of one room for a date, given the ids already booked. */
export function freeSeatIds(seats: SpaceSeat[], takenSeatIds: Iterable<string>): string[] {
  const taken = new Set(takenSeatIds);
  return seats.filter(seat => seat.active && !taken.has(seat.id)).map(seat => seat.id);
}

/** Label a seat the editor can name: its own label, else its index in the room. */
export function seatLabel(seat: SpaceSeat, index: number): string {
  return seat.label?.trim() || `S${index + 1}`;
}
