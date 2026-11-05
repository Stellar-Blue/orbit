import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { syncOrbitRoomsToOutlook } from '@/lib/room-provision-server';
import { roomProvisionReport } from '@/lib/room-sync';

export const maxDuration = 300;

/**
 * Admin: make sure Orbit's time-range rooms exist as Outlook rooms (Exchange room mailboxes),
 * refresh their details and link/sync their calendars. Without `space_id` every active time-range
 * room is handled.
 */
export async function POST(request: NextRequest) {
  const caller = await requireApiSession(request);
  if (isNextResponse(caller)) return caller;
  if (!caller.isAdmin) return NextResponse.json({ ok: false, error: 'Only administrators can sync rooms to Outlook.' }, { status: 403 });

  const body = await request.json().catch(() => null) as { space_id?: string } | null;
  const spaceId = typeof body?.space_id === 'string' && body.space_id ? body.space_id : undefined;

  const result = await syncOrbitRoomsToOutlook(getAdminClient(), spaceId ? [spaceId] : undefined);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error, results: [] }, { status: 500 });

  const report = roomProvisionReport(result.results);
  return NextResponse.json({
    ok: report.ok,
    error: report.ok ? undefined : 'Some rooms could not be synced to Outlook.',
    results: result.results,
  });
}
