"use client";

import React, { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Armchair, Building2, LayoutGrid, Plus, Redo2, RotateCcw, Save, Trash2, Wand2,
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { notifySuccess } from '@/lib/validation-modal';
import { useAuth } from '@/lib/auth-context';
import {
  autoLayoutRooms, clampSeatToRoom, defaultRoomSize, roomSize, seatGrid, seatLabel, snap, SNAP_STEP,
} from '@/lib/office-layout';
import type { OfficeFloor, Space, SpaceSeat } from '@/lib/types';
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

const toRoomDraft = (room: Space, floorId: string): RoomDraft => {
  const { width, depth } = roomSize(room);
  return {
    id: room.id,
    pos_x: Number(room.pos_x) || 0,
    pos_z: Number(room.pos_z) || 0,
    room_width: width,
    room_depth: depth,
    capacity: room.capacity,
    floor_id: room.floor_id || floorId,
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

/** Chairs for a room: keeps the ones that exist (so bookings survive) and fills the gaps. */
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
    spaces, spaceTypes, spaceSeats, saveOfficeLayout,
  } = useAuth();

  const typesById = useMemo(() => new Map(spaceTypes.map(type => [type.id, type])), [spaceTypes]);
  const roomsById = useMemo(() => new Map(spaces.map(space => [space.id, space])), [spaces]);

  const seededRooms = useMemo(
    () => spaces.filter(space => space.floor_id === floor.id).map(space => toRoomDraft(space, floor.id)),
    [spaces, floor.id]
  );
  const seededSeats = useMemo(() => {
    const roomIds = new Set(spaces.filter(space => space.floor_id === floor.id).map(space => space.id));
    return spaceSeats.filter(seat => roomIds.has(seat.space_id)).map(toSeatDraft);
  }, [spaceSeats, spaces, floor.id]);

  const [rooms, setRooms] = useState<RoomDraft[]>(seededRooms);
  const [seats, setSeats] = useState<SeatDraft[]>(seededSeats);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Throw the draft away and re-read what has been saved. */
  const reset = () => {
    setRooms(seededRooms);
    setSeats(seededSeats);
    setSelectedRoomId(null);
    setSelectedSeatId(null);
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
        ...(draft ? { pos_x: draft.pos_x, pos_z: draft.pos_z, room_width: draft.room_width, room_depth: draft.room_depth, capacity: draft.capacity } : {}),
      };
    }),
    [roomsOnFloor, rooms]
  );

  const draftSeatsAsSpaces = useMemo<SpaceSeat[]>(() => seats.map(seat => ({ ...seat })), [seats]);

  const selectedRoom = draftRoomsAsSpaces.find(room => room.id === selectedRoomId) || null;
  const selectedSeat = seats.find(seat => seat.id === selectedSeatId) || null;

  const colorForRoom = useCallback(
    (room: Space) => typesById.get(room.type_id)?.color || '#64748b',
    [typesById]
  );

  const updateRoom = (id: string, patch: Partial<RoomDraft>) => {
    setRooms(prev => prev.map(room => (room.id === id ? { ...room, ...patch } : room)));
    setDirty(true);
  };

  const moveRoom = (room: Space, x: number, z: number) => updateRoom(room.id, { pos_x: snap(x), pos_z: snap(z) });

  const resizeRoom = (room: Space, width: number, depth: number, x: number, z: number) => updateRoom(room.id, {
    room_width: width, room_depth: depth, pos_x: x, pos_z: z,
  });

  const moveSeat = (seat: SpaceSeat, x: number, z: number) => {
    const room = rooms.find(entry => entry.id === seat.space_id);
    const position = clampSeatToRoom(room || {}, snap(x), snap(z));
    setSeats(prev => prev.map(entry => (entry.id === seat.id ? { ...entry, x: position.x, z: position.z } : entry)));
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
      return [...others, ...regenerateSeats(nextRoom, roomSeats, next)];
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
      })),
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
        subtitle="Drag a room to move it, pull a corner to resize it, drag a chair to place it."
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
            takenSeatIds={[]}
            mode="editor"
            selectedRoomId={selectedRoomId}
            selectedSeatId={selectedSeatId}
            colorForRoom={colorForRoom}
            onSelectRoom={room => {
              setSelectedRoomId(room?.id || null);
              setSelectedSeatId(null);
            }}
            onSelectSeat={(seat, room) => {
              setSelectedRoomId(room.id);
              setSelectedSeatId(seat.id);
            }}
            onMoveRoom={moveRoom}
            onResizeRoom={resizeRoom}
            onMoveSeat={moveSeat}
          />
        </div>
      </Card>

      <div className="space-y-3">
        <Card title="Rooms on this floor" subtitle="Select a room to edit its size and chairs.">
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
                    onClick={() => { setSelectedRoomId(room.id); setSelectedSeatId(null); }}
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
                    <span className="shrink-0 font-mono text-[10.5px] text-[var(--ink-4)]">{seatCountFor(room.id)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {selectedSeat ? (
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
              <Button size="sm" variant="secondary" className="w-full" onClick={() => removeSeat(selectedSeat.id)}>
                <Trash2 className="h-3.5 w-3.5" /> Remove this chair
              </Button>
            </div>
          </Card>
        ) : selectedRoom ? (
          <Card title={selectedRoom.name} subtitle={typesById.get(selectedRoom.type_id)?.name || 'Room'}>
            <div className="space-y-2">
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
                  <Redo2 className="h-3.5 w-3.5" /> Re-lay
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card title="Nothing selected" subtitle="Click a room or a chair in the plan.">
            <p className="text-[12px] text-[var(--ink-4)]">
              Rooms snap to a 25 cm grid. Chairs stay inside their room, even when the walls move.
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
