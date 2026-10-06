import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveCallerProfileId } from '@/lib/supabase/caller';

/**
 * The caller's own confirmed (paid) payment rows.
 *
 * `policy_payments_employee_select` (0008) matches on `profiles.auth_user_id = auth.uid()`
 * alone, and several directory profiles still carry no `auth_user_id` — they predate the
 * callback's service-role link. Those employees read zero rows, so the "Confirmed Payment
 * History" grid renders empty even though their paid rows exist. Migration 20260918120000
 * moves the policy onto current_profile_id(); until it is applied this route reads the same
 * rows with the service role and returns ONLY the caller's own paid rows.
 */
export async function GET() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const profileId = await resolveCallerProfileId(admin, user);
  if (!profileId) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const { data, error } = await admin
    .from('payments')
    .select('*')
    .eq('profile_id', profileId)
    .eq('status', 'paid')
    .order('period', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ payments: data || [] });
}
