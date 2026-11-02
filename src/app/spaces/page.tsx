"use client";

import React, { useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import {
  CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, DoorOpen, Grid2x2, LayoutGrid, MapPin, Users, X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Badge, Button, Card, Modal } from '@/components/ui/primitives';
import { DatePicker } from '@/components/ui/date-picker';
import { formatDate } from '@/lib/date';
import { notifySuccess, notifyValidation } from '@/lib/validation-modal';
import { SpacesManager } from '@/components/spaces/spaces-manager';
import { OfficePlan, OfficePlanEmpty } from '@/components/spaces/office-plan';
import { OfficeLayoutEditor } from '@/components/spaces/office-layout-editor';
import { SessionSlots } from '@/components/spaces/session-slots';
import { RoomSessionsModal } from '@/components/spaces/room-sessions-modal';
import { SessionInviteFields } from '@/components/spaces/session-invite-fields';
import { SessionEditModal } from '@/components/spaces/session-edit-modal';
import {
  BOOKING_MODE_LABELS, canDeleteSession, canEditSession, clockLabel, defaultPlanSession, heldWholeDaySpace,
  nextFreeSessionWindow, overlappingSession, seatHolders, seatsLabel, sessionLabel, sessionStarted, spaceDayState,
  summarizeInviteDelivery, validateSessionWindow, wholeDayHeldOn,
  type SpaceDayState, type SpaceSessionState,
} from '@/lib/spaces';
import { seatLabel as seatName } from '@/lib/office-layout';
import type {
  Profile, Space, SpaceBooking, SpaceSeat, SpaceSession, SpaceType,
} from '@/lib/types';
import type { SeatPerson, SessionBoard } from '@/components/spaces/office-3d';

const todayKey = () => format(new Date(), 'yyyy-MM-dd');

const personName = (profile?: Profile) =>
  profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.work_email : 'Colleague';

interface BookingDraft {
  space: Space;
  type: SpaceType;
  state: SpaceDayState;
  attendeeId: string;
  seatId: string | null;
  /** The session being joined; null means the dialog opens a new one from `startsAt`/`endsAt`. */
  sessionId: string | null;
  startsAt: string;
  endsAt: string;
  title: string;
  description: string;
  note: string;
  /** Guests invited as part of opening the session — only for a session this dialog creates. */
  inviteEmails: string[];
  /** Put the meeting on everyone's Outlook calendar, next to the Slack message. */
  includeOutlook: boolean;
}

/**
 * Spaces — declare rooms (admins) and book a seat in them.
 *
 * Whole-day spaces (desks) take up to `capacity` seats for the date. Timed spaces (conference rooms,
 * pods) open a session when the first person books; everyone else joins it until it is full. The
 * database enforces capacity, so a full room fails with the message the trigger raises.
 */
export default function SpacesPage() {
  const {
    currentUser, profiles, spaceTypes, spaces, spaceSessions, spaceBookings, spaceSessionInvites,
    officeFloors, spaceSeats, spaceDesks, bookSpaceSeat, cancelSpaceBooking, deleteSpaceSession,
    inviteToSpaceSession, removeSpaceSessionInvite, updateSpaceSession,
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';
  /** Admins get the room/type configuration as a second view here instead of a Settings tab. */
  const [view, setView] = useState<'book' | 'manage' | 'layout'>('book');
  const [day, setDay] = useState<string>(todayKey());
  /** Which session each meeting room shows in the 3D plan; an unset room leads with current/next. */
  const [planSessionView, setPlanSessionView] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  /** The timed room whose day is open in the sessions dialog. */
  const [roomModalId, setRoomModalId] = useState<string | null>(null);
  /** The session being edited, with the room it belongs to. */
  const [editTarget, setEditTarget] = useState<{ session: SpaceSession; space: Space } | null>(null);
  const [saving, setSaving] = useState(false);

  const today = todayKey();
  const isPast = day < today;

  /** Changing the day clears the 3D session picks: a session id belongs to one date. */
  const pickDay = (next: string) => {
    setDay(next);
    setPlanSessionView({});
  };

  const activeTypes = useMemo(
    () => spaceTypes.filter(type => type.active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [spaceTypes]
  );
  const activeSpaces = useMemo(
    () => spaces.filter(space => space.active).sort((a, b) => a.name.localeCompare(b.name)),
    [spaces]
  );
  const typesById = useMemo(() => new Map(activeTypes.map(type => [type.id, type])), [activeTypes]);

  const states = useMemo(() => {
    const map = new Map<string, SpaceDayState>();
    activeSpaces.forEach(space => {
      const type = typesById.get(space.type_id);
      if (!type) return;
      map.set(space.id, spaceDayState({
        space, type, date: day, sessions: spaceSessions, bookings: spaceBookings, profileId: currentUser.id,
      }));
    });
    return map;
  }, [activeSpaces, typesById, day, spaceSessions, spaceBookings, currentUser.id]);

  const spacesByType = useMemo(
    () => activeTypes
      .map(type => ({ type, rooms: activeSpaces.filter(space => space.type_id === type.id) }))
      .filter(group => group.rooms.length > 0),
    [activeTypes, activeSpaces]
  );

  // Every booking of the day counts here, whichever session of the room it belongs to.
  const seatsToday = useMemo(() => {
    const bookable = new Set(activeSpaces.map(space => space.id));
    const taken = spaceBookings.filter(
      booking => booking.booking_date === day && bookable.has(booking.space_id)
    ).length;
    const capacity = activeSpaces.reduce((sum, space) => sum + space.capacity, 0);
    return { taken, capacity };
  }, [spaceBookings, day, activeSpaces]);

  // The whole-day seat leads the summary card: joining sessions never hides where you sit all day.
  const mySeat = useMemo(() => {
    const entries = [...states.entries()].filter(([, state]) => Boolean(state.myBooking));
    if (entries.length === 0) return null;
    const spaceId = heldWholeDaySpace(states) ?? entries[0][0];
    const state = states.get(spaceId);
    return state ? { space: activeSpaces.find(space => space.id === spaceId), state } : null;
  }, [states, activeSpaces]);

  /** A whole-day space takes a person's whole day, so only one of them can be held per date. */
  const wholeDaySeat = useMemo(() => {
    const spaceId = heldWholeDaySpace(states);
    const state = spaceId ? states.get(spaceId) : undefined;
    const space = spaceId ? activeSpaces.find(entry => entry.id === spaceId) : undefined;
    return space && state ? { space, state } : null;
  }, [states, activeSpaces]);

  const myUpcoming = useMemo(
    () => spaceBookings
      .filter(booking => booking.profile_id === currentUser.id && booking.booking_date >= today)
      .sort((a, b) => a.booking_date.localeCompare(b.booking_date)),
    [spaceBookings, currentUser.id, today]
  );

  const planFloor = useMemo(() => {
    const sorted = [...officeFloors].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    return sorted.find(floor => activeSpaces.some(space => space.floor_id === floor.id)) || sorted[0] || null;
  }, [officeFloors, activeSpaces]);

  const planRooms = useMemo(
    () => (planFloor ? activeSpaces.filter(space => space.floor_id === planFloor.id) : []),
    [activeSpaces, planFloor]
  );

  const planRoomIds = useMemo(() => new Set(planRooms.map(room => room.id)), [planRooms]);

  const planSeats = useMemo(
    () => spaceSeats.filter(seat => seat.active && planRoomIds.has(seat.space_id)),
    [spaceSeats, planRoomIds]
  );

  const planDesks = useMemo(
    () => spaceDesks.filter(desk => desk.active && planRoomIds.has(desk.space_id)),
    [spaceDesks, planRoomIds]
  );

  /**
   * The session each meeting room shows in the 3D plan. Picking one on the room's table wins;
   * otherwise the room opens on the meeting running now, else the next one to start.
   */
  const planSessions = useMemo(() => {
    const map = new Map<string, SpaceSessionState>();
    states.forEach((state, roomId) => {
      if (state.mode !== 'time_range') return;
      const chosenId = planSessionView[roomId];
      const chosen = chosenId ? state.sessions.find(entry => entry.session.id === chosenId) : undefined;
      const shown = chosen ?? defaultPlanSession(state.sessions);
      if (shown) map.set(roomId, shown);
    });
    return map;
  }, [states, planSessionView]);

  // A timed room shows the chairs of the session it is displaying, so a chair booked for the 10:00
  // meeting does not look taken for the 14:00 one.
  const planSeatMarks = useMemo(() => {
    const taken: string[] = [];
    const mine: string[] = [];
    const people: SeatPerson[] = [];
    spaceBookings.forEach(booking => {
      if (booking.booking_date !== day || !booking.seat_id || !planRoomIds.has(booking.space_id)) return;
      const state = states.get(booking.space_id);
      if (!state) return;
      if (state.mode === 'time_range') {
        const shown = planSessions.get(booking.space_id);
        if (!shown || booking.session_id !== shown.session.id) return;
      }
      taken.push(booking.seat_id);
      if (booking.profile_id === currentUser.id) mine.push(booking.seat_id);
      people.push({
        seatId: booking.seat_id,
        name: personName(booking.profile),
        photoUrl: booking.profile?.photo_url ?? null,
      });
    });
    return { taken, mine, people };
  }, [spaceBookings, day, planRoomIds, states, planSessions, currentUser.id]);

  const planSessionNote = useMemo(() => {
    const lines = planRooms
      .map(room => ({ room, session: planSessions.get(room.id) }))
      .filter(entry => entry.session)
      .map(({ room, session }) => `${room.name}: ${sessionLabel(session!.session)}`);
    return lines.length > 0 ? lines.join(' · ') : null;
  }, [planRooms, planSessions]);

  /** The tables that stand beside the meeting rooms, one row per session of the day. */
  const planSessionBoards = useMemo(() => planRooms
    .map(room => {
      const state = states.get(room.id);
      if (!state || state.mode !== 'time_range' || state.sessions.length === 0) return null;
      const shown = planSessions.get(room.id);
      const board: SessionBoard = {
        roomId: room.id,
        heading: `Sessions · ${formatDate(day)}`,
        rows: state.sessions.map(entry => ({
          id: entry.session.id,
          window: `${clockLabel(entry.session.starts_at)} – ${clockLabel(entry.session.ends_at)}`,
          title: entry.session.title,
          seats: entry.seatsTaken,
          capacity: room.capacity,
          selected: shown?.session.id === entry.session.id,
          live: sessionStarted(entry.session) && !entry.ended,
          ended: entry.ended,
        })),
      };
      return board;
    })
    .filter((board): board is SessionBoard => Boolean(board)),
  [planRooms, states, planSessions, day]);

  const roomModal = roomModalId
    ? activeSpaces.find(space => space.id === roomModalId) ?? null
    : null;
  const roomModalState = roomModal ? states.get(roomModal.id) : undefined;

  /** Clicking a meeting room — on the plan or on its name — opens its day, sessions included. */
  const openRoomSessions = (room: Space) => {
    const state = states.get(room.id);
    if (!state || state.mode !== 'time_range') return;
    setRoomModalId(room.id);
  };

  /** A whole-day booking already held by this person on this date, in another space. */
  const wholeDayHeldBy = (profileId: string, exceptSpaceId?: string): SpaceBooking | null =>
    wholeDayHeldOn(spaceBookings, profileId, day, exceptSpaceId);

  const pickSeat = (seat: SpaceSeat, room: Space) => {
    const state = states.get(room.id);
    // Meeting-room chairs belong to sessions, so they are never picked one by one — the room is.
    if (!state || state.mode === 'time_range') return;
    if (isPast) {
      alert('You cannot book a seat on a past day.');
      return;
    }
    if (state.myBooking) {
      alert(`You already hold a seat in ${room.name} on ${formatDate(day)}.`);
      return;
    }
    if (wholeDayHeldBy(currentUser.id, room.id)) {
      alert(
        `A whole-day space takes one seat per day and you already hold one in ${wholeDaySeat?.space.name || 'another workspace'} `
        + `on ${formatDate(day)} — release it first.`
      );
      return;
    }
    if (state.full) {
      alert(`${room.name} is fully booked on ${formatDate(day)}.`);
      return;
    }
    openDraft(room, state, seat.id);
  };

  /** A seat's readable name inside its own room, for the booking summary. */
  const seatNameOf = (seatId: string | null): string | null => {
    if (!seatId) return null;
    const seat = planSeats.find(entry => entry.id === seatId);
    if (!seat) return null;
    const siblings = planSeats.filter(entry => entry.space_id === seat.space_id);
    return seatName(seat, siblings.findIndex(entry => entry.id === seat.id));
  };

  /** A meeting room hands out its own chairs: the free ones of the session, in plan order. */
  const freeChairsOf = (space: Space, session: SpaceSessionState | null): SpaceSeat[] => {
    const roomSeats = spaceSeats.filter(seat => seat.active && seat.space_id === space.id);
    const taken = new Set((session?.bookings ?? []).map(booking => booking.seat_id).filter(Boolean));
    return roomSeats.filter(seat => !taken.has(seat.id));
  };

  const chairLabelOf = (space: Space, seat: SpaceSeat): string => {
    const siblings = spaceSeats.filter(entry => entry.space_id === space.id);
    return seatName(seat, siblings.findIndex(entry => entry.id === seat.id));
  };

  const attendees = useMemo(
    () => profiles
      .filter(profile => profile.status === 'active')
      .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)),
    [profiles]
  );

  const openDraft = (
    space: Space,
    state: SpaceDayState,
    seatId: string | null = null,
    session: SpaceSessionState | null = null
  ) => {
    if (isPast) return;
    if (state.mode === 'whole_day' && !isAdmin && wholeDayHeldBy(currentUser.id, space.id)) {
      alert(
        `A whole-day space takes one seat per day and you already hold one in ${wholeDaySeat?.space.name || 'another workspace'} `
        + `on ${formatDate(day)} — release it first.`
      );
      return;
    }
    const type = typesById.get(space.type_id);
    if (!type) return;
    const focus = session ?? state.sessions.find(entry => entry.session.id === state.session?.id) ?? null;
    const window = focus
      ? { startsAt: clockLabel(focus.session.starts_at), endsAt: clockLabel(focus.session.ends_at) }
      : nextFreeSessionWindow(state.sessions.map(entry => entry.session));
    setDraft({
      space,
      type,
      state,
      attendeeId: currentUser.id,
      seatId,
      sessionId: focus?.session.id ?? null,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      title: focus?.session.title || '',
      description: focus?.session.description || '',
      note: '',
      inviteEmails: [],
      includeOutlook: false,
    });
  };

  /** Opens the dialog on a brand-new window, whatever session the room is currently showing. */
  const openNewSession = (space: Space, state: SpaceDayState) => {
    if (isPast) return;
    const type = typesById.get(space.type_id);
    if (!type) return;
    const window = nextFreeSessionWindow(state.sessions.map(entry => entry.session));
    setDraft({
      space,
      type,
      state,
      attendeeId: currentUser.id,
      seatId: null,
      sessionId: null,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      title: '',
      description: '',
      note: '',
      inviteEmails: [],
      includeOutlook: false,
    });
  };

  /** A brand-new window must be valid and must not collide with a session already in the room. */
  const windowErrorOf = (entry: BookingDraft): string | null => {
    if (entry.type.booking_mode !== 'time_range') return null;
    if (entry.sessionId) {
      const chosen = entry.state.sessions.find(item => item.session.id === entry.sessionId);
      return chosen?.ended ? 'That session is already over — pick another one.' : null;
    }
    const invalid = validateSessionWindow(entry.startsAt, entry.endsAt);
    if (invalid) return invalid;
    const clash = overlappingSession(entry.state.sessions.map(item => item.session), {
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
    });
    return clash
      ? `${entry.space.name} already has a session ${sessionLabel(clash)}. Pick a window that does not overlap.`
      : null;
  };

  const submit = async () => {
    if (!draft || saving) return;
    const windowError = windowErrorOf(draft);
    if (windowError) {
      alert(windowError);
      return;
    }
    const timed = draft.type.booking_mode === 'time_range';
    const heldElsewhere = timed ? null : wholeDayHeldBy(draft.attendeeId, draft.space.id);
    if (heldElsewhere) {
      const holder = draft.attendeeId === currentUser.id
        ? 'You'
        : personName(profiles.find(profile => profile.id === draft.attendeeId));
      const other = spaces.find(space => space.id === heldElsewhere.space_id)?.name || 'another workspace';
      alert(
        `${holder} already hold${draft.attendeeId === currentUser.id ? '' : 's'} a whole-day seat in ${other} `
        + `on ${formatDate(day)} — one whole-day seat per day.`
      );
      return;
    }
    const joining = draft.sessionId
      ? draft.state.sessions.find(entry => entry.session.id === draft.sessionId) ?? null
      : null;
    // Nobody picks a chair for a meeting: the room seats the session in one of its free chairs.
    const candidates = timed && !draft.seatId ? freeChairsOf(draft.space, joining) : [];
    setSaving(true);
    const result = await bookSpaceSeat({
      space: draft.space,
      mode: draft.type.booking_mode,
      date: day,
      profileId: draft.attendeeId,
      seatId: draft.seatId ?? null,
      seatIds: candidates.map(seat => seat.id),
      note: draft.note || undefined,
      session: timed
        ? draft.sessionId
          ? { id: draft.sessionId, startsAt: draft.startsAt, endsAt: draft.endsAt }
          : { startsAt: draft.startsAt, endsAt: draft.endsAt, title: draft.title, description: draft.description }
        : null,
    });
    if (!result.ok) {
      setSaving(false);
      alert(result.error || 'The seat could not be booked.');
      return;
    }
    const chair = result.seatId ? spaceSeats.find(seat => seat.id === result.seatId) : undefined;
    const seatLine = timed
      ? `${draft.space.name} booked for ${formatDate(day)}, ${clockLabel(draft.startsAt)} – ${clockLabel(draft.endsAt)}`
        + `${chair ? ` · ${chairLabelOf(draft.space, chair)}` : ''}.`
      : `${draft.space.name} booked for ${formatDate(day)}.`;
    // Opening a session also sends the invitations typed in the same dialog; the session id is the
    // handle they need, so nothing is delivered if the booking itself failed above.
    const invited = draft.inviteEmails.length > 0 && result.sessionId
      ? await inviteToSpaceSession({
        sessionId: result.sessionId,
        emails: draft.inviteEmails,
        includeOutlook: draft.includeOutlook,
      })
      : null;
    const inviteSummary = invited?.ok ? summarizeInviteDelivery(invited.invites || []) : null;
    const inviteChannels = inviteSummary
      ? [
        inviteSummary.slackSent > 0 ? `${inviteSummary.slackSent} on Slack` : '',
        inviteSummary.outlookSent > 0 ? `${inviteSummary.outlookSent} by Outlook` : '',
      ].filter(Boolean)
      : [];
    const inviteLine = inviteSummary
      ? ` ${inviteSummary.invited} invitation${inviteSummary.invited === 1 ? '' : 's'} sent`
        + `${inviteChannels.length > 0 ? ` (${inviteChannels.join(', ')})` : ''}`
        + `${inviteSummary.seatsBooked > 0 ? ` · ${inviteSummary.seatsBooked} seat${inviteSummary.seatsBooked === 1 ? '' : 's'} reserved` : ''}.`
      : '';
    setSaving(false);
    setDraft(null);
    if (invited && !invited.ok) {
      notifyValidation({
        type: 'warning',
        title: 'Session opened, invites failed',
        message: `${seatLine} ${invited.error || 'The invitations could not be sent.'}`,
        duration: 0,
      });
      return;
    }
    if (inviteSummary && inviteSummary.problems.length > 0) {
      notifyValidation({
        type: 'warning',
        title: 'Session opened',
        message: `${seatLine}${inviteLine}`,
        items: inviteSummary.problems.map(problem => ({ label: problem.who, value: problem.problem })),
        duration: 0,
      });
      return;
    }
    notifySuccess(
      `${seatLine}${inviteLine}`,
      draft.attendeeId === currentUser.id ? 'Seat booked' : 'Seat booked for a colleague'
    );
  };

  /** Removing a session takes its bookings with it, so the seats of that window are freed. */
  const removeSession = async (session: SpaceSession, roomName: string) => {
    const seats = spaceBookings.filter(booking => booking.session_id === session.id).length;
    const window = `${clockLabel(session.starts_at)} – ${clockLabel(session.ends_at)}${session.title ? ` (${session.title})` : ''}`;
    const released = seats > 0 ? ` and release its ${seats} seat${seats === 1 ? '' : 's'}` : '';
    if (!confirm(`Delete the ${window} session in ${roomName}${released}?`)) return;
    const ok = await deleteSpaceSession(session.id);
    if (ok) notifySuccess(`The ${window} session in ${roomName} has been deleted.`, 'Session deleted');
  };

  /** A session can be taken back by whoever opened it, or by an administrator. */
  const canDeleteThisSession = (session: SpaceSession) => canDeleteSession(session, currentUser.id, isAdmin);
  /** Editing is the same rule: the person who opened the session, or an administrator. */
  const canEditThisSession = (session: SpaceSession) => canEditSession(session, currentUser.id, isAdmin);

  const leave = async (bookingId: string, label: string) => {
    if (!confirm(`Release this seat in ${label}?`)) return;
    const ok = await cancelSpaceBooking(bookingId);
    if (ok) notifySuccess(`The seat in ${label} has been released.`, 'Seat released');
  };

  const draftSession = draft?.state.sessions.find(entry => entry.session.id === draft.sessionId) ?? null;
  /** The whole-day booking the chosen attendee already holds elsewhere — the dialog cannot save past it. */
  const draftWholeDayConflict = draft && draft.type.booking_mode === 'whole_day'
    ? wholeDayHeldOn(spaceBookings, draft.attendeeId, day, draft.space.id)
    : null;
  const draftWholeDayRoom = draftWholeDayConflict
    ? spaces.find(space => space.id === draftWholeDayConflict.space_id)?.name || 'another workspace'
    : null;
  const draftSeatTaken = Boolean(
    draft?.seatId && draftSession?.bookings.some(booking => booking.seat_id === draft.seatId)
  );
  const windowError = draft ? windowErrorOf(draft) : null;

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-150">
      {/* Header — where you are, then the day you are booking. */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 border-b border-[var(--line-strong)] pb-3">
        <div className="min-w-0">
          <p className="ui-eyebrow">Workplace · Rooms & seats</p>
          <h1 className="ui-title mt-1">Spaces</h1>
          <p className="text-[12.5px] text-[var(--ink-3)] mt-1 max-w-xl">
            Declare the rooms the company has and book a seat in them. Desks are booked for the day;
            meeting rooms run sessions and each session takes its own seats.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {view === 'book' && (
            <>
          <button
            type="button"
            onClick={() => pickDay(format(addDays(parseISO(day), -1), 'yyyy-MM-dd'))}
            title="Previous day"
            aria-label="Previous day"
            className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-white text-[var(--ink-3)] hover:bg-[var(--surface-muted)] cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <DatePicker value={day} onChange={pickDay} className="w-[150px]" />
          <button
            type="button"
            onClick={() => pickDay(format(addDays(parseISO(day), 1), 'yyyy-MM-dd'))}
            title="Next day"
            aria-label="Next day"
            className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-white text-[var(--ink-3)] hover:bg-[var(--surface-muted)] cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {day !== today && (
            <Button size="sm" variant="secondary" onClick={() => pickDay(today)}>
              Today
            </Button>
          )}
            </>
          )}
          {isAdmin && (
            <div className="ui-segmented shrink-0" role="group" aria-label="Spaces view">
              <button type="button" onClick={() => setView('book')} aria-pressed={view === 'book'}>
                <DoorOpen className="w-3 h-3" /> Book a seat
              </button>
              <button type="button" onClick={() => setView('layout')} aria-pressed={view === 'layout'}>
                <LayoutGrid className="w-3 h-3" /> Layout
              </button>
              <button type="button" onClick={() => setView('manage')} aria-pressed={view === 'manage'}>
                <Grid2x2 className="w-3 h-3" /> Rooms &amp; types
              </button>
            </div>
          )}
        </div>
      </div>

      {view === 'layout' && isAdmin ? (
        <OfficeLayoutEditor />
      ) : view === 'manage' && isAdmin ? (
        <SpacesManager />
      ) : (
        <>
      {/* Day summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="ui-label">Seats booked · {formatDate(day)}</p>
          <p className="ui-num text-[22px] font-semibold text-[var(--ink)] mt-1.5 leading-none">
            {seatsToday.taken} <span className="text-[13px] font-medium text-[var(--ink-4)]">/ {seatsToday.capacity}</span>
          </p>
          <p className="ui-meta mt-1.5">Across {activeSpaces.length} bookable space{activeSpaces.length === 1 ? '' : 's'}</p>
        </Card>
        <Card>
          <p className="ui-label">Your seat</p>
          <p className="text-[15px] font-semibold text-[var(--ink)] mt-1.5 leading-tight">
            {mySeat ? mySeat.space?.name : 'Not booked yet'}
          </p>
          <p className="ui-meta mt-1.5">
            {mySeat?.state.session ? sessionLabel(mySeat.state.session) : mySeat ? 'Whole day' : `Nothing reserved for ${formatDate(day)}`}
          </p>
        </Card>
        <Card>
          <p className="ui-label">Upcoming bookings</p>
          <p className="ui-num text-[22px] font-semibold text-[var(--ink)] mt-1.5 leading-none">{myUpcoming.length}</p>
          <p className="ui-meta mt-1.5">From today onwards — release one below any time</p>
        </Card>
      </div>

      {isPast && (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-900">
          <CalendarDays className="w-3.5 h-3.5 shrink-0" />
          You are looking at a past day — pick today or a future date to book a seat.
        </div>
      )}

      {planFloor && planRooms.length > 0 ? (
        <OfficePlan
          floor={planFloor}
          rooms={planRooms}
          seats={planSeats}
          desks={planDesks}
          typesById={typesById}
          takenSeatIds={planSeatMarks.taken}
          mySeatIds={planSeatMarks.mine}
          seatPeople={planSeatMarks.people}
          sessionNote={planSessionNote}
          sessionBoards={planSessionBoards}
          onSelectSession={(room, sessionId) => setPlanSessionView(previous => ({ ...previous, [room.id]: sessionId }))}
          onPickSeat={pickSeat}
          onPickRoom={openRoomSessions}
        />
      ) : (
        spacesByType.length > 0 && <OfficePlanEmpty isAdmin={isAdmin} onConfigure={() => setView('layout')} />
      )}

      {spacesByType.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <DoorOpen className="w-6 h-6 text-[var(--ink-4)] mx-auto" />
            <p className="text-[13px] font-semibold text-[var(--ink-2)] mt-2">No rooms declared yet</p>
            <p className="text-[12px] text-[var(--ink-4)] mt-1">
              {isAdmin
                ? 'Add room types and rooms in Settings → Spaces to start taking bookings.'
                : 'An administrator has not declared any bookable rooms yet.'}
            </p>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setView('manage')}
                className="mt-3 text-[12px] font-semibold text-[var(--accent-ink)] hover:underline cursor-pointer"
              >
                Declare the first room
              </button>
            )}
          </div>
        </Card>
      ) : (
        spacesByType.map(({ type, rooms }) => (
          <section key={type.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: type.color }} />
              <h2 className="ui-section-title">{type.name}</h2>
              <span className="text-[11px] text-[var(--ink-4)]">
                {BOOKING_MODE_LABELS[type.booking_mode].label} · {type.booking_mode === 'whole_day'
                  ? 'one seat for the day'
                  : 'the room runs sessions, each with its own seats'}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rooms.map(space => {
                const state = states.get(space.id);
                if (!state) return null;
                const timed = state.mode === 'time_range';
                const mine = Boolean(state.myBooking);
                const holders = seatHolders(state.bookings);
                const fillPct = Math.min(100, Math.round((state.seatsTaken / Math.max(space.capacity, 1)) * 100));
                const sessionCount = state.sessions.length;
                return (
                  <div key={space.id} className="bg-white border border-[var(--line)] rounded-[var(--radius-card)] p-3.5 space-y-2.5 shadow-[var(--shadow-card)]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-[13px] font-semibold text-[var(--ink)] truncate">
                          {timed ? (
                            <button
                              type="button"
                              onClick={() => openRoomSessions(space)}
                              className="cursor-pointer truncate hover:underline"
                              title="See the day's sessions"
                            >
                              {space.name}
                            </button>
                          ) : space.name}
                        </h3>
                        <p className="ui-meta mt-0.5 flex items-center gap-1">
                          {space.location ? <><MapPin className="w-3 h-3" />{space.location}</> : <span>No location</span>}
                        </p>
                      </div>
                      {timed ? (
                        <Badge variant={mine ? 'success' : sessionCount === 0 ? 'neutral' : 'info'}>
                          {mine ? 'Your seat' : sessionCount === 0
                            ? 'No sessions'
                            : `${sessionCount} session${sessionCount === 1 ? '' : 's'}`}
                        </Badge>
                      ) : (
                        <Badge variant={state.full ? 'error' : mine ? 'success' : 'neutral'}>
                          {mine ? 'Your seat' : seatsLabel(state, space.capacity)}
                        </Badge>
                      )}
                    </div>

                    {timed ? (
                      <SessionSlots
                        space={space}
                        state={state}
                        disabled={isPast}
                        onJoin={entry => openDraft(space, state, null, entry)}
                        onLeave={booking => void leave(booking.id, space.name)}
                        onOpen={() => openNewSession(space, state)}
                        canDelete={canDeleteThisSession}
                        onDelete={session => void removeSession(session, space.name)}
                        invites={spaceSessionInvites}
                        canEdit={canEditThisSession}
                        onEdit={session => setEditTarget({ session, space })}
                      />
                    ) : (
                      <>
                        <div>
                          <div className="h-1.5 w-full rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                            <div
                              className={`h-full rounded-full ${state.full ? 'bg-rose-500' : 'bg-[var(--accent)]'}`}
                              style={{ width: `${Math.max(fillPct, state.seatsTaken > 0 ? 6 : 0)}%` }}
                            />
                          </div>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <p className="ui-meta truncate" title={holders.join(', ')}>
                              <Users className="w-3 h-3 inline mr-1 -mt-0.5" />
                              {holders.length > 0 ? holders.join(', ') : 'Nobody booked yet'}
                            </p>
                            <span className="ui-meta shrink-0">{state.seatsFree} free</span>
                          </div>
                        </div>

                        {isPast ? (
                          <Button size="sm" variant="secondary" disabled className="w-full">
                            Past day
                          </Button>
                        ) : mine && state.myBooking ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full"
                            onClick={() => void leave(state.myBooking!.id, space.name)}
                          >
                            <X className="w-3.5 h-3.5" /> Release my seat
                          </Button>
                        ) : wholeDaySeat && !isAdmin ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled
                            className="w-full"
                            title={`One whole-day seat per day — you already hold one in ${wholeDaySeat.space.name} on ${formatDate(day)}`}
                          >
                            One seat per day
                          </Button>
                        ) : state.full ? (
                          <Button size="sm" variant="secondary" disabled className="w-full" title="The database refuses a seat over capacity">
                            Fully booked
                          </Button>
                        ) : (
                          <Button size="sm" variant="primary" className="w-full" onClick={() => openDraft(space, state)}>
                            <CalendarPlus className="w-3.5 h-3.5" />
                            {wholeDaySeat ? 'Book for someone' : 'Book seat'}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {myUpcoming.length > 0 && (
        <Card title="Your upcoming seats" subtitle="Bookings you hold from today onwards.">
          <ul className="divide-y divide-[var(--line)]">
            {myUpcoming.map(booking => {
              const space = spaces.find(entry => entry.id === booking.space_id);
              const type = space ? typesById.get(space.type_id) : undefined;
              const session = spaceSessions.find(entry => entry.id === booking.session_id);
              return (
                <li key={booking.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-[var(--ink)] truncate">
                      {space?.name || 'Room'}
                      <span className="ml-2 font-mono text-[11px] font-medium text-[var(--ink-3)]">{formatDate(booking.booking_date)}</span>
                    </p>
                    <p className="ui-meta mt-0.5">
                      {type?.name || 'Space'} · {session ? sessionLabel(session) : 'Whole day'}
                      {booking.note ? ` · ${booking.note}` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => void leave(booking.id, space?.name || 'this room')}>
                    <X className="w-3.5 h-3.5" /> Release
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

        </>
      )}

      <RoomSessionsModal
        room={roomModal}
        type={roomModal ? typesById.get(roomModal.type_id) : undefined}
        state={roomModalState}
        dayLabel={formatDate(day)}
        isPast={isPast}
        onClose={() => setRoomModalId(null)}
        onJoin={entry => {
          if (!roomModal || !roomModalState) return;
          setRoomModalId(null);
          openDraft(roomModal, roomModalState, null, entry);
        }}
        onLeave={booking => void leave(booking.id, roomModal?.name || 'this room')}
        onNew={() => {
          if (!roomModal || !roomModalState) return;
          setRoomModalId(null);
          openNewSession(roomModal, roomModalState);
        }}
        canDelete={canDeleteThisSession}
        onDelete={session => void removeSession(session, roomModal?.name || 'this room')}
        invites={spaceSessionInvites}
        canEdit={canEditThisSession}
        onEdit={session => {
          if (!roomModal) return;
          setRoomModalId(null);
          setEditTarget({ session, space: roomModal });
        }}
      />

      {/* Mounted per session: opening it again always starts from the values the card shows now. */}
      {editTarget && (
        <SessionEditModal
          key={editTarget.session.id}
          session={editTarget.session}
          space={editTarget.space}
          dayLabel={formatDate(day)}
          people={profiles}
          invites={spaceSessionInvites.filter(invite => invite.session_id === editTarget.session.id)}
          bookings={spaceBookings.filter(booking => booking.session_id === editTarget.session.id)}
          onClose={() => setEditTarget(null)}
          onSave={changes => updateSpaceSession({ sessionId: editTarget.session.id, ...changes })}
          onAddInvitees={(emails, includeOutlook) => inviteToSpaceSession({
            sessionId: editTarget.session.id, emails, includeOutlook,
          })}
          onRemoveInvitee={invite => removeSpaceSessionInvite(invite)}
        />
      )}

      <Modal
        isOpen={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={!draft
          ? 'Book a seat'
          : draft.type.booking_mode === 'time_range'
            ? draft.sessionId ? `Join ${draft.space.name}` : `Open a session in ${draft.space.name}`
            : `Book ${draft.space.name}`}
        eyebrow={`Spaces · ${draft ? formatDate(day) : ''}`}
        size="xl"
      >
        {draft && (
          <div className="px-5 py-4 space-y-4">
            <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2.5">
              <p className="text-[12.5px] font-semibold text-[var(--ink)]">{draft.space.name}</p>
              <p className="ui-meta mt-0.5">
                {draft.type.name} · {BOOKING_MODE_LABELS[draft.type.booking_mode].label} · {draft.space.capacity} seat{draft.space.capacity === 1 ? '' : 's'}
              </p>
              <p className="ui-meta mt-0.5">
                {draftSession
                  ? `${sessionLabel(draftSession.session)} · ${draftSession.seatsTaken} of ${draft.space.capacity} seats taken`
                  : draft.type.booking_mode === 'time_range'
                    ? 'You are opening the session — others will join it.'
                    : `${draft.state.seatsTaken} of ${draft.space.capacity} seats taken for the day`}
              </p>
              {draft.seatId && (
                <p className={`mt-1 text-[11.5px] font-semibold ${draftSeatTaken ? 'text-rose-600' : 'text-[var(--accent-ink)]'}`}>
                  Chair {seatNameOf(draft.seatId)} selected on the plan
                  {draftSeatTaken ? ' — already taken for this session' : ''}
                </p>
              )}
            </div>

            {draft.type.booking_mode === 'time_range' && draft.state.sessions.length > 0 && (
              <div>
                <label className="ui-label block mb-1.5">Session</label>
                <select
                  value={draft.sessionId ?? 'new'}
                  onChange={event => {
                    const value = event.target.value;
                    if (value === 'new') {
                      const window = nextFreeSessionWindow(draft.state.sessions.map(entry => entry.session));
                      setDraft({
                        ...draft, sessionId: null, startsAt: window.startsAt, endsAt: window.endsAt, title: '',
                      });
                      return;
                    }
                    const chosen = draft.state.sessions.find(entry => entry.session.id === value);
                    if (!chosen) return;
                    setDraft({
                      ...draft,
                      sessionId: chosen.session.id,
                      startsAt: clockLabel(chosen.session.starts_at),
                      endsAt: clockLabel(chosen.session.ends_at),
                      title: chosen.session.title || '',
                    });
                  }}
                  className="ui-input w-full"
                >
                  {draft.state.sessions.map(entry => (
                    <option key={entry.session.id} value={entry.session.id}>
                      {sessionLabel(entry.session)} · {entry.full
                        ? `full (${entry.seatsTaken}/${draft.space.capacity})`
                        : `${entry.seatsFree} free`}{entry.ended ? ' · ended' : ''}
                    </option>
                  ))}
                  <option value="new">Open a new session…</option>
                </select>
              </div>
            )}

            {isAdmin && (
              <div>
                <label className="ui-label block mb-1.5">Seat for</label>
                <select
                  value={draft.attendeeId}
                  onChange={event => setDraft({ ...draft, attendeeId: event.target.value })}
                  className="ui-input w-full"
                >
                  <option value={currentUser.id}>{personName(currentUser)} (me)</option>
                  {attendees.filter(profile => profile.id !== currentUser.id).map(profile => (
                    <option key={profile.id} value={profile.id}>{personName(profile)}</option>
                  ))}
                </select>
              </div>
            )}

            {draft.type.booking_mode === 'time_range' && !draft.sessionId && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="ui-label block mb-1.5">Starts</label>
                    <input
                      type="time"
                      value={draft.startsAt}
                      onChange={event => setDraft({ ...draft, startsAt: event.target.value })}
                      className="ui-input w-full font-mono"
                    />
                  </div>
                  <div>
                    <label className="ui-label block mb-1.5">Ends</label>
                    <input
                      type="time"
                      value={draft.endsAt}
                      onChange={event => setDraft({ ...draft, endsAt: event.target.value })}
                      className="ui-input w-full font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="ui-label block mb-1.5">Session title</label>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={event => setDraft({ ...draft, title: event.target.value })}
                    placeholder="What is happening in this room?"
                    className="ui-input w-full"
                  />
                </div>
                <div>
                  <label className="ui-label block mb-1.5">Description (optional)</label>
                  <textarea
                    value={draft.description}
                    onChange={event => setDraft({ ...draft, description: event.target.value })}
                    placeholder="Agenda, links, anything the room should know"
                    rows={2}
                    className="ui-input w-full resize-y"
                  />
                </div>
                <SessionInviteFields
                  emails={draft.inviteEmails}
                  onEmailsChange={inviteEmails => setDraft({ ...draft, inviteEmails })}
                  includeOutlook={draft.includeOutlook}
                  onIncludeOutlookChange={includeOutlook => setDraft({ ...draft, includeOutlook })}
                  people={profiles}
                  disabled={saving}
                />
              </>
            )}

            <div>
              <label className="ui-label block mb-1.5">Note (optional)</label>
              <input
                type="text"
                value={draft.note}
                onChange={event => setDraft({ ...draft, note: event.target.value })}
                placeholder="Anything the room should know"
                className="ui-input w-full"
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
              <span className={`text-[11px] ${
                draftSeatTaken || windowError || draftWholeDayConflict ? 'font-medium text-rose-600' : 'text-[var(--ink-4)]'
              }`}>
                {draftSeatTaken
                  ? 'That chair is taken for this session — pick another one on the plan.'
                  : draftWholeDayConflict
                    ? `${draft.attendeeId === currentUser.id ? 'You' : personName(profiles.find(profile => profile.id === draft.attendeeId))} already hold${draft.attendeeId === currentUser.id ? '' : 's'} a whole-day seat in ${draftWholeDayRoom} — one whole-day seat per day.`
                    : windowError
                      ? windowError
                      : `${draftSession ? draftSession.seatsFree : draft.state.seatsFree} of ${draft.space.capacity} seats free ${draftSession ? 'in this session' : `on ${formatDate(day)}`}.`}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void submit()}
                  disabled={saving || draftSeatTaken || Boolean(windowError) || Boolean(draftWholeDayConflict)}
                >
                  {saving
                    ? 'Booking…'
                    : draft.type.booking_mode === 'time_range'
                      ? draft.sessionId ? 'Join session' : 'Open session'
                      : 'Book seat'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
