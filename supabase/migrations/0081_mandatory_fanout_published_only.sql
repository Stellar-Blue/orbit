-- ==============================================================================
-- 0081: Only PUBLISHED company closures may deduct days.
--
-- 0076 excluded the 'cancelled' status only, so a DRAFT closure was still fanned out to every
-- newly created / re-activated employee (0076 + 0077 triggers) and silently ate their allowance.
-- The client sync (syncMandatoryFanout) only ever published, so the two sides disagreed on what
-- "active" means — the admin register could show 4 closures while a balance was deducted by
-- more (or fewer) of them.
--
-- 1) fanout_mandatory_leaves now fans out published closures only.
-- 2) Repair: drop the automatic rows that belong to draft / cancelled closures. Rows an admin
--    detached by hand are preserved, exactly like the client cleanup.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fanout_mandatory_leaves(p_profile_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile  public.profiles%ROWTYPE;
    v_closure  public.mandatory_leaves%ROWTYPE;
    v_schedule TEXT[];
    v_start    DATE;
    v_days     NUMERIC;
    v_inserted INTEGER := 0;
BEGIN
    SELECT * INTO v_profile FROM public.profiles WHERE id = p_profile_id;
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    IF v_profile.employment_type = 'contractor' OR v_profile.status <> 'active' THEN
        RETURN 0;
    END IF;

    v_schedule := COALESCE(
        NULLIF(v_profile.work_schedule, ARRAY[]::TEXT[]),
        ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri']::TEXT[]
    );

    FOR v_closure IN
        SELECT *
        FROM public.mandatory_leaves m
        WHERE m.status = 'published'
          AND v_profile.start_date <= m.end_date
          AND (v_profile.end_date IS NULL OR v_profile.end_date >= m.start_date)
    LOOP
        IF EXISTS (
            SELECT 1 FROM public.leave_requests lr
            WHERE lr.profile_id = v_profile.id AND lr.mandatory_leave_id = v_closure.id
        ) THEN
            CONTINUE;
        END IF;

        -- Clipped to the employee's start date, holidays excluded.
        v_start := GREATEST(v_closure.start_date, v_profile.start_date);
        SELECT count(*) INTO v_days
        FROM generate_series(v_start::TIMESTAMP, v_closure.end_date::TIMESTAMP, INTERVAL '1 day') g
        WHERE (ARRAY['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[extract(dow FROM g)::INTEGER + 1]
                = ANY (v_schedule)
          AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.date = g::DATE);

        INSERT INTO public.leave_requests (
            profile_id, leave_type_id, start_date, end_date,
            half_day_start, half_day_end, working_days,
            status, origin, mandatory_leave_id, note, ergani_status
        ) VALUES (
            v_profile.id, v_closure.leave_type_id, v_start, v_closure.end_date,
            FALSE, FALSE, v_days,
            'approved', 'mandatory', v_closure.id,
            'Company-wide mandatory leave: ' || v_closure.name, 'not_required'
        );
        v_inserted := v_inserted + 1;
    END LOOP;

    RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.fanout_mandatory_leaves(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fanout_mandatory_leaves(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fanout_mandatory_leaves(UUID) TO authenticated;

COMMENT ON FUNCTION public.fanout_mandatory_leaves(UUID) IS
    'Give one employee a row for every PUBLISHED company closure they are eligible for. Idempotent. Mirrors syncMandatoryFanout in src/lib/auth-context.tsx — keep in step.';

-- ------------------------------------------------------------------------------
-- Repair: automatic rows of closures that are not published any more.
-- ------------------------------------------------------------------------------
DELETE FROM public.leave_requests lr
USING public.mandatory_leaves m
WHERE lr.origin = 'mandatory'
  AND lr.mandatory_leave_id = m.id
  AND m.status <> 'published'
  AND COALESCE(lr.detached, false) = false;
