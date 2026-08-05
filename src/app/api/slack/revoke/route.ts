import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { deleteVaultSecret, getAdminClient, slackTokenSecretName } from '@/lib/integrations/server';

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

  const admin = getAdminClient();
  const now = new Date().toISOString();

  await admin.from('employee_integrations').update({
    status: 'revoked',
    revoked_at: now,
    token_ref: null,
    last_set_status_text: null,
    last_set_status_emoji: null,
    last_set_expiration_ts: null,
  }).eq('profile_id', profile.id).eq('provider', 'slack');

  await admin.from('profiles').update({ onboarding_completed_at: null }).eq('id', profile.id);

  await deleteVaultSecret(admin, slackTokenSecretName(profile.id));

  await admin.from('audit_log').insert({
    action: 'integration_revoked',
    table_name: 'employee_integrations',
    actor_profile_id: profile.id,
    after_data: { provider: 'slack' },
  });

  return NextResponse.json({ ok: true });
}
