import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';

/**
 * Admin edit of a directory profile (team, employment type, status, start/end date, work
 * schedule, role permission flags…).
 *
 * 0063 revoked the table-wide UPDATE grant on `profiles` from `authenticated` and re-granted
 * only the columns an employee may change on their own row, so an admin write has to go
 * through the service role — same pattern as the Slack requirement toggle. Column grants are
 * role-wide, so widening them instead would hand employees back their own status/team/type.
 */
export async function POST(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { profile_id?: string; changes?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const profileId = body.profile_id;
  const changes = body.changes && typeof body.changes === 'object' ? body.changes : null;
  if (!profileId || !changes) {
    return NextResponse.json({ error: 'profile_id and changes are required' }, { status: 400 });
  }

  // Identity linkage is never editable here: `auth_user_id` binds the row to a signed-in
  // account, and changing `id` is nonsense.
  const clean = Object.fromEntries(
    Object.entries(changes).filter(([key]) => key !== 'id' && key !== 'auth_user_id' && key !== 'sensitive' && key !== 'team' && key !== 'role')
  );
  if (Object.keys(clean).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .update(clean)
    .eq('id', profileId)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    // 0 rows: bad id, or the admin client fell back to the anon key and RLS blocked the write.
    return NextResponse.json(
      { error: `No profile updated for id ${profileId}. Check the profile exists and SUPABASE_SERVICE_ROLE_KEY is set.` },
      { status: 500 }
    );
  }

  await admin.from('audit_log').insert({
    action: 'profile_updated',
    table_name: 'profiles',
    actor_profile_id: session.profileId,
    row_id: profileId,
    after_data: clean,
  });

  return NextResponse.json({ profile: data });
}
