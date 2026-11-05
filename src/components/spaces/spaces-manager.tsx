"use client";

import React, { useMemo, useState } from 'react';
import { Cloud, Clock, DoorOpen, ExternalLink, Grid2x2, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { notifySuccess } from '@/lib/validation-modal';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { BOOKING_MODE_LABELS, outlookRoomUrl } from '@/lib/spaces';
import { roomProvisionReport, roomSyncReport } from '@/lib/room-sync';
import type { Space, SpaceBookingMode } from '@/lib/types';

const COLORS = ['#2f6fa3', '#a21caf', '#0d9488', '#b45309', '#4f46e5', '#be123c', '#475569'];

/** `05/11 14:30` in Athens time. */
const syncedLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens',
}).format(new Date(iso)).replace(',', '');

/** A success toast only when everything worked; any problem is an alert the admin has to read. */
const showRoomReport = (title: string, report: ReturnType<typeof roomSyncReport>) => {
  if (report.ok) notifySuccess(`${report.summary}.`, title);
  else alert([`${title}: ${report.summary || 'nothing changed'}.`, ...report.problems].join('\n\n'));
};

interface TypeDraft {
  id?: string;
  name: string;
  booking_mode: SpaceBookingMode;
  color: string;
  sort_order: number;
}

interface RoomDraft {
  id?: string;
  name: string;
  type_id: string;
  capacity: number;
  location: string;
  notes: string;
  outlook_email: string;
}

/**
 * Admin view of the Spaces screen: two lists —
 *   • room types, where the booking mode (whole day vs. timed session) is decided;
 *   • rooms, what people actually book, with their capacity.
 */
export const SpacesManager: React.FC = () => {
  const { spaceTypes, spaces, spaceBookings, saveSpaceType, deleteSpaceType, saveSpace, deleteSpace, linkRoomMailbox, syncRoomNow, syncOutlookRooms } = useAuth();

  const [typeDraft, setTypeDraft] = useState<TypeDraft | null>(null);
  const [roomDraft, setRoomDraft] = useState<RoomDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingOutlook, setSyncingOutlook] = useState(false);

  const orderedTypes = useMemo(
    () => [...spaceTypes].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [spaceTypes]
  );
  const roomsByType = useMemo(() => {
    const map = new Map<string, Space[]>();
    spaces.forEach(space => {
      const list = map.get(space.type_id) ?? [];
      list.push(space);
      map.set(space.type_id, list);
    });
    return map;
  }, [spaces]);

  const startNewType = () => setTypeDraft({
    name: '',
    booking_mode: 'whole_day',
    color: COLORS[orderedTypes.length % COLORS.length],
    sort_order: (orderedTypes.at(-1)?.sort_order ?? 0) + 10,
  });

  const startNewRoom = () => setRoomDraft({
    name: '',
    type_id: orderedTypes.find(type => type.active)?.id || '',
    capacity: 1,
    location: '',
    notes: '',
    outlook_email: '',
  });

  const submitType = async () => {
    if (!typeDraft || saving) return;
    if (!typeDraft.name.trim()) {
      alert('Give the room type a name.');
      return;
    }
    setSaving(true);
    const ok = await saveSpaceType(typeDraft);
    setSaving(false);
    if (ok) setTypeDraft(null);
  };

  const submitRoom = async () => {
    if (!roomDraft || saving) return;
    if (!roomDraft.name.trim() || !roomDraft.type_id) {
      alert('A room needs a name and a type.');
      return;
    }
    const original = roomDraft.id ? spaces.find(space => space.id === roomDraft.id) : undefined;
    const wanted = roomDraft.outlook_email.trim().toLowerCase() || null;
    if (
      original?.outlook_email && wanted !== original.outlook_email
      && !confirm("Removing the mailbox deletes this room's upcoming sessions that came from Outlook. Continue?")
    ) return;
    setSaving(true);
    let savedId = roomDraft.id;
    const ok = await saveSpace({
      onSaved: saved => { savedId = saved.id; },
      id: roomDraft.id,
      name: roomDraft.name,
      type_id: roomDraft.type_id,
      capacity: roomDraft.capacity,
      location: roomDraft.location,
      notes: roomDraft.notes,
    });
    // Saving a linked room again re-links it: that is how meetings that failed to book are retried.
    if (ok && savedId && (wanted || original?.outlook_email)) {
      const result = await linkRoomMailbox(savedId, wanted);
      if (!result.ok) {
        alert(`The room was saved, but its Outlook mailbox was not linked: ${result.error}`);
      } else if (wanted) {
        showRoomReport('Room mailbox linked', roomSyncReport(result));
      }
    }
    setSaving(false);
    if (ok) setRoomDraft(null);
  };

  const syncToOutlook = async () => {
    if (syncingOutlook) return;
    setSyncingOutlook(true);
    const result = await syncOutlookRooms();
    setSyncingOutlook(false);
    if (result.results.length === 0) {
      if (result.error) alert(`Rooms were not synced to Outlook: ${result.error}`);
      else notifySuccess('No time-range room needed an Outlook mailbox.', 'Rooms synced to Outlook');
      return;
    }
    showRoomReport('Rooms synced to Outlook', roomProvisionReport(result.results));
  };

  const bookingsFor = (spaceId: string) => spaceBookings.filter(booking => booking.space_id === spaceId).length;

  return (
    <div className="space-y-4">
      <Card
        title="Room types"
        subtitle="What can be booked, and how. Whole-day types take one seat per person for the date; time-range types open a session that everyone else joins."
        action={
          <Button size="sm" variant="primary" onClick={startNewType}>
            <Plus className="w-4 h-4 stroke-[3]" /> New type
          </Button>
        }
      >
        {orderedTypes.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-[var(--ink-4)]">No room types yet — add one to start declaring rooms.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {orderedTypes.map(type => {
              const rooms = roomsByType.get(type.id) ?? [];
              return (
                <li key={type.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: type.color }} />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-[var(--ink)] truncate">{type.name}</p>
                      <p className="ui-meta mt-0.5">
                        {BOOKING_MODE_LABELS[type.booking_mode].label} · {rooms.length} room{rooms.length === 1 ? '' : 's'}
                        {!type.active ? ' · hidden' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="ui-segmented" role="group" aria-label={`Booking mode for ${type.name}`}>
                      <button
                        type="button"
                        onClick={() => void saveSpaceType({ ...type, booking_mode: 'whole_day' })}
                        aria-pressed={type.booking_mode === 'whole_day'}
                        title={BOOKING_MODE_LABELS.whole_day.hint}
                      >
                        <Users className="w-3 h-3" /> Whole day
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveSpaceType({ ...type, booking_mode: 'time_range' })}
                        aria-pressed={type.booking_mode === 'time_range'}
                        title={BOOKING_MODE_LABELS.time_range.hint}
                      >
                        <Clock className="w-3 h-3" /> Time range
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTypeDraft({ id: type.id, name: type.name, booking_mode: type.booking_mode, color: type.color, sort_order: type.sort_order })}
                      title="Rename or recolour this type"
                      aria-label="Edit room type"
                      className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-control)] text-[var(--ink-3)] hover:bg-[var(--surface-sunken)] hover:text-[var(--ink)] cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (rooms.length > 0) {
                          alert('This type still has rooms. Move or delete them first.');
                          return;
                        }
                        if (confirm(`Delete the room type "${type.name}"?`)) void deleteSpaceType(type.id);
                      }}
                      title="Delete this type"
                      aria-label="Delete room type"
                      className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-control)] text-[var(--ink-4)] hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="Rooms"
        subtitle="Every bookable space, its type and how many seats it holds. Capacity is enforced when someone books. Sync to Outlook creates a room mailbox for every time-range room."
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void syncToOutlook()} disabled={syncingOutlook}>
              <Cloud className="w-4 h-4" /> {syncingOutlook ? 'Syncing…' : 'Sync to Outlook'}
            </Button>
            <Button size="sm" variant="primary" onClick={startNewRoom} disabled={orderedTypes.length === 0}>
              <Plus className="w-4 h-4 stroke-[3]" /> New room
            </Button>
          </div>
        }
      >
        {spaces.length === 0 ? (
          <div className="py-8 text-center">
            <DoorOpen className="w-6 h-6 text-[var(--ink-4)] mx-auto" />
            <p className="text-[12px] text-[var(--ink-4)] mt-2">No rooms declared yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.06em] text-[var(--ink-4)] border-b border-[var(--line)]">
                  <th className="py-1.5 pr-3 font-semibold">Room</th>
                  <th className="py-1.5 pr-3 font-semibold">Type</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Capacity</th>
                  <th className="py-1.5 pr-3 font-semibold">Location</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Bookings</th>
                  <th className="py-1.5 font-semibold text-right">—</th>
                </tr>
              </thead>
              <tbody>
                {[...spaces].sort((a, b) => a.name.localeCompare(b.name)).map(space => {
                  const type = orderedTypes.find(entry => entry.id === space.type_id);
                  const outlookUrl = outlookRoomUrl(space.outlook_email);
                  return (
                    <tr key={space.id} className="border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--surface-muted)]">
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <Grid2x2 className="w-3.5 h-3.5 text-[var(--ink-4)] shrink-0" />
                          <span className="font-semibold text-[var(--ink)] truncate">{space.name}</span>
                          {!space.active && <Badge variant="neutral">Hidden</Badge>}
                        </span>
                        {outlookUrl && (
                          <span className="block ui-meta mt-0.5">
                            <a
                              href={outlookUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open ${space.outlook_email} in Outlook`}
                              className="inline-flex items-center gap-0.5 font-semibold text-[var(--accent-ink)] hover:underline"
                            >
                              Outlook <ExternalLink className="w-3 h-3" />
                            </a>
                            <span className="mx-1">·</span>
                            {space.outlook_email}
                            <span className="mx-1">·</span>
                            {space.outlook_synced_at
                              ? `synced ${syncedLabel(space.outlook_synced_at)}`
                              : 'not synced yet'}
                            {(space.outlook_clashes?.length ?? 0) > 0 && (
                              <span
                                className="ml-1.5 text-amber-700"
                                title={space.outlook_clashes!.map(c => `${c.date} ${c.startsAt}–${c.endsAt} ${c.subject || ''} ${c.organizer || ''}`.trim()).join('\n')}
                              >
                                {space.outlook_clashes!.length} clash{space.outlook_clashes!.length === 1 ? '' : 'es'}
                              </span>
                            )}
                          </span>
                        )}
                        {space.outlook_email && space.outlook_sync_error && (
                          <span className="block text-[11px] text-rose-600 mt-0.5 whitespace-pre-line">{space.outlook_sync_error}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: type?.color || '#94a3b8' }} />
                          <span className="text-[var(--ink-2)]">{type?.name || 'Unknown type'}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right ui-num font-semibold text-[var(--ink)]">{space.capacity}</td>
                      <td className="py-2 pr-3 text-[var(--ink-3)]">{space.location || '—'}</td>
                      <td className="py-2 pr-3 text-right ui-num text-[var(--ink-3)]">{bookingsFor(space.id)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setRoomDraft({
                            id: space.id,
                            name: space.name,
                            type_id: space.type_id,
                            capacity: space.capacity,
                            location: space.location || '',
                            notes: space.notes || '',
                            outlook_email: space.outlook_email || '',
                          })}
                          title="Edit room"
                          aria-label="Edit room"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-control)] text-[var(--ink-3)] hover:bg-[var(--surface-sunken)] hover:text-[var(--ink)] cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {space.outlook_email && (
                          <button
                            type="button"
                            onClick={async () => {
                              const r = await syncRoomNow(space.id);
                              if (!r.ok) alert(`Could not sync the room: ${r.error}`);
                              else showRoomReport(`${space.name} synced`, roomSyncReport(r));
                            }}
                            className="inline-flex items-center justify-center h-6 px-1.5 rounded-[var(--radius-control)] text-[10px] font-semibold text-[var(--ink-3)] hover:bg-[var(--surface-sunken)] cursor-pointer"
                          >
                            Sync now
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void saveSpace({ ...space, active: !space.active })}
                          title={space.active ? 'Hide from the booking screen' : 'Show on the booking screen'}
                          className="inline-flex items-center justify-center h-6 px-1.5 rounded-[var(--radius-control)] text-[10px] font-semibold text-[var(--ink-3)] hover:bg-[var(--surface-sunken)] cursor-pointer"
                        >
                          {space.active ? 'Hide' : 'Show'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Delete "${space.name}"? Its bookings and sessions go with it.`)) void deleteSpace(space.id);
                          }}
                          title="Delete room"
                          aria-label="Delete room"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-control)] text-[var(--ink-4)] hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {typeDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(13,18,24,0.55)] backdrop-blur-[2px]">
          <div className="bg-white border border-[var(--line-strong)] w-full max-w-md rounded-[var(--radius-card)] shadow-[var(--shadow-pop)] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="ui-eyebrow">Settings · Spaces</p>
                <h3 className="ui-section-title mt-0.5">{typeDraft.id ? 'Edit room type' : 'New room type'}</h3>
              </div>
              <button type="button" onClick={() => setTypeDraft(null)} className="text-[var(--ink-4)] hover:text-[var(--ink)] cursor-pointer" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="ui-label block mb-1.5">Name</label>
              <input
                type="text"
                value={typeDraft.name}
                onChange={event => setTypeDraft({ ...typeDraft, name: event.target.value })}
                placeholder="e.g. Conference room"
                className="ui-input w-full"
              />
            </div>
            <div>
              <label className="ui-label block mb-1.5">Booking mode</label>
              <select
                value={typeDraft.booking_mode}
                onChange={event => setTypeDraft({ ...typeDraft, booking_mode: event.target.value as SpaceBookingMode })}
                className="ui-input w-full"
              >
                <option value="whole_day">Whole day — one seat per person for the date</option>
                <option value="time_range">Time range — the room runs sessions, each with its own seats</option>
              </select>
              <p className="ui-meta mt-1.5">{BOOKING_MODE_LABELS[typeDraft.booking_mode].hint}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="ui-label block mb-1.5">Sort order</label>
                <input
                  type="number"
                  value={typeDraft.sort_order}
                  onChange={event => setTypeDraft({ ...typeDraft, sort_order: Number(event.target.value) || 0 })}
                  className="ui-input w-full font-mono"
                />
              </div>
              <div>
                <label className="ui-label block mb-1.5">Colour</label>
                <div className="flex items-center gap-1.5">
                  {COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setTypeDraft({ ...typeDraft, color })}
                      aria-label={`Use ${color}`}
                      className={`w-5 h-5 rounded-full border-2 cursor-pointer ${typeDraft.color === color ? 'border-[var(--ink)]' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="secondary" onClick={() => setTypeDraft(null)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={() => void submitType()} disabled={saving}>
                {saving ? 'Saving…' : 'Save type'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {roomDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(13,18,24,0.55)] backdrop-blur-[2px]">
          <div className="bg-white border border-[var(--line-strong)] w-full max-w-md rounded-[var(--radius-card)] shadow-[var(--shadow-pop)] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="ui-eyebrow">Settings · Spaces</p>
                <h3 className="ui-section-title mt-0.5">{roomDraft.id ? 'Edit room' : 'New room'}</h3>
              </div>
              <button type="button" onClick={() => setRoomDraft(null)} className="text-[var(--ink-4)] hover:text-[var(--ink)] cursor-pointer" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="ui-label block mb-1.5">Name</label>
              <input
                type="text"
                value={roomDraft.name}
                onChange={event => setRoomDraft({ ...roomDraft, name: event.target.value })}
                placeholder="e.g. Conference room B"
                className="ui-input w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="ui-label block mb-1.5">Type</label>
                <select
                  value={roomDraft.type_id}
                  onChange={event => setRoomDraft({ ...roomDraft, type_id: event.target.value })}
                  className="ui-input w-full"
                >
                  <option value="">Select a type…</option>
                  {orderedTypes.filter(type => type.active || type.id === roomDraft.type_id).map(type => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="ui-label block mb-1.5">Capacity (seats)</label>
                <input
                  type="number"
                  min={1}
                  value={roomDraft.capacity}
                  onChange={event => setRoomDraft({ ...roomDraft, capacity: Number(event.target.value) || 1 })}
                  className="ui-input w-full font-mono"
                />
              </div>
            </div>
            <div>
              <label className="ui-label block mb-1.5">Location</label>
              <input
                type="text"
                value={roomDraft.location}
                onChange={event => setRoomDraft({ ...roomDraft, location: event.target.value })}
                placeholder="Floor, building, wing…"
                className="ui-input w-full"
              />
            </div>
            {orderedTypes.find(type => type.id === roomDraft.type_id)?.booking_mode === 'time_range' && (
              <div>
                <label htmlFor="room-mailbox" className="ui-label block mb-1.5">Room mailbox</label>
                <input
                  id="room-mailbox"
                  type="email"
                  value={roomDraft.outlook_email}
                  onChange={event => setRoomDraft({ ...roomDraft, outlook_email: event.target.value })}
                  placeholder="room@stellarblue.eu"
                  className="ui-input w-full"
                />
                <p className="ui-meta mt-1">
                  Pick this room in Outlook&apos;s room list and its meetings appear here. Leave it empty
                  and use <strong>Sync to Outlook</strong> to let Orbit create the room mailbox.
                </p>
              </div>
            )}
            <div>
              <label className="ui-label block mb-1.5">Notes</label>
              <textarea
                value={roomDraft.notes}
                onChange={event => setRoomDraft({ ...roomDraft, notes: event.target.value })}
                rows={2}
                placeholder="Equipment, rules, who owns the room…"
                className="ui-input w-full resize-y"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="secondary" onClick={() => setRoomDraft(null)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={() => void submitRoom()} disabled={saving}>
                {saving ? 'Saving…' : 'Save room'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
