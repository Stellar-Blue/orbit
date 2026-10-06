import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Employee withdrawal of their own still-pending remote-quota exception request.
 *
 * The client cannot do this itself: 0063 makes every UPDATE/DELETE on
 * `remote_quota_requests` admin-only, and the status CHECK (0041) only accepts
 * pending/approved/rejected anyway, so writing the soft-cancel marker ('cancelled')
 * is rejected and the UI shows "Could not withdraw request".
 *
 * This route performs the withdrawal with the service role. It prefers the auditable
 * soft-cancel (status='cancelled'), and falls back to deleting the still-pending row while
 * migration 20260918110000 has not been applied yet. Either way it records an audit_log
 * entry, so the withdrawal stays traceable.
 */
export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const id = body?.id;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const admin = getAdminClient();

  // Resolve the caller's own profile the same way current_profile_id() does: by the linked
  // auth user, then by the verified email (a freshly provisioned profile may not be linked).
  let profileId: string | null = null;
  const byAuth = await admin.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (byAuth.data?.id) profileId = byAuth.data.id;
  if (!profileId && user.email) {
    const byEmail = await admin.from('profiles').select('id').ilike('work_email', user.email).maybeSingle();
    if (byEmail.data?.id) profileId = byEmail.data.id;
  }
  if (!profileId) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // Only the caller's own pending request is ever touched.
  const { data: row, error: readError } = await admin
    .from('remote_quota_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  if (!row || row.profile_id !== profileId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'Only a pending request can be withdrawn' }, { status: 409 });
  }

  const { data: cancelled, error: cancelError } = await admin
    .from('remote_quota_requests')
    .update({ status: 'cancelled', decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('profile_id', profileId)
    .eq('status', 'pending')
    .select('id');

  let mode: 'cancelled' | 'deleted' = 'cancelled';
  let after: Record<string, unknown> | null = { ...row, status: 'cancelled' };

  if (cancelError || !cancelled || cancelled.length === 0) {
    const { data: deleted, error: deleteError } = await admin
      .from('remote_quota_requests')
      .delete()
      .eq('id', id)
      .eq('profile_id', profileId)
      .eq('status', 'pending')
      .select('id');
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'The request was not cancelled' }, { status: 409 });
    }
    mode = 'deleted';
    after = null;
  }

  await admin.from('audit_log').insert({
    actor_profile_id: profileId,
    action: mode === 'cancelled' ? 'quota_request_withdrawn' : 'quota_request_withdrawn_deleted',
    table_name: 'remote_quota_requests',
    row_id: id,
    before_data: row,
    after_data: after,
  });

  return NextResponse.json({ ok: true, mode });
}
