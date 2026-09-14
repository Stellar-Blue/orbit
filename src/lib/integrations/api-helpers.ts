import { NextRequest, NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export interface ApiSession {
  supabase: SupabaseClient;
  profileId: string;
  isAdmin: boolean;
}

export async function requireApiSession(request: NextRequest): Promise<ApiSession | NextResponse> {
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
  const { data: roleRows } = await supabase.from('user_roles').select('role').eq('profile_id', profile.id);
  return { supabase, profileId: profile.id, isAdmin: (roleRows || []).some(r => r.role === 'admin') };
}

/**
 * Cron routes are reachable from the internet: middleware.ts excludes /api/ from the
 * auth redirect. Returns null when the caller presented the right secret, otherwise the
 * response to send back. A missing CRON_SECRET is a misconfiguration, not a free pass.
 */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized & Invalid Cron Secret' }, { status: 401 });
  }
  return null;
}

export function isNextResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}
