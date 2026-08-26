import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';

/**
 * Admin control over which users must connect Slack.
 * GET  → active profiles with their slack_required flag.
 * POST → set slack_required for a single profile (admin only, audited).
 */
export async function GET(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: profiles, error } = await getAdminClient()
    .from('profiles')
    .select('id, first_name, last_name, work_email, employment_type, slack_required, onboarding_completed_at, status')
    .eq('status', 'active')
    .order('first_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profiles: profiles || [] });
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { profile_id?: string; required?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.profile_id || typeof body.required !== 'boolean') {
    return NextResponse.json({ error: 'profile_id and required (boolean) are required' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .update({ slack_required: body.required })
    .eq('id', body.profile_id)
    .select('id, slack_required')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    // 0 rows: bad id, or the admin client fell back to the anon key and RLS blocked the write.
    return NextResponse.json(
      { error: `No profile updated for id ${body.profile_id}. Check the profile exists and SUPABASE_SERVICE_ROLE_KEY is set.` },
      { status: 500 }
    );
  }

  await admin.from('audit_log').insert({
    action: body.required ? 'slack_requirement_enabled' : 'slack_requirement_disabled',
    table_name: 'profiles',
    actor_profile_id: session.profileId,
    row_id: body.profile_id,
    after_data: { slack_required: body.required },
  });

  return NextResponse.json({ profile: data });
}
