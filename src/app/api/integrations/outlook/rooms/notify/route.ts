import { after, NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { notifiedSubscriptionIds } from '@/lib/room-sync';
import { syncRoom } from '@/lib/room-sync-server';

export const maxDuration = 300;

/** Microsoft Graph change notifications for room mailboxes. Always answers fast; the sync runs after the response. */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('validationToken');
  if (token) return new NextResponse(token, { status: 200, headers: { 'Content-Type': 'text/plain' } });

  try {
    const body = await request.json().catch(() => null);
    const ids = notifiedSubscriptionIds(body, process.env.OUTLOOK_ROOMS_WEBHOOK_SECRET || '');
    if (ids.length) {
      const admin = getAdminClient();
      const { data: rooms } = await admin.from('spaces').select('id').in('outlook_subscription_id', ids);
      for (const room of rooms || []) {
        after(() => syncRoom(admin, room.id as string).catch(error => console.error('room notify sync failed', error)));
      }
    }
  } catch (error) {
    console.error('room notify failed', error);
  }
  return new NextResponse(null, { status: 202 });
}
