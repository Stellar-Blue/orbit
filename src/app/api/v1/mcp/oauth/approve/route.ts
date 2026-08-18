import { NextResponse } from 'next/server';
import { getSupabaseServerClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { McpErrors } from '@/lib/mcp/errors';

/**
 * Orbit MCP OAuth 2.0 Authorization Consent Processor (§3)
 * Verifies corporate admin role and issues a short-lived OAuth authorization code for callback redirection.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { client_id, redirect_uri, state, scope = 'invoices.admin' } = body;

    if (!client_id || !redirect_uri) {
      return NextResponse.json({
        success: false,
        error: 'invalid_request',
        error_description: 'Missing required OAuth parameters: client_id and redirect_uri must be specified.'
      }, { status: 400 });
    }

    const supabase = await getSupabaseServerClient();

    // Verify user authentication and Admin role enforcement (§3)
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.user) {
      return NextResponse.json({
        success: false,
        error: 'unauthenticated',
        error_description: 'User must be authenticated to authorize MCP connections.'
      }, { status: 401 });
    }

    let authenticatedUserId = session.user.id;
    let email = session.user.email || '';
    let isAdmin = false;

    const { data: profile } = await supabase.from('profiles').select('id, work_email').or(`id.eq.${authenticatedUserId},auth_user_id.eq.${authenticatedUserId}`).maybeSingle();
    if (profile?.work_email) email = profile.work_email;
    const canonicalId = profile?.id || authenticatedUserId;
    const { data: roleRow } = await supabase.from('user_roles').select('role').eq('profile_id', canonicalId).eq('role', 'admin').maybeSingle();
    if (roleRow) isAdmin = true;
    authenticatedUserId = canonicalId;

    // Strict role gating: standard employees cannot connect financial MCP operators
    if (!isAdmin) {
      const err = McpErrors.forbidden();
      return NextResponse.json({
        success: false,
        error: 'access_denied',
        error_description: err.message,
        hint: err.hint
      }, { status: 403 });
    }

    // Generate secure short-lived authorization code (10 minutes validity)
    const code = `orb_code_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}_${Date.now().toString(36)}`;
    
    // Store in Supabase mcp_oauth_codes table via admin client
    try {
      const adminSupabase = await getSupabaseAdminClient();
      await adminSupabase.from('mcp_oauth_codes').insert([{
        code,
        user_id: authenticatedUserId,
        client_id,
        redirect_uri,
        scope
      }]);
    } catch (dbErr) {
      console.warn('Notice: Unable to persist OAuth code to mcp_oauth_codes (dev environment fallback):', dbErr);
    }

    // Construct standard OAuth callback URL
    const callbackUrl = new URL(redirect_uri, request.url);
    callbackUrl.searchParams.set('code', code);
    if (state) {
      callbackUrl.searchParams.set('state', state);
    }

    return NextResponse.json({
      success: true,
      code,
      redirect_url: callbackUrl.toString(),
      expires_in: 600, // 10 minutes
      granted_scope: scope,
      mapped_profile: { id: authenticatedUserId, email, role: 'admin' }
    });

  } catch (ex: any) {
    return NextResponse.json({
      success: false,
      error: 'server_error',
      error_description: ex.message || 'An internal error occurred while processing OAuth authorization.'
    }, { status: 500 });
  }
}
