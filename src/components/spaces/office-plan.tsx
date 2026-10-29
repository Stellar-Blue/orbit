"use client";

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Building2, MousePointerClick } from 'lucide-react';
import { Card } from '@/components/ui/primitives';
import type { OfficeFloor, Space, SpaceDesk, SpaceSeat, SpaceType } from '@/lib/types';
import type { Office3DProps, SeatPerson } from '@/components/spaces/office-3d';

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

export interface OfficePlanProps {
  floor: OfficeFloor;
  rooms: Space[];
  seats: SpaceSeat[];
  desks?: SpaceDesk[];
  typesById: Map<string, SpaceType>;
  takenSeatIds: string[];
  mySeatIds?: string[];
  /** Who holds each chair, drawn above it as a round picture. */
  seatPeople?: SeatPerson[];
  /** Which session the timed rooms are showing, so the taken chairs are not mistaken for the whole day. */
  sessionNote?: string | null;
  onPickSeat: (seat: SpaceSeat, room: Space) => void;
  /** Clicking a room itself (its floor, walls or empty space) — timed rooms open their sessions. */
  onPickRoom?: (room: Space) => void;
  height?: number;
}

/** Chair upholstery by seat state — the same colours the plan paints on the chairs. */
const LEGEND = [
  { label: 'Free', color: '#262a30' },
  { label: 'Taken', color: '#5f7183' },
  { label: 'Your seat', color: '#4f8566' },
];

/**
 * The office as the employees see it: a read-only floor plan where clicking a chair books it.
 * Dragging orbits the camera, so a click only counts when the pointer did not move.
 */
export function OfficePlan({
  floor, rooms, seats, desks = [], typesById, takenSeatIds, mySeatIds, seatPeople = [], sessionNote, onPickSeat, onPickRoom, height = 540,
}: OfficePlanProps) {
  const colorForRoom = useMemo(
    () => (room: Space) => typesById.get(room.type_id)?.color || '#64748b',
    [typesById]
  );
  const kindForRoom = useMemo(
    () => (room: Space) => typesById.get(room.type_id)?.booking_mode ?? null,
    [typesById]
  );
  const handleSelectRoom = useMemo(
    () => (room: Space | null) => {
      if (room) onPickRoom?.(room);
    },
    [onPickRoom]
  );

  return (
    <Card
      title={`Office plan · ${floor.name}`}
      subtitle="Click a chair to take it for the day, a meeting room to see and join its sessions. Drag to orbit, scroll to zoom."
      action={
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {LEGEND.map(entry => (
            <span key={entry.label} className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-[var(--ink-3)]">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.label}
            </span>
          ))}
        </div>
      }
    >
      <div
        className="relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[#f8f4ec]"
        style={{ height }}
      >
        <Office3D
          floor={floor}
          rooms={rooms}
          seats={seats}
          desks={desks}
          takenSeatIds={takenSeatIds}
          mySeatIds={mySeatIds}
          seatPeople={seatPeople}
          mode="viewer"
          colorForRoom={colorForRoom}
          kindForRoom={kindForRoom}
          onSelectSeat={onPickSeat}
          onSelectRoom={handleSelectRoom}
        />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--ink-4)]">
        <MousePointerClick className="h-3 w-3 shrink-0" />
        A black chair is free, a blue-grey one is taken, the green one is yours — meeting rooms seat their sessions, so pick a session first.
        {sessionNote ? <span className="truncate">Showing {sessionNote}</span> : null}
      </p>
    </Card>
  );
}

/** Empty state shown when no floor has been drawn yet. */
export function OfficePlanEmpty({ isAdmin, onConfigure }: { isAdmin: boolean; onConfigure: () => void }) {
  return (
    <Card title="Office plan" subtitle="The 3D floor plan appears once a floor is drawn.">
      <div className="py-8 text-center">
        <Building2 className="mx-auto h-6 w-6 text-[var(--ink-4)]" />
        <p className="mt-2 text-[13px] font-semibold text-[var(--ink-2)]">No floor plan yet</p>
        <p className="mx-auto mt-1 max-w-md text-[12px] text-[var(--ink-4)]">
          {isAdmin
            ? 'Open Layout to draw the floor, place the rooms and drop the chairs inside them.'
            : 'An administrator has not drawn the office yet — you can still book from the room list below.'}
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={onConfigure}
            className="mt-3 cursor-pointer text-[12px] font-semibold text-[var(--accent-ink)] hover:underline"
          >
            Draw the floor plan
          </button>
        )}
      </div>
    </Card>
  );
}
