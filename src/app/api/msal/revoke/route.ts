import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/integrations/server';
import { deleteMsalTokens } from '@/lib/integrations/msal';

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
  await admin.from('employee_integrations').update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('profile_id', profile.id).eq('provider', 'm365');
  await deleteMsalTokens(admin, profile.id);

  return NextResponse.json({ ok: true });
}
