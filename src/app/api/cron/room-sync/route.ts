import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { requireCronSecret } from '@/lib/integrations/api-helpers';
import { ensureRoomSubscription } from '@/lib/room-mailbox-server';
import { syncRoom } from '@/lib/room-sync-server';

export const maxDuration = 300;

/** Daily: renew each room's Graph subscription and sync it, the safety net behind the webhook. */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const admin = getAdminClient();
  const { data: rooms } = await admin.from('spaces').select('id, name').eq('active', true).not('outlook_email', 'is', null);

  const summary = [];
  for (const room of rooms || []) {
    const id = room.id as string;
    try {
      const subscription = await ensureRoomSubscription(admin, id);
      const sync = await syncRoom(admin, id);
      summary.push({ space_id: id, name: room.name, subscription, sync });
    } catch (error) {
      summary.push({ space_id: id, name: room.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ rooms: summary.length, summary });
}
