import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const next = searchParams.get('next') ?? '/';

  if (errorParam || errorDescription) {
    const desc = encodeURIComponent(errorDescription || errorParam || 'Unknown OIDC error');
    return NextResponse.redirect(`${origin}/login?error=OAuthProviderError&error_description=${desc}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=MissingCode`);
  }

  const supabase = await getSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error('OAuth token exchange failure:', exchangeError);
    return NextResponse.redirect(`${origin}/login?error=ExchangeFailed`);
  }

  // Retrieve user to perform strict multi-layer security & tenancy checks
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=InvalidUser`);
  }

  const email = user.email.toLowerCase();

  // 1. Domain Enforcement: Must be an official @stellarblue.eu or @stellarblue.gr account
  if (!email.endsWith('@stellarblue.eu') && !email.endsWith('@stellarblue.gr')) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=InvalidDomain`);
  }

  // 2. Tenant (tid) Claim Validation: Prevent cross-tenant token spoofing
  const configuredTenantId = process.env.ENTRA_ID_TENANT_ID;
  if (configuredTenantId && configuredTenantId !== 'your-azure-tenant-id-guid') {
    // Check user metadata or identity data for the Entra ID tenant GUID claim ('tid')
    const tid =
      user.user_metadata?.tid ??
      user.app_metadata?.tid ??
      user.identities?.find((id) => id.provider.includes('azure'))?.identity_data?.tid;

    if (!tid || tid !== configuredTenantId) {
      console.error(`Rejected unauthorized Entra ID Tenant attempt: ${tid} vs expected ${configuredTenantId}`);
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/login?error=InvalidTenant`);
    }
  }

  // 3. Directory Verification: Only pre-provisioned active employee profiles are permitted access
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, status, work_email')
    .ilike('work_email', email)
    .single();

  if (profileError || !profile) {
    console.error(`Unprovisioned sign-in attempted by: ${email}`);
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=UnprovisionedUser`);
  }

  if (profile.status !== 'active' && profile.status !== 'onboarding') {
    console.error(`Inactive employee sign-in blocked for: ${email} (status: ${profile.status})`);
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=InactiveAccount`);
  }

  // Authentication & authorization successful! Redirect into secure workspace.
  return NextResponse.redirect(`${origin}${next}`);
}
