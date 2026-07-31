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

  // 3. Directory Verification & Just-In-Time (JIT) Provisioning
  const { data: existingProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id, status, work_email, auth_user_id')
    .ilike('work_email', email)
    .single();

  let profile = existingProfile;

  // If user passed official domain verification but is not in profiles yet, automatically provision their profile
  if (profileError || !profile) {
    const fullName = (user.user_metadata?.name || user.user_metadata?.full_name || '').trim();
    let firstName = 'Team';
    let lastName = 'Member';

    if (fullName.includes(' ')) {
      const parts = fullName.split(' ');
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    } else {
      const emailPrefix = email.split('@')[0];
      if (emailPrefix.includes('.')) {
        const parts = emailPrefix.split('.');
        firstName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        lastName = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
      } else {
        firstName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
      }
    }

    const { data: createdProfile, error: createError } = await supabase
      .from('profiles')
      .insert({
        auth_user_id: user.id,
        first_name: firstName,
        last_name: lastName,
        name_el: `${firstName} ${lastName}`,
        work_email: email,
        title: 'Team Member',
        employment_type: 'full_time',
        start_date: new Date().toISOString().split('T')[0],
        status: 'active',
        work_schedule: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
      })
      .select('id, status, work_email, auth_user_id')
      .single();

    if (createError || !createdProfile) {
      console.error(`JIT employee profile provisioning failed for ${email}:`, createError);
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/login?error=UnprovisionedUser`);
    }

    const coreAdmins = ['zbampos@stellarblue.eu', 'gtsoumalis@stellarblue.eu', 'gchatzis@stellarblue.eu'];
    const rolesToInsert = coreAdmins.includes(email) 
      ? [{ profile_id: createdProfile.id, role: 'employee' }, { profile_id: createdProfile.id, role: 'admin' }]
      : [{ profile_id: createdProfile.id, role: 'employee' }];
      
    await supabase.from('user_roles').insert(rolesToInsert);

    profile = createdProfile;
  } else if (!profile.auth_user_id) {
    // Link Supabase auth user ID to the existing directory profile
    await supabase.from('profiles').update({ auth_user_id: user.id }).eq('id', profile.id);
  }

  if (profile.status !== 'active' && profile.status !== 'onboarding') {
    console.error(`Inactive employee sign-in blocked for: ${email} (status: ${profile.status})`);
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=InactiveAccount`);
  }

  // Authentication & authorization successful! Redirect into secure workspace.
  return NextResponse.redirect(`${origin}${next}`);
}
