import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Resolve the signed-in caller's OWN profile id exactly the way public.current_profile_id()
 * does: by the linked auth user first, then by the verified JWT email.
 *
 * A handful of directory profiles still carry no `auth_user_id` — they predate the callback's
 * service-role link — and any own-row policy that keys on `auth_user_id` alone returns nothing
 * for them. Server routes that must read such rows for the caller use this resolver instead.
 */
export async function resolveCallerProfileId(admin: SupabaseClient, user: User): Promise<string | null> {
  const byAuth = await admin.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (byAuth.data?.id) return byAuth.data.id;
  if (user.email) {
    const byEmail = await admin.from('profiles').select('id').ilike('work_email', user.email).maybeSingle();
    if (byEmail.data?.id) return byEmail.data.id;
  }
  return null;
}
