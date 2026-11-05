import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { linkRoomMailbox } from '@/lib/room-mailbox-server';

export const maxDuration = 300;

/** Admin: link, replace or clear (null) a room's Outlook mailbox. */
export async function PUT(request: NextRequest) {
  const caller = await requireApiSession(request);
  if (isNextResponse(caller)) return caller;
  if (!caller.isAdmin) return NextResponse.json({ error: 'Only administrators can link a room mailbox.' }, { status: 403 });

  const body = await request.json().catch(() => null) as { space_id?: string; outlook_email?: string | null } | null;
  const spaceId = typeof body?.space_id === 'string' ? body.space_id : '';
  if (!spaceId) return NextResponse.json({ error: 'space_id is required' }, { status: 400 });
  const email = typeof body?.outlook_email === 'string' ? body.outlook_email : null;

  const result = await linkRoomMailbox(getAdminClient(), spaceId, email);
  return NextResponse.json(result, { status: result.status ?? (result.ok ? 200 : 400) });
}
