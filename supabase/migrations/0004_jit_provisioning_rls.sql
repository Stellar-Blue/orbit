-- ==============================================================================
-- 0004_jit_provisioning_rls.sql
-- Enable automatic Just-In-Time (JIT) employee provisioning during OAuth SSO
-- ==============================================================================

-- Allow authenticated users to insert their own profile during JIT onboarding
DROP POLICY IF EXISTS policy_profiles_jit_insert ON profiles;
CREATE POLICY policy_profiles_jit_insert ON profiles 
FOR INSERT TO authenticated 
WITH CHECK (auth_user_id = auth.uid() OR work_email = (auth.jwt() ->> 'email'));

-- Allow users to update their own profile (to link auth_user_id) during JIT onboarding
DROP POLICY IF EXISTS policy_profiles_jit_update ON profiles;
CREATE POLICY policy_profiles_jit_update ON profiles 
FOR UPDATE TO authenticated 
USING (work_email = (auth.jwt() ->> 'email') OR auth_user_id = auth.uid());

-- Allow users to insert their initial user_roles during JIT onboarding
DROP POLICY IF EXISTS policy_user_roles_jit_insert ON user_roles;
CREATE POLICY policy_user_roles_jit_insert ON user_roles 
FOR INSERT TO authenticated 
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = user_roles.profile_id AND (auth_user_id = auth.uid() OR work_email = (auth.jwt() ->> 'email'))));
