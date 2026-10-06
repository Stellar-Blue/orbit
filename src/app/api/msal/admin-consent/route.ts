import { NextRequest, NextResponse } from 'next/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';
import { hasMsalCredentials, msalAdminConsentUrl } from '@/lib/integrations/msal';

/**
 * Start tenant-wide Microsoft (Entra) admin consent for the Orbit Graph app.
 * Admin-only: the button lives in Settings → Integrations → Outlook, so non-admins
 * would never reach it — but the role is re-checked here too, in case the URL is hit
 * directly. The actual approval still requires an Entra admin (Global Administrator or
 * Privileged Role Administrator) on Microsoft's side; if the signed-in Orbit admin
 * lacks that role, Microsoft returns an error we surface back on the settings page.
 */
export async function GET(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) {
    return NextResponse.redirect(new URL('/settings?msalAdmin=no_session', request.url));
  }
  if (!session.isAdmin) {
    return NextResponse.redirect(new URL('/settings?msalAdmin=forbidden', request.url));
  }
  if (!hasMsalCredentials()) {
    return NextResponse.redirect(new URL('/settings?msalAdmin=not_configured', request.url));
  }

  const state = JSON.stringify({ admin_consent: true, profile_id: session.profileId, nonce: crypto.randomUUID() });
  const stateB64 = Buffer.from(state).toString('base64url');

  const url = msalAdminConsentUrl(stateB64, request.nextUrl.origin);
  if (!url) {
    return NextResponse.redirect(new URL('/settings?msalAdmin=not_configured', request.url));
  }

  const response = NextResponse.redirect(url);
  response.cookies.set('msal_oauth_state', stateB64, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return response;
}
