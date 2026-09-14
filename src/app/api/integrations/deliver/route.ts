import { NextRequest, NextResponse } from 'next/server';
import { deliverSlackOutbox, getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { syncOutlookForProfile, type OutlookSyncResult } from '@/lib/integrations/outlook';

export async function POST(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;

  const body = await request.json().catch(() => ({} as { profile_id?: string }));
  if (body.profile_id && body.profile_id !== session.profileId && !session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden: can only sync your own calendar' }, { status: 403 });
  }

  const admin = getAdminClient();
  const summary = await deliverSlackOutbox(admin, 50);

  // Immediate Outlook mirror for the affected profile (leave approval/cancel/edit, remote day add)
  let outlook: OutlookSyncResult | null = null;
  if (body.profile_id) {
    try {
      outlook = await syncOutlookForProfile(admin, body.profile_id);
    } catch (e) {
      console.error('deliver outlook sync error:', e);
    }
  }

  return NextResponse.json({ ok: true, ...summary, outlook });
}
