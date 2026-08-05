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

export function isNextResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}
