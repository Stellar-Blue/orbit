import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { requireCronSecret } from '@/lib/integrations/api-helpers';
import { ensureRoomSubscription } from '@/lib/room-mailbox-server';
import type { RoomSubscription } from '@/lib/room-sync';
import { syncRoom } from '@/lib/room-sync-server';

export const maxDuration = 300;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Daily: renew every room's Graph subscription, then sync each room, the safety net behind the
 * webhook. Renewals go first so a slow sync can never use up the run before a subscription lapses.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const admin = getAdminClient();
  const { data: rooms, error } = await admin.from('spaces').select('id, name').eq('active', true).not('outlook_email', 'is', null);
  if (error) return NextResponse.json({ error: `Could not read the rooms: ${error.message}` }, { status: 500 });

  const subscriptions = new Map<string, RoomSubscription>();
  for (const room of rooms || []) {
    const id = room.id as string;
    try {
      subscriptions.set(id, await ensureRoomSubscription(admin, id));
    } catch (failure) {
      subscriptions.set(id, { state: 'skipped', reason: messageOf(failure) });
    }
  }

  const summary = [];
  for (const room of rooms || []) {
    const id = room.id as string;
    const subscription = subscriptions.get(id);
    try {
      summary.push({ space_id: id, name: room.name, subscription, sync: await syncRoom(admin, id, { subscription }) });
    } catch (failure) {
      summary.push({ space_id: id, name: room.name, subscription, error: messageOf(failure) });
    }
  }
  return NextResponse.json({ rooms: summary.length, summary });
}
