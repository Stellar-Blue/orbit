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
  const { data: exemptions } = await admin
    .from('integration_exemptions')
    .select('*, profile:profiles!integration_exemptions_profile_id_fkey(id, first_name, last_name, work_email)')
    .order('created_at', { ascending: false })
    .limit(100);

  return NextResponse.json({ exemptions: exemptions || [] });
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { profile_id?: string; provider?: string; reason?: string; expires_at?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.profile_id || !body.provider) {
    return NextResponse.json({ error: 'profile_id and provider are required' }, { status: 400 });
  }

  const admin = getAdminClient();
  const expiresAt = body.expires_at ? new Date(body.expires_at).toISOString() : null;
  const { data, error } = await admin.from('integration_exemptions').insert({
    profile_id: body.profile_id,
    provider: body.provider,
    reason: body.reason || null,
    granted_by: session.profileId,
    expires_at: expiresAt,
  }).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from('audit_log').insert({
    action: 'integration_exemption_granted',
    table_name: 'integration_exemptions',
    actor_profile_id: session.profileId,
    row_id: data.id,
    after_data: { profile_id: body.profile_id, provider: body.provider, reason: body.reason, expires_at: expiresAt },
  });

  return NextResponse.json({ exemption: data });
}

export async function DELETE(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { error } = await admin.from('integration_exemptions').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from('audit_log').insert({
    action: 'integration_exemption_revoked',
    table_name: 'integration_exemptions',
    actor_profile_id: session.profileId,
    after_data: { exemption_id: id },
  });

  return NextResponse.json({ ok: true });
}
