import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { deliverSlackOutbox, getAdminClient } from '@/lib/integrations/server';
import { syncOutlookForProfile, type OutlookSyncResult } from '@/lib/integrations/outlook';

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const summary = await deliverSlackOutbox(admin, 50);

  // Immediate Outlook mirror for the affected profile (leave approval/cancel/edit, remote day add)
  let outlook: OutlookSyncResult | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.profile_id) {
      outlook = await syncOutlookForProfile(admin, body.profile_id);
    }
  } catch (e) {
    console.error('deliver outlook sync error:', e);
  }

  return NextResponse.json({ ok: true, ...summary, outlook });
}
