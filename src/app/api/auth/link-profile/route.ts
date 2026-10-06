import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Repair the caller's directory link: set `profiles.auth_user_id` to their Supabase auth id.
 *
 * The OAuth callback links this on sign-in, but only then — a session established before that
 * linking existed (10 of 15 directory profiles here) never gets linked, and every own-row
 * policy that still keys on `auth_user_id` alone reads nothing for them: payments, time entries,
 * contract timesheets, project assignments, profile self-edit. The app calls this once on load,
 * before its first data fetch, so the link is present for every subsequent read this session.
 *
 * Idempotent and conservative: it only ever links the profile whose `work_email` matches the
 * caller's verified JWT email, only when that row is still unlinked, and never touches a profile
 * already claimed by another auth user.
 */
export async function POST() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = user.email.toLowerCase();

  // Same directory scope the OAuth callback enforces. A non-company email can never match a
  // directory profile, but reject early rather than rely on that.
  if (!email.endsWith('@stellarblue.eu') && !email.endsWith('@stellarblue.gr')) {
    return NextResponse.json({ linked: false, reason: 'domain' });
  }

  const admin = getAdminClient();

  // Already linked to this auth user (the common, steady-state case): nothing to repair.
  const linked = await admin.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (linked.data?.id) {
    return NextResponse.json({ linked: true, profileId: linked.data.id, changed: false });
  }

  const byEmail = await admin
    .from('profiles')
    .select('id')
    .ilike('work_email', email)
    .limit(1)
    .maybeSingle();
  const profileId = byEmail.data?.id;
  if (!profileId) {
    return NextResponse.json({ linked: false, reason: 'no-profile' }, { status: 404 });
  }

  // `.is('auth_user_id', null)` is the race guard: if another request linked it in the meantime,
  // or it belongs to someone else, this matches zero rows and changes nothing.
  const { data: updated, error } = await admin
    .from('profiles')
    .update({ auth_user_id: user.id })
    .eq('id', profileId)
    .is('auth_user_id', null)
    .select('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const changed = !!updated?.length;
  return NextResponse.json({ linked: changed, profileId, changed });
}
