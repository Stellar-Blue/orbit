import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';

const PROFILE_COLUMNS = 'id, first_name, last_name, work_email, employment_type, onboarding_completed_at, status';

/**
 * Admin control over which users must connect Slack.
 * GET  → active profiles with their slack_required flag, plus the authoritative
 *        Slack connection state for every profile. Both are read with the service
 *        role so RLS/column grants on employee_integrations can never blank them out.
 * POST → set slack_required for a single profile (admin only, audited).
 */
export async function GET(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getAdminClient();

  // slack_required may not exist yet if migration 0050 has not been applied to this
  // database — fall back to the base columns so the roster still lists everyone.
  type ProfileRow = Record<string, unknown> & { id: string; slack_required?: boolean };
  let slackRequiredAvailable = true;
  let profiles: ProfileRow[] = [];

  const primary = await admin
    .from('profiles')
    .select(`${PROFILE_COLUMNS}, slack_required`)
    .eq('status', 'active')
    .order('first_name', { ascending: true });

  // Only an actually-missing column justifies the degraded read (Postgres 42703 /
  // PostgREST PGRST204). Any other error is real and must surface, not be reported
  // as "everyone is Optional".
  const columnMissing = primary.error
    && (primary.error.code === '42703' || primary.error.code === 'PGRST204'
      || /slack_required/.test(primary.error.message || ''));

  if (primary.error && !columnMissing) {
    return NextResponse.json({ error: primary.error.message }, { status: 500 });
  }

  if (primary.error) {
    slackRequiredAvailable = false;
    const retry = await admin
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('status', 'active')
      .order('first_name', { ascending: true });
    if (retry.error) {
      return NextResponse.json({ error: retry.error.message }, { status: 500 });
    }
    profiles = (retry.data || []) as ProfileRow[];
  } else {
    profiles = (primary.data || []) as ProfileRow[];
  }

  // Authoritative connection state (never expose token_ref).
  const { data: integrations } = await admin
    .from('employee_integrations')
    .select('id, profile_id, provider, external_user_id, status, connected_at, last_synced_at, revoked_at')
    .eq('provider', 'slack');

  return NextResponse.json({
    profiles: profiles.map(p => ({ ...p, slack_required: !!p.slack_required })),
    integrations: integrations || [],
    slackRequiredAvailable,
  });
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
