import type { SupabaseClient } from '@supabase/supabase-js';
import {
  graphCreatePlace, graphGetPlace, graphListPlaces, graphUpdateRoom, type GraphPlace,
} from '@/lib/integrations/outlook';
import {
  describePlaceFailure, roomPlaceFields, roomPlacePatch, type RoomPlaceFields, type RoomProvisionResult,
} from '@/lib/room-sync';
import { linkRoomMailbox, type RoomMailboxResult } from '@/lib/room-mailbox-server';

/**
 * Orbit rooms as Outlook rooms: a "Sync to Outlook" pass over the time-range rooms, creating the
 * ones Outlook does not have yet as Places rooms (Exchange room mailboxes) and keeping the details
 * of the rest in step. Every created room is then linked and synced by the existing room-mailbox
 * engine, so its calendar immediately feeds Orbit sessions.
 *
 * Needs the Graph application permission Place.ReadWrite.All plus the Exchange MailRecipient and
 * TenantPlacesManagement roles; room-calendar access alone is not enough.
 */

type RoomRow = {
  id: string;
  name: string;
  capacity: number;
  location: string | null;
  outlook_email: string | null;
  space_types: { booking_mode?: string } | { booking_mode?: string }[] | null;
  office_floors: { name?: string } | { name?: string }[] | null;
};

type HierarchyCache = {
  buildings?: GraphPlace[];
  floors?: GraphPlace[];
  buildingsError?: string;
  floorsError?: string;
};

const one = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const sameName = (left: string | null | undefined, right: string) =>
  (left || '').trim().toLowerCase() === right.trim().toLowerCase();

const linkFields = (linked: RoomMailboxResult) => ({
  backfilled: linked.backfilled,
  backfillFailures: linked.backfillFailures,
  subscription: linked.subscription,
  sync: linked.sync,
});

/**
 * The building and floor a room belongs to. Orbit floors are the natural floors; the building comes
 * from the room's location, so rooms at the same address share one. Buildings and floors are
 * created on demand — Places needs the hierarchy for the room to show under a floor in Outlook.
 */
async function ensureFloor(
  fields: RoomPlaceFields,
  cache: HierarchyCache
): Promise<{ parentId: string | null; warning?: string }> {
  if (!cache.buildings) {
    if (cache.buildingsError) return { parentId: null, warning: cache.buildingsError };
    const listed = await graphListPlaces('microsoft.graph.building');
    if (!listed.ok) {
      cache.buildingsError = `Outlook buildings could not be read: ${describePlaceFailure(listed, 'read')}`;
      return { parentId: null, warning: cache.buildingsError };
    }
    cache.buildings = listed.places;
  }

  let building = cache.buildings.find(entry => sameName(entry.displayName, fields.building));
  if (!building) {
    const created = await graphCreatePlace({ '@odata.type': 'microsoft.graph.building', displayName: fields.building });
    if (!created.ok) {
      return { parentId: null, warning: `The Outlook building could not be created: ${describePlaceFailure(created, 'create')}` };
    }
    building = created.event as GraphPlace;
    cache.buildings.push(building);
  }

  if (!cache.floors) {
    if (cache.floorsError) return { parentId: null, warning: cache.floorsError };
    const listed = await graphListPlaces('microsoft.graph.floor');
    if (!listed.ok) {
      cache.floorsError = `Outlook floors could not be read: ${describePlaceFailure(listed, 'read')}`;
      return { parentId: null, warning: cache.floorsError };
    }
    cache.floors = listed.places;
  }

  let floor = cache.floors.find(entry => entry.parentId === building!.id && sameName(entry.displayName, fields.floorLabel));
  if (!floor) {
    const created = await graphCreatePlace({
      '@odata.type': 'microsoft.graph.floor',
      displayName: fields.floorLabel,
      parentId: building.id,
    });
    if (!created.ok) {
      return { parentId: null, warning: `The Outlook floor could not be created: ${describePlaceFailure(created, 'create')}` };
    }
    floor = created.event as GraphPlace;
    cache.floors.push(floor);
  }
  return { parentId: floor.id };
}

/** One place: by id or the room's email address, then by email across the room list. */
async function findRoom(
  email: string
): Promise<{ place: GraphPlace | null; key: string; warning?: string }> {
  const direct = await graphGetPlace(email);
  if (direct.ok) {
    const place = direct.event as GraphPlace;
    return { place, key: place.id || email };
  }
  // A key Places does not accept says nothing about the room: look it up in the room list before
  // deciding Outlook does not know it. A permission failure is reported as it is.
  if (direct.status !== 404 && direct.status !== 400) {
    return { place: null, key: email, warning: describePlaceFailure(direct, 'read') };
  }

  const listed = await graphListPlaces('microsoft.graph.room');
  if (!listed.ok) return { place: null, key: email, warning: describePlaceFailure(listed, 'read') };
  const place = listed.places.find(entry => (entry.emailAddress || '').trim().toLowerCase() === email) || null;
  return {
    place,
    key: place?.id || email,
    warning: place ? undefined : `Outlook does not list ${email}.`,
  };
}

/** One room: create its Outlook room when missing, refresh its details when not, then link and sync. */
async function provisionRoom(
  admin: SupabaseClient,
  room: RoomRow,
  cache: HierarchyCache
): Promise<RoomProvisionResult> {
  const floor = one(room.office_floors)?.name || null;
  const fields = roomPlaceFields(room, floor, {
    building: process.env.OUTLOOK_ROOMS_BUILDING,
    floor: process.env.OUTLOOK_ROOMS_FLOOR,
  });
  const email = (room.outlook_email || '').trim().toLowerCase();

  if (!email) {
    const parent = await ensureFloor(fields, cache);
    const created = await graphCreatePlace({
      '@odata.type': 'microsoft.graph.room',
      displayName: fields.displayName,
      capacity: fields.capacity,
      building: fields.building,
      floorLabel: fields.floorLabel,
      bookingType: 'standard',
      ...(parent.parentId ? { parentId: parent.parentId } : {}),
    });
    if (!created.ok) {
      return {
        space_id: room.id,
        name: room.name,
        outcome: 'failed',
        message: describePlaceFailure(created, 'create'),
      };
    }

    const place = created.event as GraphPlace;
    const mailbox = (place.emailAddress || '').trim().toLowerCase();
    if (!mailbox) {
      return {
        space_id: room.id,
        name: room.name,
        outcome: 'failed',
        message: 'Outlook created the room but returned no email address for it.',
      };
    }

    const linked = await linkRoomMailbox(admin, room.id, mailbox);
    if (!linked.ok) {
      // The mailbox exists in Outlook now: remember it so the next run links it instead of creating
      // a second room with the same name.
      await admin.from('spaces').update({ outlook_email: mailbox }).eq('id', room.id);
      return {
        space_id: room.id,
        name: room.name,
        outcome: 'created',
        outlook_email: mailbox,
        message: `Outlook created ${mailbox}, but linking it failed: ${linked.error || 'unknown error'}`,
      };
    }

    return {
      space_id: room.id,
      name: room.name,
      outcome: 'created',
      outlook_email: mailbox,
      message: parent.warning,
      ...linkFields(linked),
    };
  }

  let outcome: RoomProvisionResult['outcome'] = 'unchanged';
  let warning: string | undefined;
  const found = await findRoom(email);
  if (found.place) {
    const patch = roomPlacePatch(found.place, fields);
    if (Object.keys(patch).length > 0) {
      const updated = await graphUpdateRoom(found.key, patch);
      if (updated.ok) outcome = 'updated';
      else warning = `The Outlook room details were not updated: ${describePlaceFailure(updated, 'update')}`;
    }
  } else {
    warning = found.warning
      ? `The Outlook room details were not checked. ${found.warning}`
      : 'The Outlook room details were not checked.';
  }

  const linked = await linkRoomMailbox(admin, room.id, email);
  if (!linked.ok) {
    return {
      space_id: room.id,
      name: room.name,
      outcome: 'failed',
      outlook_email: email,
      message: `Linking the room mailbox failed: ${linked.error || 'unknown error'}`,
    };
  }

  return {
    space_id: room.id,
    name: room.name,
    outcome,
    outlook_email: email,
    message: warning,
    ...linkFields(linked),
  };
}

/**
 * Syncs Orbit's rooms with Outlook. Without `spaceIds` every active time-range room is considered;
 * with them, exactly those rooms (an admin action on one room). Whole-day spaces have no Outlook
 * room mailbox, so the bulk run leaves them out and a targeted run explains why.
 */
export async function syncOrbitRoomsToOutlook(
  admin: SupabaseClient,
  spaceIds?: string[]
): Promise<{ ok: true; results: RoomProvisionResult[] } | { ok: false; error: string }> {
  let query = admin
    .from('spaces')
    .select('id, name, capacity, location, outlook_email, space_types(booking_mode), office_floors(name)');
  query = spaceIds && spaceIds.length > 0 ? query.in('id', spaceIds) : query.eq('active', true);

  const { data, error } = await query.order('name');
  if (error) return { ok: false, error: `Could not read the rooms: ${error.message}` };

  const rooms = (data || []) as unknown as RoomRow[];
  if (spaceIds && spaceIds.length > 0 && rooms.length === 0) {
    return { ok: false, error: 'That room no longer exists.' };
  }
  const cache: HierarchyCache = {};
  const results: RoomProvisionResult[] = [];

  for (const room of rooms) {
    const bookingMode = one(room.space_types)?.booking_mode;
    if (bookingMode !== 'time_range') {
      if (spaceIds && spaceIds.length > 0) {
        results.push({
          space_id: room.id,
          name: room.name,
          outcome: 'skipped',
          message: 'Only rooms booked by the hour can have an Outlook room mailbox.',
        });
      }
      continue;
    }
    try {
      results.push(await provisionRoom(admin, room, cache));
    } catch (caught) {
      results.push({
        space_id: room.id,
        name: room.name,
        outcome: 'failed',
        message: caught instanceof Error ? caught.message : 'Unexpected error while syncing the room.',
      });
    }
  }

  return { ok: true, results };
}
