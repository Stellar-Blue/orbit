import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';

/**
 * Admin control over which users must connect Slack.
 * GET  → list of active profiles with their current slack_required flag + connection state.
 * POST → set slack_required for a single profile (admin only, audited).
 */
export async function GET(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getAdminClient();
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, first_name, last_name, work_email, employment_type, slack_required, onboarding_completed_at, status')
    .eq('status', 'active')
    .order('first_name', { ascending: true });

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
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
