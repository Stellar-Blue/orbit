-- ==============================================================================
-- 0069: Coverage groups — "not everyone from the same group away at once".
--
-- A coverage group caps how many of its members may be OUT on the same calendar
-- day, separately for remote work and for leave:
--   max_remote_per_day  NULL = no remote cap
--   max_leave_per_day   NULL = no leave cap
--
-- A group is either
--   scope_type='team'   membership follows profiles.team_id (stays current when
--                       someone changes teams, so no membership rows are kept), or
--   scope_type='custom' membership is the hand-picked list in coverage_group_members.
--
-- Reads are open to every authenticated employee — the rule has to be visible to
-- the people it restricts. Writes are admin-only (matches 0057/0063 hardening).
--
-- Per-day load is exposed through coverage_load(), a SECURITY DEFINER aggregate,
-- because policy_leave_select / policy_remote_days_own from 0063 deliberately hide
-- colleagues' leave and remote rows from non-admins. Only per-day counts and the
-- names of the people away on that day leave the function — never leave reasons,
-- notes or documents.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.coverage_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('team', 'custom')),
    team_id UUID NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    max_remote_per_day INTEGER NULL CHECK (max_remote_per_day IS NULL OR max_remote_per_day >= 0),
    max_leave_per_day INTEGER NULL CHECK (max_leave_per_day IS NULL OR max_leave_per_day >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- One rule per team. Multiple custom groups stay allowed (team_id IS NULL).
    CONSTRAINT uq_coverage_group_team UNIQUE (team_id),
    CONSTRAINT ck_coverage_group_scope CHECK (
        (scope_type = 'team' AND team_id IS NOT NULL)
        OR (scope_type = 'custom' AND team_id IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS public.coverage_group_members (
    group_id UUID NOT NULL REFERENCES public.coverage_groups(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_coverage_group_members_profile
    ON public.coverage_group_members(profile_id);

ALTER TABLE public.coverage_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_coverage_groups_select ON public.coverage_groups;
DROP POLICY IF EXISTS policy_coverage_groups_admin ON public.coverage_groups;
CREATE POLICY policy_coverage_groups_select ON public.coverage_groups
    FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_coverage_groups_admin ON public.coverage_groups
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS policy_coverage_group_members_select ON public.coverage_group_members;
DROP POLICY IF EXISTS policy_coverage_group_members_admin ON public.coverage_group_members;
CREATE POLICY policy_coverage_group_members_select ON public.coverage_group_members
    FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_coverage_group_members_admin ON public.coverage_group_members
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS trg_audit_coverage_groups ON public.coverage_groups;
CREATE TRIGGER trg_audit_coverage_groups
    BEFORE INSERT OR UPDATE OR DELETE ON public.coverage_groups
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ------------------------------------------------------------------------------
-- coverage_load: per-day absence load for one group.
--
-- Counts are inclusive of the caller (an employee already remote/on leave on that
-- day is inside the count), so callers subtract themselves before adding a day.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coverage_load(
    p_group_id UUID,
    p_from DATE,
    p_to DATE
)
RETURNS TABLE (
    day DATE,
    remote_count INTEGER,
    leave_count INTEGER,
    remote_names TEXT,
    leave_names TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_scope TEXT;
    v_team UUID;
    v_members UUID[];
BEGIN
    SELECT cg.scope_type, cg.team_id INTO v_scope, v_team
    FROM public.coverage_groups cg
    WHERE cg.id = p_group_id AND cg.active;

    IF v_scope IS NULL THEN
        RETURN;
    END IF;

    IF v_scope = 'team' THEN
        SELECT array_agg(p.id) INTO v_members FROM public.profiles p WHERE p.team_id = v_team;
    ELSE
        SELECT array_agg(m.profile_id) INTO v_members
        FROM public.coverage_group_members m WHERE m.group_id = p_group_id;
    END IF;

    IF v_members IS NULL OR cardinality(v_members) = 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT d.day,
           COALESCE(r.cnt, 0)::INTEGER,
           COALESCE(l.cnt, 0)::INTEGER,
           r.names,
           l.names
    FROM (
        SELECT (generate_series(p_from::TIMESTAMP, p_to::TIMESTAMP, INTERVAL '1 day'))::DATE AS day
    ) d
    LEFT JOIN LATERAL (
        SELECT count(DISTINCT rd.profile_id) AS cnt,
               string_agg(DISTINCT (p.first_name || ' ' || p.last_name), ', ') AS names
        FROM public.remote_days rd
        JOIN public.profiles p ON p.id = rd.profile_id
        WHERE rd.date = d.day
          AND rd.mode <> 'office'
          AND rd.profile_id = ANY(v_members)
    ) r ON TRUE
    LEFT JOIN LATERAL (
        SELECT count(DISTINCT lr.profile_id) AS cnt,
               string_agg(DISTINCT (p.first_name || ' ' || p.last_name), ', ') AS names
        FROM public.leave_requests lr
        JOIN public.profiles p ON p.id = lr.profile_id
        WHERE lr.profile_id = ANY(v_members)
          AND lr.origin <> 'mandatory'
          AND lr.status NOT IN ('rejected', 'cancelled', 'expired')
          AND d.day BETWEEN lr.start_date AND lr.end_date
    ) l ON TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.coverage_load(UUID, DATE, DATE) FROM PUBLIC;
-- Supabase adds `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ... TO anon` for new functions,
-- which a plain REVOKE FROM PUBLIC leaves in place. Unauthenticated callers must not be able
-- to read a group's absence counts, so drop that grant explicitly.
REVOKE ALL ON FUNCTION public.coverage_load(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.coverage_load(UUID, DATE, DATE) TO authenticated;

COMMENT ON TABLE public.coverage_groups IS
    'Coverage rule: at most N members of the group may be remote (and/or on leave) on the same day.';
COMMENT ON FUNCTION public.coverage_load(UUID, DATE, DATE) IS
    'Per-day remote/leave head-count for one coverage group. SECURITY DEFINER because RLS hides colleagues'' leave and remote rows from non-admins.';

-- ------------------------------------------------------------------------------
-- Leave coverage exceptions — the "request admin approval" path when a coverage
-- rule blocks a leave request (remote days reuse remote_quota_requests instead).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_exception_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES public.leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    working_days NUMERIC NOT NULL DEFAULT 0,
    note TEXT,
    reason TEXT,
    group_id UUID NULL REFERENCES public.coverage_groups(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    decided_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_leave_exception_requests_profile
    ON public.leave_exception_requests(profile_id, status);

ALTER TABLE public.leave_exception_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_leave_exception_select ON public.leave_exception_requests;
DROP POLICY IF EXISTS policy_leave_exception_insert ON public.leave_exception_requests;
DROP POLICY IF EXISTS policy_leave_exception_update ON public.leave_exception_requests;
DROP POLICY IF EXISTS policy_leave_exception_delete ON public.leave_exception_requests;
CREATE POLICY policy_leave_exception_select ON public.leave_exception_requests
    FOR SELECT TO authenticated
    USING (public.is_admin() OR profile_id = public.current_profile_id());
CREATE POLICY policy_leave_exception_insert ON public.leave_exception_requests
    FOR INSERT TO authenticated
    WITH CHECK (public.is_admin() OR profile_id = public.current_profile_id());
CREATE POLICY policy_leave_exception_update ON public.leave_exception_requests
    FOR UPDATE TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
CREATE POLICY policy_leave_exception_delete ON public.leave_exception_requests
    FOR DELETE TO authenticated
    USING (public.is_admin() OR (profile_id = public.current_profile_id() AND status = 'pending'));
