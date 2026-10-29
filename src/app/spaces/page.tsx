"use client";

import React, { useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import {
  CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock, DoorOpen, Grid2x2, LayoutGrid, MapPin, Users, X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Badge, Button, Card, Modal } from '@/components/ui/primitives';
import { DatePicker } from '@/components/ui/date-picker';
import { formatDate } from '@/lib/date';
import { notifySuccess } from '@/lib/validation-modal';
import { SpacesManager } from '@/components/spaces/spaces-manager';
import { OfficePlan, OfficePlanEmpty } from '@/components/spaces/office-plan';
import { OfficeLayoutEditor } from '@/components/spaces/office-layout-editor';
import {
  BOOKING_MODE_LABELS, clockLabel, defaultSessionWindow, seatHolders, seatsLabel, sessionLabel, spaceDayState,
  validateSessionWindow, type SpaceDayState,
} from '@/lib/spaces';
import { seatLabel as seatName } from '@/lib/office-layout';
import type { Profile, Space, SpaceSeat, SpaceType } from '@/lib/types';

const todayKey = () => format(new Date(), 'yyyy-MM-dd');

const personName = (profile?: Profile) =>
  profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.work_email : 'Colleague';

interface BookingDraft {
  space: Space;
  type: SpaceType;
  state: SpaceDayState;
  attendeeId: string;
  seatId: string | null;
  startsAt: string;
  endsAt: string;
  title: string;
  note: string;
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
    currentUser, profiles, spaceTypes, spaces, spaceSessions, spaceBookings,
    officeFloors, spaceSeats, spaceDesks, bookSpaceSeat, cancelSpaceBooking,
  } = useAuth();

  const isAdmin = currentUser.role === 'admin';
  /** Admins get the room/type configuration as a second view here instead of a Settings tab. */
  const [view, setView] = useState<'book' | 'manage' | 'layout'>('book');
  const [day, setDay] = useState<string>(todayKey());
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const today = todayKey();
  const isPast = day < today;

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

  const seatsToday = useMemo(() => {
    const taken = [...states.values()].reduce((sum, state) => sum + state.seatsTaken, 0);
    const capacity = activeSpaces.reduce((sum, space) => sum + space.capacity, 0);
    return { taken, capacity };
  }, [states, activeSpaces]);

  const mySeat = useMemo(() => {
    const entry = [...states.entries()].find(([, state]) => Boolean(state.myBooking));
    if (!entry) return null;
    const [spaceId, state] = entry;
    return { space: activeSpaces.find(space => space.id === spaceId), state };
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

  const takenSeatIds = useMemo(
    () => spaceBookings
      .filter(booking => booking.booking_date === day && booking.seat_id && planRoomIds.has(booking.space_id))
      .map(booking => booking.seat_id as string),
    [spaceBookings, day, planRoomIds]
  );

  const mySeatIds = useMemo(
    () => spaceBookings
      .filter(booking => (
        booking.booking_date === day && booking.profile_id === currentUser.id && Boolean(booking.seat_id)
      ))
      .map(booking => booking.seat_id as string),
    [spaceBookings, day, currentUser.id]
  );

  const pickSeat = (seat: SpaceSeat, room: Space) => {
    if (isPast) {
      alert('You cannot book a seat on a past day.');
      return;
    }
    const state = states.get(room.id);
    if (!state) return;
    if (state.myBooking) {
      alert(`You already hold a seat in ${room.name} on ${formatDate(day)}.`);
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

  const attendees = useMemo(
    () => profiles
      .filter(profile => profile.status === 'active')
      .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)),
    [profiles]
  );

  const openDraft = (space: Space, state: SpaceDayState, seatId: string | null = null) => {
    if (isPast) return;
    const type = typesById.get(space.type_id);
    if (!type) return;
    const window = state.session
      ? { startsAt: clockLabel(state.session.starts_at), endsAt: clockLabel(state.session.ends_at) }
      : defaultSessionWindow();
    setDraft({
      space,
      type,
      state,
      attendeeId: currentUser.id,
      seatId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      title: state.session?.title || '',
      note: '',
    });
  };

  const submit = async () => {
    if (!draft || saving) return;
    const needsWindow = draft.type.booking_mode === 'time_range' && !draft.state.session;
    if (needsWindow) {
      const invalid = validateSessionWindow(draft.startsAt, draft.endsAt);
      if (invalid) {
        alert(invalid);
        return;
      }
    }
    setSaving(true);
    const result = await bookSpaceSeat({
      space: draft.space,
      mode: draft.type.booking_mode,
      date: day,
      profileId: draft.attendeeId,
      seatId: draft.seatId,
      note: draft.note || undefined,
      session: needsWindow
        ? { startsAt: draft.startsAt, endsAt: draft.endsAt, title: draft.title }
        : null,
    });
    setSaving(false);
    if (!result.ok) {
      alert(result.error || 'The seat could not be booked.');
      return;
    }
    notifySuccess(
      `${draft.space.name} booked for ${formatDate(day)}.`,
      draft.attendeeId === currentUser.id ? 'Seat booked' : 'Seat booked for a colleague'
    );
    setDraft(null);
  };

  const leave = async (bookingId: string, label: string) => {
    if (!confirm(`Release this seat in ${label}?`)) return;
    const ok = await cancelSpaceBooking(bookingId);
    if (ok) notifySuccess(`The seat in ${label} has been released.`, 'Seat released');
  };

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-150">
      {/* Header — where you are, then the day you are booking. */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 border-b border-[var(--line-strong)] pb-3">
        <div className="min-w-0">
          <p className="ui-eyebrow">Workplace · Rooms & seats</p>
          <h1 className="ui-title mt-1">Spaces</h1>
          <p className="text-[12.5px] text-[var(--ink-3)] mt-1 max-w-xl">
            Declare the rooms the company has and book a seat in them. Desks are booked for the day;
            meeting rooms open a session at a time that the rest of the team joins.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {view === 'book' && (
            <>
          <button
            type="button"
            onClick={() => setDay(format(addDays(parseISO(day), -1), 'yyyy-MM-dd'))}
            title="Previous day"
            aria-label="Previous day"
            className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-white text-[var(--ink-3)] hover:bg-[var(--surface-muted)] cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <DatePicker value={day} onChange={setDay} className="w-[150px]" />
          <button
            type="button"
            onClick={() => setDay(format(addDays(parseISO(day), 1), 'yyyy-MM-dd'))}
            title="Next day"
            aria-label="Next day"
            className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-white text-[var(--ink-3)] hover:bg-[var(--surface-muted)] cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {day !== today && (
            <Button size="sm" variant="secondary" onClick={() => setDay(today)}>
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
          takenSeatIds={takenSeatIds}
          mySeatIds={mySeatIds}
          onPickSeat={pickSeat}
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
                  : 'the first booking opens the session, the rest join it'}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rooms.map(space => {
                const state = states.get(space.id);
                if (!state) return null;
                const mine = Boolean(state.myBooking);
                const holders = seatHolders(state.bookings);
                const fillPct = Math.min(100, Math.round((state.seatsTaken / Math.max(space.capacity, 1)) * 100));
                return (
                  <div key={space.id} className="bg-white border border-[var(--line)] rounded-[var(--radius-card)] p-3.5 space-y-2.5 shadow-[var(--shadow-card)]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-[13px] font-semibold text-[var(--ink)] truncate">{space.name}</h3>
                        <p className="ui-meta mt-0.5 flex items-center gap-1">
                          {space.location ? <><MapPin className="w-3 h-3" />{space.location}</> : <span>No location</span>}
                        </p>
                      </div>
                      <Badge variant={state.full ? 'error' : mine ? 'success' : 'neutral'}>
                        {mine ? 'Your seat' : seatsLabel(state, space.capacity)}
                      </Badge>
                    </div>

                    {state.mode === 'time_range' && (
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink-2)]">
                        <Clock className="w-3 h-3 text-[var(--ink-4)] shrink-0" />
                        {state.session ? (
                          <span className="truncate" title={sessionLabel(state.session)}>{sessionLabel(state.session)}</span>
                        ) : (
                          <span className="text-[var(--ink-3)]">No session yet — the first booking sets the time</span>
                        )}
                      </div>
                    )}

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
                    ) : state.full ? (
                      <Button size="sm" variant="secondary" disabled className="w-full" title="The database refuses a seat over capacity">
                        Fully booked
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" className="w-full" onClick={() => openDraft(space, state)}>
                        <CalendarPlus className="w-3.5 h-3.5" />
                        {state.mode === 'time_range'
                          ? state.session ? 'Join session' : 'Open session'
                          : 'Book seat'}
                      </Button>
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

      <Modal
        isOpen={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.state.session ? `Join ${draft.space.name}` : `Book ${draft?.space.name || 'a seat'}`}
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
                {draft.state.session
                  ? `${sessionLabel(draft.state.session)} · ${draft.state.seatsTaken} of ${draft.space.capacity} seats taken`
                  : 'You are opening the session — others will join it.'}
              </p>
              {draft.seatId && (
                <p className="mt-1 text-[11.5px] font-semibold text-[var(--accent-ink)]">
                  Chair {seatNameOf(draft.seatId)} selected on the plan
                </p>
              )}
            </div>

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

            {draft.type.booking_mode === 'time_range' && !draft.state.session && (
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
              <span className="text-[11px] text-[var(--ink-4)]">
                {draft.state.seatsFree} of {draft.space.capacity} seats free on {formatDate(day)}.
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={() => void submit()} disabled={saving}>
                  {saving ? 'Booking…' : draft.state.session ? 'Join session' : 'Book seat'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
