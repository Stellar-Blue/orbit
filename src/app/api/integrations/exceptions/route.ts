import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';

export async function GET(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getAdminClient();

  const { data: outboxExceptions } = await admin
    .from('integration_outbox')
    .select('*')
    .eq('status', 'exception')
    .order('created_at', { ascending: false })
    .limit(50);

  const { data: revokedIntegrations } = await admin
    .from('employee_integrations')
    .select('*, profile:profiles(id, first_name, last_name, work_email)')
    .eq('provider', 'slack')
    .eq('status', 'revoked')
    .order('revoked_at', { ascending: false });

  const { count: notConnected } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .in('employment_type', ['full_time', 'part_time', 'intern'])
    .eq('status', 'active')
    .not('onboarding_completed_at', 'is', null);

  return NextResponse.json({
    exceptions: (outboxExceptions || []).map((e: { id: string; payload?: Record<string, unknown> | null; last_error?: string | null; created_at: string; orbit_kind: string; operation: string }) => ({
      id: e.id,
      type: 'outbox',
      profile_id: e.payload?.profile_id || null,
      reason: e.last_error,
      created_at: e.created_at,
      orbit_kind: e.orbit_kind,
      operation: e.operation,
    })),
    revoked: (revokedIntegrations || []).map((r: { id: string; profile_id: string; profile: { first_name: string; last_name: string } | null; revoked_at: string | null }) => ({
      id: r.id,
      profile_id: r.profile_id,
      profile_name: r.profile ? `${r.profile.first_name} ${r.profile.last_name}` : null,
      revoked_at: r.revoked_at,
    })),
    notConnectedCount: notConnected || 0,
  });
}
