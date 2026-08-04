-- Migration: 0023_admin_user_management.sql
-- Description: Allow admins to manage user roles (user_roles) and delete people profiles
-- via a guarded stored procedure. Protects against admin lockout (last admin / self-demotion).

-- 0. Orbit manages a single role per user profile; make profile_id unique so
--    role updates can upsert cleanly (onConflict: profile_id).
ALTER TABLE user_roles
ADD CONSTRAINT uq_user_roles_profile_id UNIQUE (profile_id);

-- 1. Admin policy on user_roles (insert/update/delete roles)
DROP POLICY IF EXISTS policy_user_roles_admin ON user_roles;
CREATE POLICY policy_user_roles_admin ON user_roles
FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- 2. Guard trigger: never allow the removal of the LAST admin, nor self-demotion
CREATE OR REPLACE FUNCTION guard_admin_role_changes() RETURNS TRIGGER AS $$
DECLARE
    v_actor_profile_id UUID;
    v_remaining_admins BIGINT;
BEGIN
    -- Resolve the acting user's profile id (auth_user_id or work email match)
    SELECT p.id INTO v_actor_profile_id
    FROM profiles p
    WHERE p.auth_user_id = auth.uid() OR p.work_email = current_setting('request.jwt.claim.email', true)
    LIMIT 1;

    SELECT COUNT(*) INTO v_remaining_admins
    FROM user_roles
    WHERE role = 'admin'
      AND profile_id <> COALESCE(NEW.profile_id, OLD.profile_id);

    -- Block removal of the last admin (delete or demotion to non-admin)
    IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.role = 'admin' AND NEW.role <> 'admin')) THEN
        IF (OLD.role = 'admin' AND v_remaining_admins = 0) THEN
            RAISE EXCEPTION 'Refusing to remove the last admin from the organization. Promote another user to admin first.';
        END IF;
    END IF;

    -- Block self-demotion (actor removing their own admin role)
    IF (TG_OP = 'UPDATE' AND OLD.role = 'admin' AND NEW.role <> 'admin'
        AND OLD.profile_id = v_actor_profile_id AND v_actor_profile_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Admins cannot remove their own admin role. Have another admin promote/demote you instead.';
    END IF;

    -- Block self-deletion of admin role
    IF (TG_OP = 'DELETE' AND OLD.role = 'admin'
        AND OLD.profile_id = v_actor_profile_id AND v_actor_profile_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Admins cannot delete their own admin role.';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_admin_role_changes ON user_roles;
CREATE TRIGGER trg_guard_admin_role_changes
BEFORE UPDATE OR DELETE ON user_roles
FOR EACH ROW EXECUTE FUNCTION guard_admin_role_changes();

-- 3. Admin-only stored procedure to delete a person's profile.
--    Nulls out every NO ACTION reference (audit trail, ownership links, etc.)
--    so the profile can be removed; CASCADE FKs clean up dependent records
--    (leave requests, salary history, payments, entitlements, remote days...).
CREATE OR REPLACE FUNCTION admin_delete_profile(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_profile_id UUID;
    v_target_role TEXT;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Admin privileges required to delete profiles.';
    END IF;

    SELECT p.id INTO v_actor_profile_id
    FROM profiles p
    WHERE p.auth_user_id = auth.uid() OR p.work_email = current_setting('request.jwt.claim.email', true)
    LIMIT 1;

    IF v_actor_profile_id IS NULL THEN
        RAISE EXCEPTION 'Could not resolve acting user profile.';
    END IF;

    IF v_actor_profile_id = target_profile_id THEN
        RAISE EXCEPTION 'You cannot delete your own profile.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = target_profile_id) THEN
        RETURN FALSE;
    END IF;

    -- Last-admin guard (defense in depth, also enforced by trigger)
    SELECT role INTO v_target_role FROM user_roles WHERE profile_id = target_profile_id AND role = 'admin' LIMIT 1;
    IF v_target_role = 'admin' AND NOT EXISTS (
        SELECT 1 FROM user_roles WHERE role = 'admin' AND profile_id <> target_profile_id
    ) THEN
        RAISE EXCEPTION 'Refusing to delete the last admin from the organization.';
    END IF;

    -- Null out NO ACTION references so the profile row can be removed
    UPDATE profiles SET manager_id = NULL WHERE manager_id = target_profile_id;
    UPDATE teams SET lead_profile_id = NULL WHERE lead_profile_id = target_profile_id;
    UPDATE contracts SET owner_profile_id = NULL WHERE owner_profile_id = target_profile_id;
    UPDATE counterparties SET created_by = NULL WHERE created_by = target_profile_id;
    UPDATE invoices SET created_by = NULL WHERE created_by = target_profile_id;
    UPDATE invoice_documents SET uploaded_by = NULL WHERE uploaded_by = target_profile_id;
    UPDATE contract_documents SET uploaded_by = NULL WHERE uploaded_by = target_profile_id;
    UPDATE leave_requests SET decided_by = NULL WHERE decided_by = target_profile_id;
    UPDATE mandatory_leaves SET created_by = NULL WHERE created_by = target_profile_id;
    UPDATE ergani_imports SET uploaded_by = NULL WHERE uploaded_by = target_profile_id;
    UPDATE ergani_exceptions SET resolved_by = NULL WHERE resolved_by = target_profile_id;
    UPDATE audit_log SET actor_profile_id = NULL WHERE actor_profile_id = target_profile_id;
    UPDATE attio_links SET linked_by = NULL WHERE linked_by = target_profile_id;
    UPDATE mcp_tool_calls SET user_id = NULL WHERE user_id = target_profile_id;

    DELETE FROM profiles WHERE id = target_profile_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION admin_delete_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_delete_profile(UUID) TO authenticated;
