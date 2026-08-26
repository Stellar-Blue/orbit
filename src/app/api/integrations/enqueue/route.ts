import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { enqueueOutbox, getAdminClient } from '@/lib/integrations/server';

interface SyncRequest {
  profile_id: string;
  date: string;
  orbit_id?: string;
}

function isValidDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T12:00:00Z`).getTime());
}

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  let body: SyncRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const targetProfileId = body.profile_id;
  const { data: roleRows } = await supabase.from('user_roles').select('role').eq('profile_id', profile.id);
  const isAdmin = (roleRows || []).some(r => r.role === 'admin');
  if (targetProfileId && targetProfileId !== profile.id && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden: can only sync your own status' }, { status: 403 });
  }
  const syncProfileId = targetProfileId || profile.id;

  const admin = getAdminClient();

  // Only mirror for users the admin has marked as required to connect Slack.
  const { data: target } = await admin
    .from('profiles')
    .select('slack_required')
    .eq('id', syncProfileId)
    .maybeSingle();
  if (!target?.slack_required) {
    return NextResponse.json({ ok: true, enqueued: 0, skipped: 'not_required' });
  }

  const date = body.date;
  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const idempotencyKey = `slack:status:${syncProfileId}:${date}:${crypto.randomUUID()}`;
  const enqueued = await enqueueOutbox(admin, [{
    provider: 'slack',
    operation: 'status_sync',
    orbit_kind: body.orbit_id ? 'leave' : 'status',
    orbit_id: body.orbit_id || syncProfileId,
    payload: { profile_id: syncProfileId, date, source: 'immediate' },
    idempotency_key: idempotencyKey,
    ordering_key: `slack:${syncProfileId}:${date}`,
  }]);

  return NextResponse.json({ ok: true, enqueued });
}
