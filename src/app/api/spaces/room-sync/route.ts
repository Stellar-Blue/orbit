import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { ensureRoomSubscription } from '@/lib/room-mailbox-server';
import { syncRoom } from '@/lib/room-sync-server';

export const maxDuration = 300;

/** Admin: sync one room with its Outlook mailbox now. */
export async function POST(request: NextRequest) {
  const caller = await requireApiSession(request);
  if (isNextResponse(caller)) return caller;
  if (!caller.isAdmin) return NextResponse.json({ error: 'Only administrators can sync a room.' }, { status: 403 });

  const body = await request.json().catch(() => null) as { space_id?: string } | null;
  const spaceId = typeof body?.space_id === 'string' ? body.space_id : '';
  if (!spaceId) return NextResponse.json({ error: 'space_id is required' }, { status: 400 });

  const admin = getAdminClient();
  const subscription = await ensureRoomSubscription(admin, spaceId);
  const sync = await syncRoom(admin, spaceId);
  return NextResponse.json({ subscription, sync });
}
