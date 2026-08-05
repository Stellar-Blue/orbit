import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { deliverSlackOutbox, getAdminClient } from '@/lib/integrations/server';

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const summary = await deliverSlackOutbox(admin, 50);
  return NextResponse.json({ ok: true, ...summary });
}
