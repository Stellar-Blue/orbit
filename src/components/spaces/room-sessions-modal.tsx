"use client";

import React from 'react';
import { Clock, MapPin, Users } from 'lucide-react';
import { Modal } from '@/components/ui/primitives';
import { SessionSlots } from '@/components/spaces/session-slots';
import type { SpaceDayState, SpaceSessionState } from '@/lib/spaces';
import type { Space, SpaceBooking, SpaceSession, SpaceSessionInvite, SpaceType } from '@/lib/types';

export interface RoomSessionsModalProps {
  /** The room to show, or null to keep the dialog closed. */
  room: Space | null;
  type?: SpaceType;
  state?: SpaceDayState;
  /** `Friday 30 October` — the day the sessions belong to. */
  dayLabel: string;
  isPast: boolean;
  onClose: () => void;
  onJoin: (session: SpaceSessionState) => void;
  onLeave: (booking: SpaceBooking) => void;
  onNew: () => void;
  canDelete?: (session: SpaceSession) => boolean;
  onDelete?: (session: SpaceSession) => void;
  /** Everyone invited to the room's sessions on this day. */
  invites?: SpaceSessionInvite[];
  /** Whether this viewer may change a session — its time, title, agenda and invitees. */
  canEdit?: (session: SpaceSession) => boolean;
  onEdit?: (session: SpaceSession) => void;
  /** The session a shared link pointed at. */
  highlightId?: string | null;
}

/**
 * A meeting room's day: every session with its window, title and seats, and the way to open another
 * one. Opened by clicking the room on the floor plan or its name on the card, so the employee can
 * look before booking rather than guessing from the room's state.
 */
export function RoomSessionsModal({
  room, type, state, dayLabel, isPast, onClose, onJoin, onLeave, onNew, canDelete, onDelete,
  invites, canEdit, onEdit, highlightId,
}: RoomSessionsModalProps) {
  if (!room || !state) return null;
  return (
    <Modal isOpen onClose={onClose} title={room.name} eyebrow={`Sessions · ${dayLabel}`} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--ink-3)]">
          {type && (
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: type.color }} />
              {type.name}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3 w-3" />
            {room.capacity} seat{room.capacity === 1 ? '' : 's'} per session
          </span>
          {room.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3 w-3" />
              {room.location}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            {state.sessions.length} session{state.sessions.length === 1 ? '' : 's'} on this day
          </span>
        </div>

        <SessionSlots
          space={room}
          state={state}
          disabled={isPast}
          onJoin={onJoin}
          onLeave={onLeave}
          onOpen={onNew}
          canDelete={canDelete}
          onDelete={onDelete}
          invites={invites}
          canEdit={canEdit}
          onEdit={onEdit}
          highlightId={highlightId}
        />

        {isPast && (
          <p className="text-[11px] text-[var(--ink-4)]">
            This day is over — pick today or a later date to join a session.
          </p>
        )}
      </div>
    </Modal>
  );
}
