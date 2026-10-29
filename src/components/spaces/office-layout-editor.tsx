"use client";

import React, { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Armchair, Building2, LayoutGrid, Plus, Redo2, RotateCcw, Rows3, Save, Trash2, Wand2, RectangleHorizontal,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { notifySuccess } from '@/lib/validation-modal';
import { useAuth } from '@/lib/auth-context';
import {
  autoLayoutRooms, clampDeskToRoom, clampSeatToRoom, defaultDeskSize, defaultRoomSize, deskRow,
  DESK_PRESETS, MIN_DESK_SIZE, roomNotch, roomSize, seatGrid, seatLabel, snap, SNAP_STEP,
} from '@/lib/office-layout';
import type {
  OfficeFloor, RoomCornerName, RoomShape, Space, SpaceDesk, SpaceSeat,
} from '@/lib/types';
import type { Office3DProps } from '@/components/spaces/office-3d';

const Office3D = dynamic<Office3DProps>(
  () => import('@/components/spaces/office-3d').then(module => module.Office3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-[12px] font-medium text-[var(--ink-4)]">
        Drawing the floor…
      </div>
    ),
  }
);

type RoomDraft = {
  id: string;
  pos_x: number;
  pos_z: number;
  room_width: number;
  room_depth: number;
  capacity: number;
  floor_id: string | null;
  room_shape: RoomShape;
  notch_width: number;
  notch_depth: number;
  notch_corner: RoomCornerName;
};

type SeatDraft = {
  id: string;
  space_id: string;
  label: string | null;
  x: number;
  z: number;
  rotation: number;
  active: boolean;
};

type DeskDraft = {
  id: string;
  space_id: string;
  label: string | null;
  description: string | null;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  active: boolean;
};

const toDeskDraft = (desk: SpaceDesk): DeskDraft => ({
  id: desk.id,
  space_id: desk.space_id,
  label: desk.label ?? null,
  description: desk.description ?? null,
  x: Number(desk.x) || 0,
  z: Number(desk.z) || 0,
  width: Number(desk.width) || 1.4,
  depth: Number(desk.depth) || 0.7,
  rotation: Number(desk.rotation) || 0,
  active: desk.active,
});

const toRoomDraft = (room: Space, floorId: string): RoomDraft => {
  const { width, depth } = roomSize(room);
  const notch = roomNotch({ ...room, room_width: width, room_depth: depth });
  return {
    id: room.id,
    pos_x: Number(room.pos_x) || 0,
    pos_z: Number(room.pos_z) || 0,
    room_width: width,
    room_depth: depth,
    capacity: room.capacity,
    floor_id: room.floor_id || floorId,
    room_shape: room.room_shape === 'l' ? 'l' : 'rect',
    notch_width: notch.width,
    notch_depth: notch.depth,
    notch_corner: notch.corner,
  };
};

const toSeatDraft = (seat: SpaceSeat): SeatDraft => ({
  id: seat.id,
  space_id: seat.space_id,
  label: seat.label ?? null,
  x: Number(seat.x) || 0,
  z: Number(seat.z) || 0,
  rotation: Number(seat.rotation) || 0,
  active: seat.active,
});

/**
 * Match a room's chairs to a count without moving the ones already placed: dropping capacity removes
 * the last chairs, adding capacity appends new ones. Used when the capacity field changes.
 */
function resizeSeats(room: RoomDraft, existing: SeatDraft[], count: number): SeatDraft[] {
  if (count <= existing.length) {
    return existing.slice(0, count).map((seat, index) => ({ ...seat, label: seat.label || `S${index + 1}` }));
  }
  const positions = seatGrid(room, count).slice(existing.length);
  const added = positions.map((position, offset) => ({
    id: crypto.randomUUID(),
    space_id: room.id,
    label: `S${existing.length + offset + 1}`,
    x: position.x,
    z: position.z,
    rotation: 0,
    active: true,
  }));
  return [...existing, ...added];
}

/** Re-lay every chair of a room on a fresh grid, keeping the ids so bookings survive. */
function regenerateSeats(room: RoomDraft, existing: SeatDraft[], count: number): SeatDraft[] {
  const positions = seatGrid(room, count);
  return positions.map((position, index) => {
    const seat = existing[index];
    if (seat) {
      return { ...seat, x: position.x, z: position.z, label: seat.label || `S${index + 1}`, active: true };
    }
    return {
      id: crypto.randomUUID(),
      space_id: room.id,
      label: `S${index + 1}`,
      x: position.x,
      z: position.z,
      rotation: 0,
      active: true,
    };
  });
}

/** Four quick angles plus a slider, used for chairs and desks alike. */
function RotationControl({ value, onChange }: { value: number; onChange: (degrees: number) => void }) {
  const angle = ((Math.round(value) % 360) + 360) % 360;
  return (
    <div>
      <label className="ui-label mb-1 block">Rotation</label>
      <div className="grid grid-cols-4 gap-1.5">
        {[0, 90, 180, 270].map(step => (
          <button
            key={step}
            type="button"
            onClick={() => onChange(step)}
            className={`cursor-pointer rounded-[var(--radius-control)] border px-2 py-1 font-mono text-[11px] transition-colors ${
              angle === step
                ? 'border-[var(--accent)] bg-[var(--surface-muted)] font-semibold text-[var(--ink)]'
                : 'border-[var(--line)] bg-white text-[var(--ink-3)] hover:bg-[var(--surface-muted)]'
            }`}
          >
            {step}°
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={355}
          step={5}
          value={angle}
          onChange={event => onChange(Number(event.target.value))}
          className="w-full cursor-pointer accent-[var(--accent)]"
          aria-label="Rotation angle"
        />
        <span className="w-10 shrink-0 text-right font-mono text-[11px] text-[var(--ink-3)]">{angle}°</span>
      </div>
    </div>
  );
}

/**
 * Admin floor-plan editor.
 *
 * Everything is a local draft until Save: dragging a room, pulling a corner or moving a chair only
 * touches React state, so a reload or Reset throws the experiment away. The plan, the rooms and the
 * chairs come from `saveOfficeLayout`, which also prunes the chairs that were removed.
 */
export function OfficeLayoutEditor() {
  const { officeFloors } = useAuth();
  const floors = useMemo(
    () => [...officeFloors].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [officeFloors]
  );
  const [floorId, setFloorId] = useState<string>('');
  const floor = floors.find(entry => entry.id === floorId) || floors[0] || null;

  if (!floor) {
    return (
      <Card title="Floor plan" subtitle="No floor has been declared yet.">
        <div className="py-8 text-center">
          <Building2 className="mx-auto h-6 w-6 text-[var(--ink-4)]" />
          <p className="mt-2 text-[13px] font-semibold text-[var(--ink-2)]">Nothing to draw on</p>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-[var(--ink-4)]">
            A floor (or office) has to exist before rooms can be placed on it. Apply the office floor
            migrations to seed the first floor.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <FloorEditor
      key={floor.id}
      floor={floor}
      floors={floors}
      onSelectFloor={setFloorId}
    />
  );
}

interface FloorEditorProps {
  floor: OfficeFloor;
  floors: OfficeFloor[];
  onSelectFloor: (id: string) => void;
}

function FloorEditor({ floor, floors, onSelectFloor }: FloorEditorProps) {
  const {
    spaces, spaceTypes, spaceSeats, spaceDesks, saveOfficeLayout,
  } = useAuth();

  const typesById = useMemo(() => new Map(spaceTypes.map(type => [type.id, type])), [spaceTypes]);
  const roomsById = useMemo(() => new Map(spaces.map(space => [space.id, space])), [spaces]);

  const seededRooms = useMemo(
    () => spaces.filter(space => space.floor_id === floor.id).map(space => toRoomDraft(space, floor.id)),
    [spaces, floor.id]
  );
  const floorRoomIds = useMemo(
    () => new Set(spaces.filter(space => space.floor_id === floor.id).map(space => space.id)),
    [spaces, floor.id]
  );
  const seededSeats = useMemo(
    () => spaceSeats.filter(seat => floorRoomIds.has(seat.space_id)).map(toSeatDraft),
    [spaceSeats, floorRoomIds]
  );
  const seededDesks = useMemo(
    () => spaceDesks.filter(desk => floorRoomIds.has(desk.space_id)).map(toDeskDraft),
    [spaceDesks, floorRoomIds]
  );

  const [rooms, setRooms] = useState<RoomDraft[]>(seededRooms);
  const [seats, setSeats] = useState<SeatDraft[]>(seededSeats);
  const [desks, setDesks] = useState<DeskDraft[]>(seededDesks);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Throw the draft away and re-read what has been saved. */
  const reset = () => {
    setRooms(seededRooms);
    setSeats(seededSeats);
    setDesks(seededDesks);
    setSelectedRoomId(null);
    setSelectedSeatId(null);
    setSelectedDeskId(null);
    setDirty(false);
  };

  const unplaced = useMemo(
    () => spaces.filter(space => space.active && !space.floor_id),
    [spaces]
  );

  const roomsOnFloor = useMemo(
    () => rooms
      .map(draft => roomsById.get(draft.id))
      .filter((room): room is Space => Boolean(room)),
    [rooms, roomsById]
  );

  const draftRoomsAsSpaces = useMemo(
    () => roomsOnFloor.map(room => {
      const draft = rooms.find(entry => entry.id === room.id);
      return {
        ...room,
        ...(draft ? {
          pos_x: draft.pos_x,
          pos_z: draft.pos_z,
          room_width: draft.room_width,
          room_depth: draft.room_depth,
          capacity: draft.capacity,
          room_shape: draft.room_shape,
          notch_width: draft.notch_width,
          notch_depth: draft.notch_depth,
          notch_corner: draft.notch_corner,
        } : {}),
      };
    }),
    [roomsOnFloor, rooms]
  );

  const draftSeatsAsSpaces = useMemo<SpaceSeat[]>(() => seats.map(seat => ({ ...seat })), [seats]);
  const draftDesksAsSpaces = useMemo<SpaceDesk[]>(() => desks.map(desk => ({ ...desk })), [desks]);

  const selectedRoom = draftRoomsAsSpaces.find(room => room.id === selectedRoomId) || null;
  const selectedSeat = seats.find(seat => seat.id === selectedSeatId) || null;
  const selectedDesk = desks.find(desk => desk.id === selectedDeskId) || null;
  const desksOfRoom = (roomId: string) => desks.filter(desk => desk.space_id === roomId);

  const colorForRoom = useCallback(
    (room: Space) => typesById.get(room.type_id)?.color || '#64748b',
    [typesById]
  );
  const kindForRoom = useCallback(
    (room: Space) => typesById.get(room.type_id)?.booking_mode ?? null,
    [typesById]
  );

  const updateRoom = (id: string, patch: Partial<RoomDraft>) => {
    setRooms(prev => prev.map(room => (room.id === id ? { ...room, ...patch } : room)));
    setDirty(true);
  };

  const moveRoom = (room: Space, x: number, z: number) => updateRoom(room.id, { pos_x: snap(x), pos_z: snap(z) });

  const resizeRoom = (room: Space, width: number, depth: number, x: number, z: number) => {
    updateRoom(room.id, { room_width: width, room_depth: depth, pos_x: x, pos_z: z });
    // Shrinking a room pulls its furniture back inside instead of leaving it in the corridor.
    const size = { room_width: width, room_depth: depth };
    setSeats(prev => prev.map(seat => (
      seat.space_id === room.id ? { ...seat, ...clampSeatToRoom(size, seat.x, seat.z) } : seat
    )));
    setDesks(prev => prev.map(desk => (
      desk.space_id === room.id ? { ...desk, ...clampDeskToRoom(size, desk, desk.x, desk.z) } : desk
    )));
  };

  const moveSeat = (seat: SpaceSeat, x: number, z: number) => {
    const room = rooms.find(entry => entry.id === seat.space_id);
    const position = clampSeatToRoom(room || {}, snap(x), snap(z));
    setSeats(prev => prev.map(entry => (entry.id === seat.id ? { ...entry, x: position.x, z: position.z } : entry)));
    setDirty(true);
  };

  /** Turn a chair in place; the base stays where it is, only the facing changes. */
  const rotateSeat = (seat: SpaceSeat, degrees: number) => {
    const angle = ((Math.round(degrees) % 360) + 360) % 360;
    setSeats(prev => prev.map(entry => (entry.id === seat.id ? { ...entry, rotation: angle } : entry)));
    setDirty(true);
  };

  const updateDesk = (id: string, patch: Partial<DeskDraft>) => {
    setDesks(prev => prev.map(desk => (desk.id === id ? { ...desk, ...patch } : desk)));
    setDirty(true);
  };

  /** Move or resize a desk, keeping its footprint inside its room. */
  const placeDesk = (desk: SpaceDesk, patch: Partial<DeskDraft>) => {
    const room = rooms.find(entry => entry.id === desk.space_id);
    const next = { ...desk, ...patch };
    const position = clampDeskToRoom(
      (room || {}) as { room_width?: number; room_depth?: number },
      { width: next.width, depth: next.depth, rotation: next.rotation },
      snap(next.x ?? desk.x),
      snap(next.z ?? desk.z)
    );
    updateDesk(desk.id, { ...patch, x: position.x, z: position.z });
  };

  const moveDesk = (desk: SpaceDesk, x: number, z: number) => placeDesk(desk, { x, z });

  const resizeDesk = (desk: SpaceDesk, width: number, depth: number) => placeDesk(desk, {
    width: Math.max(MIN_DESK_SIZE, width),
    depth: Math.max(MIN_DESK_SIZE, depth),
  });

  const rotateDesk = (desk: SpaceDesk, degrees: number) => placeDesk(desk, {
    rotation: ((Math.round(degrees) % 360) + 360) % 360,
  });

  /** Drop one desk into a room, just inside the north wall. */
  const addDesk = (room: Space, preset: (typeof DESK_PRESETS)[number]['id'] = 'single') => {
    const draft = rooms.find(entry => entry.id === room.id);
    if (!draft) return;
    const size = defaultDeskSize(preset);
    const position = clampDeskToRoom(draft, { ...size, rotation: 0 }, 0, -draft.room_depth / 2 + size.depth / 2 + 0.45);
    const desk: DeskDraft = {
      id: crypto.randomUUID(),
      space_id: room.id,
      label: `${DESK_PRESETS.find(presetEntry => presetEntry.id === preset)?.label || 'Desk'} ${desksOfRoom(room.id).length + 1}`,
      description: null,
      x: position.x,
      z: position.z,
      width: size.width,
      depth: size.depth,
      rotation: 0,
      active: true,
    };
    setDesks(prev => [...prev, desk]);
    setSelectedDeskId(desk.id);
    setSelectedSeatId(null);
    setSelectedRoomId(room.id);
    setDirty(true);
  };

  /** A whole row of desks along a wall, sized to fit the room. */
  const addDeskRow = (room: Space) => {
    const draft = rooms.find(entry => entry.id === room.id);
    if (!draft) return;
    const count = Math.max(2, Math.min(8, Math.floor(draft.room_width / 1.7)));
    const size = defaultDeskSize('single');
    const row = deskRow(draft, count, { size });
    const existing = desksOfRoom(room.id).length;
    const added: DeskDraft[] = row.map((position, index) => ({
      id: crypto.randomUUID(),
      space_id: room.id,
      label: `Desk ${existing + index + 1}`,
      description: null,
      x: position.x,
      z: position.z,
      width: position.width,
      depth: position.depth,
      rotation: 0,
      active: true,
    }));
    setDesks(prev => [...prev, ...added]);
    setSelectedDeskId(added[0]?.id || null);
    setSelectedSeatId(null);
    setSelectedRoomId(room.id);
    setDirty(true);
  };

  const removeDesk = (deskId: string) => {
    setDesks(prev => prev.filter(desk => desk.id !== deskId));
    setSelectedDeskId(null);
    setDirty(true);
  };

  const setCapacity = (room: Space, capacity: number) => {
    const next = Math.max(1, Math.min(80, Math.round(capacity) || 1));
    const draft = rooms.find(entry => entry.id === room.id);
    if (!draft) return;
    const nextRoom = { ...draft, capacity: next };
    setRooms(prev => prev.map(entry => (entry.id === room.id ? nextRoom : entry)));
    setSeats(prev => {
      const roomSeats = prev.filter(seat => seat.space_id === room.id);
      const others = prev.filter(seat => seat.space_id !== room.id);
      return [...others, ...resizeSeats(nextRoom, roomSeats, next)];
    });
    setDirty(true);
  };

  const regenerateRoomSeats = (room: Space) => {
    const draft = rooms.find(entry => entry.id === room.id);
    if (!draft) return;
    setSeats(prev => {
      const roomSeats = prev.filter(seat => seat.space_id === room.id);
      const others = prev.filter(seat => seat.space_id !== room.id);
      return [...others, ...regenerateSeats(draft, roomSeats, draft.capacity)];
    });
    setSelectedSeatId(null);
    setDirty(true);
  };

  const addSeat = (room: Space) => {
    const draft = rooms.find(entry => entry.id === room.id);
    if (!draft) return;
    const roomSeats = seats.filter(seat => seat.space_id === room.id);
    const positions = seatGrid(draft, roomSeats.length + 1);
    const position = positions[positions.length - 1] || { x: 0, z: 0 };
    const seat: SeatDraft = {
      id: crypto.randomUUID(),
      space_id: room.id,
      label: `S${roomSeats.length + 1}`,
      x: position.x,
      z: position.z,
      rotation: 0,
      active: true,
    };
    setSeats(prev => [...prev, seat]);
    setRooms(prev => prev.map(entry => (entry.id === room.id ? { ...entry, capacity: roomSeats.length + 1 } : entry)));
    setSelectedSeatId(seat.id);
    setDirty(true);
  };

  const removeSeat = (seatId: string) => {
    const seat = seats.find(entry => entry.id === seatId);
    if (!seat) return;
    const remaining = seats.filter(entry => entry.id !== seatId && entry.space_id === seat.space_id).length;
    setSeats(prev => prev.filter(entry => entry.id !== seatId));
    setRooms(prev => prev.map(entry => (
      entry.id === seat.space_id ? { ...entry, capacity: Math.max(1, remaining) } : entry
    )));
    setSelectedSeatId(null);
    setDirty(true);
  };

  const arrange = () => {
    const placed = autoLayoutRooms(rooms, floor);
    setRooms(prev => prev.map(room => {
      const position = placed.get(room.id);
      return position ? { ...room, pos_x: position.pos_x, pos_z: position.pos_z } : room;
    }));
    setDirty(true);
  };

  const addRoomToFloor = (room: Space) => {
    const type = typesById.get(room.type_id);
    const size = defaultRoomSize(type?.booking_mode || 'whole_day');
    const placed = autoLayoutRooms(
      [...rooms, { id: room.id, room_width: size.width, room_depth: size.depth }],
      floor
    );
    const position = placed.get(room.id) || { pos_x: 0, pos_z: 0 };
    const draft: RoomDraft = {
      id: room.id, pos_x: position.pos_x, pos_z: position.pos_z,
      room_width: size.width, room_depth: size.depth, capacity: room.capacity, floor_id: floor.id,
      room_shape: 'rect', notch_width: 0, notch_depth: 0, notch_corner: 'ne',
    };
    setRooms(prev => [...prev, draft]);
    setSeats(prev => {
      const existing = prev.filter(seat => seat.space_id === room.id);
      return [...prev.filter(seat => seat.space_id !== room.id), ...regenerateSeats(draft, existing, draft.capacity)];
    });
    setSelectedRoomId(room.id);
    setDirty(true);
  };

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    const ok = await saveOfficeLayout({
      rooms: rooms.map(room => ({
        id: room.id,
        pos_x: room.pos_x,
        pos_z: room.pos_z,
        room_width: room.room_width,
        room_depth: room.room_depth,
        capacity: room.capacity,
        floor_id: room.floor_id,
        room_shape: room.room_shape,
        notch_width: room.notch_width,
        notch_depth: room.notch_depth,
        notch_corner: room.notch_corner,
      })),
      desks,
      seats,
    });
    setSaving(false);
    if (ok) {
      setDirty(false);
      notifySuccess('The office layout has been saved.', 'Floor plan updated');
    }
  };

  const seatCountFor = (roomId: string) => seats.filter(seat => seat.space_id === roomId).length;

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card
        title="Floor plan editor"
        subtitle="Drag a room, a chair or a desk to move it; pull a corner to resize it."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-1.5">
              <Wand2 className="h-3.5 w-3.5 text-[var(--ink-4)]" />
              <span className="text-[11px] font-medium text-[var(--ink-3)]">Snaps to {Math.round(SNAP_STEP * 100)} cm</span>
            </div>
            <Button size="sm" variant="secondary" onClick={arrange}>
              <LayoutGrid className="h-3.5 w-3.5" /> Auto arrange
            </Button>
            <Button size="sm" variant="secondary" onClick={reset} disabled={!dirty}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
              <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : dirty ? 'Save layout' : 'Saved'}
            </Button>
          </div>
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {floors.length > 1 && (
            <select
              value={floor.id}
              onChange={event => onSelectFloor(event.target.value)}
              className="ui-input h-8 w-auto text-[12px]"
              aria-label="Floor"
            >
              {floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
            </select>
          )}
          <Badge variant="neutral">{floor.name} · {floor.width} × {floor.depth} m</Badge>
          <Badge variant={dirty ? 'warning' : 'neutral'}>{dirty ? 'Unsaved changes' : 'All changes saved'}</Badge>
        </div>
        <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface-sunken)] h-[560px]">
          <Office3D
            floor={floor}
            rooms={draftRoomsAsSpaces}
            seats={draftSeatsAsSpaces}
            desks={draftDesksAsSpaces}
            takenSeatIds={[]}
            mode="editor"
            selectedRoomId={selectedRoomId}
            selectedSeatId={selectedSeatId}
            selectedDeskId={selectedDeskId}
            colorForRoom={colorForRoom}
            kindForRoom={kindForRoom}
            onSelectRoom={room => {
              setSelectedRoomId(room?.id || null);
              setSelectedSeatId(null);
              setSelectedDeskId(null);
            }}
            onSelectSeat={(seat, room) => {
              setSelectedRoomId(room.id);
              setSelectedSeatId(seat.id);
              setSelectedDeskId(null);
            }}
            onSelectDesk={(desk, room) => {
              setSelectedRoomId(room.id);
              setSelectedDeskId(desk.id);
              setSelectedSeatId(null);
            }}
            onMoveRoom={moveRoom}
            onResizeRoom={resizeRoom}
            onMoveSeat={moveSeat}
            onMoveDesk={moveDesk}
            onResizeDesk={resizeDesk}
          />
        </div>
      </Card>

      <div className="space-y-3">
        <Card title="Rooms on this floor" subtitle="Select a room to edit its size, chairs and furniture.">
          {roomsOnFloor.length === 0 && (
            <p className="text-[12px] text-[var(--ink-4)]">Nothing placed yet — add a room below.</p>
          )}
          <ul className="space-y-1.5">
            {roomsOnFloor.map(room => {
              const type = typesById.get(room.type_id);
              const isSelected = room.id === selectedRoomId;
              return (
                <li key={room.id}>
                  <button
                    type="button"
                    onClick={() => { setSelectedRoomId(room.id); setSelectedSeatId(null); setSelectedDeskId(null); }}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-control)] border px-2.5 py-1.5 text-left transition-colors ${
                      isSelected
                        ? 'border-[var(--accent)] bg-[var(--surface-muted)]'
                        : 'border-[var(--line)] bg-white hover:bg-[var(--surface-muted)]'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: type?.color || '#64748b' }} />
                      <span className="truncate text-[12px] font-semibold text-[var(--ink)]">{room.name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-[var(--ink-4)]">
                      {seatCountFor(room.id)} chairs · {desksOfRoom(room.id).length} desks
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {selectedDesk ? (
          <Card
            title={selectedDesk.label || 'Desk'}
            subtitle={`Furniture · ${roomsById.get(selectedDesk.space_id)?.name || 'Room'}`}
          >
            <div className="space-y-2">
              <div>
                <label className="ui-label mb-1 block">Label</label>
                <input
                  type="text"
                  value={selectedDesk.label ?? ''}
                  onChange={event => updateDesk(selectedDesk.id, { label: event.target.value })}
                  className="ui-input w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="ui-label mb-1 block">Width (m)</label>
                  <input
                    type="number" step="0.05" min={MIN_DESK_SIZE} value={selectedDesk.width}
                    onChange={event => resizeDesk(selectedDesk, Number(event.target.value), selectedDesk.depth)}
                    className="ui-input w-full font-mono"
                  />
                </div>
                <div>
                  <label className="ui-label mb-1 block">Depth (m)</label>
                  <input
                    type="number" step="0.05" min={MIN_DESK_SIZE} value={selectedDesk.depth}
                    onChange={event => resizeDesk(selectedDesk, selectedDesk.width, Number(event.target.value))}
                    className="ui-input w-full font-mono"
                  />
                </div>
              </div>
              <RotationControl value={selectedDesk.rotation} onChange={angle => rotateDesk(selectedDesk, angle)} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="ui-label mb-1 block">X (m)</label>
                  <input
                    type="number" step="0.25" value={selectedDesk.x}
                    onChange={event => moveDesk(selectedDesk, Number(event.target.value), selectedDesk.z)}
                    className="ui-input w-full font-mono"
                  />
                </div>
                <div>
                  <label className="ui-label mb-1 block">Z (m)</label>
                  <input
                    type="number" step="0.25" value={selectedDesk.z}
                    onChange={event => moveDesk(selectedDesk, selectedDesk.x, Number(event.target.value))}
                    className="ui-input w-full font-mono"
                  />
                </div>
              </div>
              <Button size="sm" variant="secondary" className="w-full" onClick={() => removeDesk(selectedDesk.id)}>
                <Trash2 className="h-3.5 w-3.5" /> Remove this desk
              </Button>
            </div>
          </Card>
        ) : selectedSeat ? (
          <Card title="Chair" subtitle={seatLabel(selectedSeat, seats.filter(seat => seat.space_id === selectedSeat.space_id).findIndex(seat => seat.id === selectedSeat.id))}>
            <div className="space-y-2">
              <div>
                <label className="ui-label mb-1 block">Label</label>
                <input
                  type="text"
                  value={selectedSeat.label ?? ''}
                  onChange={event => {
                    const value = event.target.value;
                    setSeats(prev => prev.map(entry => (entry.id === selectedSeat.id ? { ...entry, label: value } : entry)));
                    setDirty(true);
                  }}
                  className="ui-input w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="ui-label mb-1 block">X (m)</label>
                  <input
                    type="number" step="0.25" value={selectedSeat.x}
                    onChange={event => moveSeat(selectedSeat, Number(event.target.value), selectedSeat.z)}
                    className="ui-input w-full font-mono"
                  />
                </div>
                <div>
                  <label className="ui-label mb-1 block">Z (m)</label>
                  <input
                    type="number" step="0.25" value={selectedSeat.z}
                    onChange={event => moveSeat(selectedSeat, selectedSeat.x, Number(event.target.value))}
                    className="ui-input w-full font-mono"
                  />
                </div>
              </div>
              <RotationControl value={selectedSeat.rotation} onChange={angle => rotateSeat(selectedSeat, angle)} />
              <Button size="sm" variant="secondary" className="w-full" onClick={() => removeSeat(selectedSeat.id)}>
                <Trash2 className="h-3.5 w-3.5" /> Remove this chair
              </Button>
            </div>
          </Card>
        ) : selectedRoom ? (
          <Card title={selectedRoom.name} subtitle={typesById.get(selectedRoom.type_id)?.name || 'Room'}>
            <div className="space-y-2">
              <div>
                <label className="ui-label mb-1 block">Shape</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {([['rect', 'Rectangle'], ['l', 'L-shaped']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => updateRoom(selectedRoom.id, {
                        room_shape: value as RoomShape,
                        // A first L needs a sensible notch, or it would look untouched.
                        ...(value === 'l' && !rooms.find(entry => entry.id === selectedRoom.id)?.notch_width
                          ? {
                            notch_width: Math.round(Math.max((selectedRoom.room_width ?? 4) * 0.38, 1.5) * 4) / 4,
                            notch_depth: Math.round(Math.max((selectedRoom.room_depth ?? 3.5) * 0.42, 1.5) * 4) / 4,
                          }
                          : {}),
                      })}
                      className={`cursor-pointer rounded-[var(--radius-control)] border px-2 py-1 text-[11.5px] font-medium transition-colors ${
                        (rooms.find(entry => entry.id === selectedRoom.id)?.room_shape || 'rect') === value
                          ? 'border-[var(--accent)] bg-[var(--surface-muted)] font-semibold text-[var(--ink)]'
                          : 'border-[var(--line)] bg-white text-[var(--ink-3)] hover:bg-[var(--surface-muted)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="ui-label mb-1 block">Width (m)</label>
                  <input
                    type="number" step="0.25" min="1.4" value={selectedRoom.room_width || ''}
                    onChange={event => updateRoom(selectedRoom.id, { room_width: Math.max(1.4, Number(event.target.value) || 1.4) })}
                    className="ui-input w-full font-mono"
                  />
                </div>
                <div>
                  <label className="ui-label mb-1 block">Depth (m)</label>
                  <input
                    type="number" step="0.25" min="1.4" value={selectedRoom.room_depth || ''}
                    onChange={event => updateRoom(selectedRoom.id, { room_depth: Math.max(1.4, Number(event.target.value) || 1.4) })}
                    className="ui-input w-full font-mono"
                  />
                </div>
              </div>
              {(rooms.find(entry => entry.id === selectedRoom.id)?.room_shape === 'l') && (
                <div className="space-y-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-muted)] p-2">
                  <p className="ui-label">Missing corner</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(['nw', 'ne', 'sw', 'se'] as RoomCornerName[]).map(corner => (
                      <button
                        key={corner}
                        type="button"
                        onClick={() => updateRoom(selectedRoom.id, { notch_corner: corner })}
                        className={`cursor-pointer rounded-[var(--radius-control)] border px-1 py-1 font-mono text-[11px] uppercase transition-colors ${
                          (rooms.find(entry => entry.id === selectedRoom.id)?.notch_corner || 'ne') === corner
                            ? 'border-[var(--accent)] bg-white font-semibold text-[var(--ink)]'
                            : 'border-[var(--line)] bg-white text-[var(--ink-3)] hover:bg-[var(--surface-muted)]'
                        }`}
                      >
                        {corner}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="ui-label mb-1 block">Notch width</label>
                      <input
                        type="number" step="0.25" min="0" value={rooms.find(entry => entry.id === selectedRoom.id)?.notch_width ?? 0}
                        onChange={event => updateRoom(selectedRoom.id, { notch_width: Math.max(0, Number(event.target.value) || 0) })}
                        className="ui-input w-full font-mono"
                      />
                    </div>
                    <div>
                      <label className="ui-label mb-1 block">Notch depth</label>
                      <input
                        type="number" step="0.25" min="0" value={rooms.find(entry => entry.id === selectedRoom.id)?.notch_depth ?? 0}
                        onChange={event => updateRoom(selectedRoom.id, { notch_depth: Math.max(0, Number(event.target.value) || 0) })}
                        className="ui-input w-full font-mono"
                      />
                    </div>
                  </div>
                  <p className="ui-meta">
                    The cut is {roomNotch(selectedRoom).width.toFixed(2)} × {roomNotch(selectedRoom).depth.toFixed(2)} m,
                    leaving at least a metre of room either side.
                  </p>
                </div>
              )}

              <div>
                <label className="ui-label mb-1 block">Capacity</label>
                <input
                  type="number" min="1" max="80" value={selectedRoom.capacity || 1}
                  onChange={event => setCapacity(selectedRoom, Number(event.target.value))}
                  className="ui-input w-full font-mono"
                />
                <p className="ui-meta mt-1">
                  {seatCountFor(selectedRoom.id)} chair{seatCountFor(selectedRoom.id) === 1 ? '' : 's'} placed — capacity follows the chairs.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="secondary" onClick={() => addSeat(selectedRoom)}>
                  <Plus className="h-3.5 w-3.5" /> Chair
                </Button>
                <Button size="sm" variant="secondary" onClick={() => regenerateRoomSeats(selectedRoom)}>
                  <Redo2 className="h-3.5 w-3.5" /> Re-lay chairs
                </Button>
              </div>

              <div className="border-t border-[var(--line)] pt-2">
                <p className="ui-label mb-1.5">Furniture · {desksOfRoom(selectedRoom.id).length} desk{desksOfRoom(selectedRoom.id).length === 1 ? '' : 's'}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="secondary" onClick={() => addDesk(selectedRoom)}>
                    <RectangleHorizontal className="h-3.5 w-3.5" /> Desk
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => addDeskRow(selectedRoom)}>
                    <Rows3 className="h-3.5 w-3.5" /> Desk row
                  </Button>
                </div>
                {desksOfRoom(selectedRoom.id).length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {desksOfRoom(selectedRoom.id).map(desk => (
                      <li key={desk.id}>
                        <button
                          type="button"
                          onClick={() => { setSelectedDeskId(desk.id); setSelectedSeatId(null); }}
                          className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-control)] border px-2 py-1 text-left transition-colors ${
                            desk.id === selectedDeskId
                              ? 'border-[var(--accent)] bg-[var(--surface-muted)]'
                              : 'border-[var(--line)] bg-white hover:bg-[var(--surface-muted)]'
                          }`}
                        >
                          <span className="truncate text-[11.5px] font-medium text-[var(--ink-2)]">{desk.label || 'Desk'}</span>
                          <span className="shrink-0 font-mono text-[10px] text-[var(--ink-4)]">
                            {desk.width.toFixed(2)} × {desk.depth.toFixed(2)} m
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        ) : (
          <Card title="Nothing selected" subtitle="Click a room, a chair or a desk in the plan.">
            <p className="text-[12px] text-[var(--ink-4)]">
              Everything snaps to a 25 cm grid. Chairs and desks stay inside their room, even when the
              walls move, and a room shrinks its furniture back in with it.
            </p>
          </Card>
        )}

        {unplaced.length > 0 && (
          <Card title="Not on the plan" subtitle="These rooms exist but are not placed on this floor.">
            <ul className="space-y-1.5">
              {unplaced.map(room => (
                <li key={room.id} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Armchair className="h-3.5 w-3.5 shrink-0 text-[var(--ink-4)]" />
                    <span className="truncate text-[12px] font-medium text-[var(--ink-2)]">{room.name}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => addRoomToFloor(room)}>
                    <Plus className="h-3.5 w-3.5" /> Place
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
