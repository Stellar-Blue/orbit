import { after, NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { notifiedSubscriptionIds } from '@/lib/room-sync';
import { syncRoom } from '@/lib/room-sync-server';

export const maxDuration = 300;

/**
 * Microsoft Graph change notifications for room mailboxes. Answers before touching the database:
 * Graph drops a subscription whose endpoint is slow, so the room lookup and the sync run after.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('validationToken');
  if (token) return new NextResponse(token, { status: 200, headers: { 'Content-Type': 'text/plain' } });

  const body = await request.json().catch(() => null);
  const ids = notifiedSubscriptionIds(body, process.env.OUTLOOK_ROOMS_WEBHOOK_SECRET || '');
  if (ids.length) {
    after(async () => {
      try {
        const admin = getAdminClient();
        const { data: rooms, error } = await admin.from('spaces').select('id').in('outlook_subscription_id', ids);
        if (error) throw error;
        await Promise.all((rooms || []).map(room => syncRoom(admin, room.id as string)
          .catch(failure => console.error('room notify sync failed', failure))));
      } catch (error) {
        console.error('room notify failed', error);
      }
    });
  }
  return new NextResponse(null, { status: 202 });
}
