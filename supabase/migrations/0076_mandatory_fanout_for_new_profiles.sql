-- ==============================================================================
-- 0076: New employees must inherit the company's mandatory closures.
--
-- `syncMandatoryFanout` (client, auth-context) fans a closure out to everybody eligible, but it
-- only runs when a closure is PUBLISHED, when one is edited, or when an admin presses
-- "Sync to All Employees". Anyone hired after publication therefore had no row at all — Elina
-- Douni (hired 26/08/2026) and Taxiarchis Tolis (28/09/2026) are missing the Christmas 2026
-- closure. Two hires, two missing deductions.
--
-- Fixing it on the client would mean remembering to call the sync from every creation path
-- (auth/callback JIT provisioning, People → Onboard New Person, any future import). Doing it in
-- the database covers all of them and cannot be skipped by a client-side bug.
--
-- The rules below mirror `syncMandatoryFanout` exactly — keep the two in step:
--   eligible  : active, not a contractor, employed during the closure
--   range     : max(closure start, profile start) → closure end
--   days      : the employee's scheduled weekdays in that range, minus public holidays
--   row       : approved / origin 'mandatory' / ergani not_required
--
-- Idempotent (one row per profile+closure, guarded by NOT EXISTS), so it is also safe to call as
-- a repair. The client sync keeps owning the parts SQL does not do: removing rows for people who
-- became ineligible, and patching drifted ones.
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
        WHERE m.status <> 'cancelled'
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
-- Supabase grants EXECUTE on new functions to anon by default; only signed-in users need this.
REVOKE ALL ON FUNCTION public.fanout_mandatory_leaves(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fanout_mandatory_leaves(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_fanout_mandatory_on_new_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.fanout_mandatory_leaves(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mandatory_fanout_on_profile ON public.profiles;
CREATE TRIGGER trg_mandatory_fanout_on_profile
    AFTER INSERT ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.trg_fanout_mandatory_on_new_profile();

COMMENT ON FUNCTION public.fanout_mandatory_leaves(UUID) IS
    'Give one employee a row for every published company closure they are eligible for. Idempotent. Mirrors syncMandatoryFanout in src/lib/auth-context.tsx — keep in step.';

-- ------------------------------------------------------------------------------
-- Repair: backfill the employees hired after each closure was published.
-- ------------------------------------------------------------------------------
SELECT count(*) AS rows_added_by_repair
FROM public.profiles p, LATERAL public.fanout_mandatory_leaves(p.id) AS added;
