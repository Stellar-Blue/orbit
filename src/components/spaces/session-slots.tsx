"use client";

import React from 'react';
import { CalendarDays, Clock, Link2, Mail, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { notifySuccess } from '@/lib/validation-modal';
import {
  clockLabel, seatHolders, seatsLabel, sessionSharePath, type SpaceDayState, type SpaceSessionState,
} from '@/lib/spaces';
import type { Space, SpaceBooking, SpaceSession, SpaceSessionInvite } from '@/lib/types';

export interface SessionSlotsProps {
  space: Space;
  state: SpaceDayState;
  /** Past days and read-only states keep every action disabled. */
  disabled: boolean;
  onJoin: (session: SpaceSessionState) => void;
  onLeave: (booking: SpaceBooking) => void;
  /** Opens the booking dialog with a blank window so the first seat creates the session. */
  onOpen: () => void;
  /** Whether this viewer may remove the session (the person who opened it, or an admin). */
  canDelete?: (session: SpaceSession) => boolean;
  onDelete?: (session: SpaceSession) => void;
  /** Everyone invited to the day's sessions, so each row can name them. */
  invites?: SpaceSessionInvite[];
  /** Whether this viewer may change the session (the person who opened it, or an admin). */
  canEdit?: (session: SpaceSession) => boolean;
  onEdit?: (session: SpaceSession) => void;
  /** The session a shared link pointed at, outlined so it stands out among the day's others. */
  highlightId?: string | null;
  /** Who organised an Outlook-born session, shown after "Managed in Outlook". */
  organizerOf?: (session: SpaceSession) => string | null;
}

/** Copies the session's link; a browser that refuses the clipboard shows it to copy by hand. */
const copySessionLink = (sessionId: string) => {
  const url = `${window.location.origin}${sessionSharePath(sessionId)}`;
  navigator.clipboard.writeText(url)
    .then(() => notifySuccess('Anyone in Orbit with this link opens the session.', 'Link copied'))
    .catch(() => window.prompt('Copy this link to share the session', url));
};

/** `Ana`, or the address itself when the guest has no Orbit profile. */
const inviteLabel = (invite: SpaceSessionInvite): string => {
  const name = invite.name
    || [invite.profile?.first_name, invite.profile?.last_name].filter(Boolean).join(' ').trim();
  return name ? name.split(' ')[0] : invite.email;
};

/**
 * The day's sessions of one timed room. A conference room holds several meetings in a day, each with
 * its own window and its own seats, so the card lists them instead of showing a single state.
 */
export function SessionSlots({
  space, state, disabled, onJoin, onLeave, onOpen, canDelete, onDelete, invites, canEdit, onEdit, highlightId,
  organizerOf,
}: SessionSlotsProps) {
  if (state.sessions.length === 0) {
    return (
      <div className="rounded-[var(--radius-control)] border border-dashed border-[var(--line-strong)] px-2.5 py-2">
        <p className="text-[11.5px] font-medium text-[var(--ink-3)]">
          No session yet — open the first one and the team joins it.
        </p>
        <Button size="sm" variant="primary" className="w-full mt-2" onClick={onOpen} disabled={disabled}>
          <Plus className="w-3.5 h-3.5" /> Open a session
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1.5">
        {state.sessions.map(entry => {
          const mine = Boolean(entry.myBooking);
          const holders = seatHolders(entry.bookings);
          const invited = (invites || []).filter(invite => invite.session_id === entry.session.id);
          const organizer = entry.session.source === 'outlook' ? organizerOf?.(entry.session) : null;
          return (
            <li
              key={entry.session.id}
              className={`rounded-[var(--radius-control)] border px-2.5 py-1.5 ${
                mine ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-[var(--surface-muted)]'
              } ${entry.ended ? 'opacity-60' : ''} ${
                highlightId === entry.session.id ? 'ring-2 ring-[var(--accent)] ring-offset-1' : ''
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-[12px] font-semibold text-[var(--ink)]">
                  <span className="font-mono">{clockLabel(entry.session.starts_at)} – {clockLabel(entry.session.ends_at)}</span>
                  {entry.session.title && (
                    <span className="font-medium text-[var(--ink-2)]"> · {entry.session.title}</span>
                  )}
                </p>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="ui-meta">{seatsLabel(entry, space.capacity)}</span>
                  <button
                    type="button"
                    onClick={() => copySessionLink(entry.session.id)}
                    className="cursor-pointer rounded p-0.5 text-[var(--ink-4)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--accent-ink)]"
                    title="Copy a link to this session"
                    aria-label={`Copy a link to the ${clockLabel(entry.session.starts_at)} session`}
                  >
                    <Link2 className="w-3 h-3" />
                  </button>
                  {onEdit && !disabled && canEdit?.(entry.session) && (
                    <button
                      type="button"
                      onClick={() => onEdit(entry.session)}
                      className="cursor-pointer rounded p-0.5 text-[var(--ink-4)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--accent-ink)]"
                      title="Edit this session, its time and the people invited"
                      aria-label={`Edit the ${clockLabel(entry.session.starts_at)} session`}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  {onDelete && canDelete?.(entry.session) && (
                    <button
                      type="button"
                      onClick={() => onDelete(entry.session)}
                      className="cursor-pointer rounded p-0.5 text-[var(--ink-4)] transition-colors hover:bg-rose-50 hover:text-rose-700"
                      title="Delete this session and release its seats"
                      aria-label={`Delete the ${clockLabel(entry.session.starts_at)} session`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </span>
              </div>
              {entry.session.source === 'outlook' && (
                <p className="mt-0.5 ui-meta">
                  <CalendarDays className="w-3 h-3 inline mr-1 -mt-0.5" />
                  Managed in Outlook{organizer ? ` · ${organizer}` : ''}
                </p>
              )}
              {entry.session.description && (
                <p className="mt-0.5 min-w-0 truncate ui-meta" title={entry.session.description}>
                  {entry.session.description}
                </p>
              )}
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate ui-meta" title={holders.join(', ')}>
                  <Users className="w-3 h-3 inline mr-1 -mt-0.5" />
                  {holders.length > 0 ? holders.join(', ') : 'Nobody booked yet'}
                </p>
                {mine ? (
                  <button
                    type="button"
                    onClick={() => onLeave(entry.myBooking!)}
                    className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer"
                  >
                    <X className="w-3 h-3" /> Release
                  </button>
                ) : entry.full ? (
                  <span className="shrink-0 text-[11px] font-semibold text-rose-600">Full</span>
                ) : entry.ended ? (
                  <span className="shrink-0 text-[11px] font-semibold text-[var(--ink-4)]">Ended</span>
                ) : (
                  <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onJoin(entry)}>
                    <Clock className="w-3 h-3" /> Join
                  </Button>
                )}
              </div>
              {invited.length > 0 && (
                <p className="mt-0.5 min-w-0 truncate ui-meta" title={invited.map(invite => invite.name || invite.email).join(', ')}>
                  <Mail className="w-3 h-3 inline mr-1 -mt-0.5" />
                  Invited: {invited.map(inviteLabel).join(', ')}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="w-full rounded-[var(--radius-control)] px-2 py-1 text-[11px] font-semibold text-[var(--accent-ink)] hover:bg-[var(--surface-muted)] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
      >
        <Plus className="w-3 h-3 inline mr-1 -mt-0.5" /> New session
      </button>
    </div>
  );
}
