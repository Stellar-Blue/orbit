-- ==============================================================================
-- 0082: Store every leave inside ONE calendar year.
--
-- A leave of 31/12/2025 → 02/01/2026 used to be a single row carrying the whole 2-day total.
-- That made the next year look like it had lost a day to a closure it never owned, and it left
-- `working_days` ambiguous: the row's total belongs to two different entitlements.
--
-- orbit-leave-management-requirements.md §"Year-boundary split" already specifies the intended
-- shape — two linked rows, each deducting from its own year. The client did that only for the
-- employee request form; company-closure fan-out, admin entries and the DB fan-out all still
-- wrote one straddling row, and nothing ever repaired the rows already stored.
--
-- This migration:
--   1) widens the fan-out uniqueness from (profile, closure) to (profile, closure, YEAR);
--   2) teaches fanout_mandatory_leaves to emit one row per calendar year, linked;
--   3) splits every existing row that crosses 31 December, preserving its total day count and
--      linking the halves.
--
-- Day counts are distributed by walking the range from its start and taking the FIRST N
-- qualifying days (scheduled weekday, not a public holiday), which is exactly how the stored
-- total was produced — so `sum(halves) = original total` even for admin-adjusted rows.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1) Two rows per closure are now legal, as long as they are in different years.
-- ------------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uq_leave_mandatory_fanout;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_mandatory_fanout_year
  ON public.leave_requests (profile_id, mandatory_leave_id, (EXTRACT(YEAR FROM start_date)))
  WHERE mandatory_leave_id IS NOT NULL;

COMMENT ON INDEX public.uq_leave_mandatory_fanout_year IS
    'One fan-out row per employee per closure per calendar year — a closure straddling 31 December is stored as two linked rows (migration 0082).';

-- ------------------------------------------------------------------------------
-- 2) Fan-out emits one row per calendar year.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fanout_mandatory_leaves(p_profile_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile   public.profiles%ROWTYPE;
    v_closure   public.mandatory_leaves%ROWTYPE;
    v_schedule  TEXT[];
    v_start     DATE;
    v_year      INTEGER;
    v_seg_start DATE;
    v_seg_end   DATE;
    v_days      NUMERIC;
    v_inserted  INTEGER := 0;
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
        -- Clipped to the employee's start date.
        v_start := GREATEST(v_closure.start_date, v_profile.start_date);

        FOR v_year IN EXTRACT(YEAR FROM v_start)::INTEGER .. EXTRACT(YEAR FROM v_closure.end_date)::INTEGER LOOP
            v_seg_start := GREATEST(v_start, make_date(v_year, 1, 1));
            v_seg_end   := LEAST(v_closure.end_date, make_date(v_year, 12, 31));

            IF EXISTS (
                SELECT 1 FROM public.leave_requests lr
                WHERE lr.profile_id = v_profile.id
                  AND lr.mandatory_leave_id = v_closure.id
                  AND EXTRACT(YEAR FROM lr.start_date) = v_year
            ) THEN
                CONTINUE;
            END IF;

            SELECT count(*) INTO v_days
            FROM generate_series(v_seg_start::TIMESTAMP, v_seg_end::TIMESTAMP, INTERVAL '1 day') g
            WHERE (ARRAY['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[extract(dow FROM g)::INTEGER + 1]
                    = ANY (v_schedule)
              AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.date = g::DATE);

            CONTINUE WHEN v_days = 0;

            INSERT INTO public.leave_requests (
                profile_id, leave_type_id, start_date, end_date,
                half_day_start, half_day_end, working_days,
                status, origin, mandatory_leave_id, note, ergani_status
            ) VALUES (
                v_profile.id, v_closure.leave_type_id, v_seg_start, v_seg_end,
                FALSE, FALSE, v_days,
                'approved', 'mandatory', v_closure.id,
                'Company-wide mandatory leave: ' || v_closure.name, 'not_required'
            );
            v_inserted := v_inserted + 1;
        END LOOP;

        -- Keep the halves recognisable as one closure in the UI.
        WITH ordered AS (
            SELECT id,
                   row_number() OVER (ORDER BY start_date) AS rn,
                   count(*) OVER () AS n
            FROM public.leave_requests
            WHERE profile_id = v_profile.id AND mandatory_leave_id = v_closure.id
        )
        UPDATE public.leave_requests lr
           SET linked_request_id = nxt.id
          FROM ordered o
          JOIN ordered nxt ON nxt.rn = (o.rn % o.n) + 1
         WHERE lr.id = o.id
           AND o.n > 1
           AND lr.linked_request_id IS DISTINCT FROM nxt.id;
    END LOOP;

    RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.fanout_mandatory_leaves(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fanout_mandatory_leaves(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fanout_mandatory_leaves(UUID) TO authenticated;

COMMENT ON FUNCTION public.fanout_mandatory_leaves(UUID) IS
    'Give one employee a row per PUBLISHED company closure per calendar year they are eligible for, linked across a 31 December boundary. Idempotent. Mirrors syncMandatoryFanout in src/lib/auth-context.tsx — keep in step.';

-- ------------------------------------------------------------------------------
-- 3) Split the rows that already straddle 31 December.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    r           RECORD;
    v_year      INTEGER;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_count     NUMERIC;
    v_seg_start DATE;
    v_seg_end   DATE;
    v_seg_years INTEGER[];
    v_seg_days  NUMERIC[];
    v_new_id    UUID;
    v_ids       UUID[];
    v_is_closure BOOLEAN;
    v_scheduled TEXT[];
    i           INTEGER;
    v_split     INTEGER := 0;
BEGIN
    FOR r IN
        SELECT *
        FROM public.leave_requests
        WHERE start_date IS NOT NULL AND end_date IS NOT NULL
          AND end_date >= start_date
          AND EXTRACT(YEAR FROM start_date) <> EXTRACT(YEAR FROM end_date)
          AND COALESCE(detached, FALSE) = FALSE
          AND status NOT IN ('rejected', 'cancelled', 'expired')
    LOOP
        v_is_closure := r.origin = 'mandatory';
        SELECT COALESCE(NULLIF(p.work_schedule, ARRAY[]::TEXT[]), ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[])
          INTO v_scheduled
          FROM public.profiles p WHERE p.id = r.profile_id;
        v_scheduled := COALESCE(v_scheduled, ARRAY['Mon','Tue','Wed','Thu','Fri']::TEXT[]);

        v_remaining := COALESCE(r.working_days, 0);
        v_seg_years := ARRAY[]::INTEGER[];
        v_seg_days  := ARRAY[]::NUMERIC[];

        FOR v_year IN EXTRACT(YEAR FROM r.start_date)::INTEGER .. EXTRACT(YEAR FROM r.end_date)::INTEGER LOOP
            v_seg_start := GREATEST(r.start_date, make_date(v_year, 1, 1));
            v_seg_end   := LEAST(r.end_date, make_date(v_year, 12, 31));

            -- Qualifying days in this year: scheduled weekday, not a public holiday, and (for
            -- personal leave) not swallowed by a company closure the employee cannot book on.
            SELECT count(*) INTO v_count
            FROM generate_series(v_seg_start::TIMESTAMP, v_seg_end::TIMESTAMP, INTERVAL '1 day') g
            WHERE (ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[extract(dow FROM g)::INTEGER + 1]
                    = ANY (v_scheduled)
              AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.date = g::DATE)
              AND (
                    v_is_closure
                    OR (
                         NOT EXISTS (
                             SELECT 1 FROM public.mandatory_leaves m
                             WHERE g::DATE BETWEEN m.start_date AND m.end_date AND m.status = 'published'
                         )
                         AND NOT EXISTS (
                             SELECT 1 FROM public.leave_requests lr2
                             WHERE lr2.profile_id = r.profile_id
                               AND lr2.origin = 'mandatory'
                               AND g::DATE BETWEEN lr2.start_date AND lr2.end_date
                         )
                       )
                  );

            -- The stored total was the FIRST N qualifying days, so consume it in order.
            v_take := LEAST(v_count, v_remaining);
            v_remaining := v_remaining - v_take;

            v_seg_years := v_seg_years || v_year;
            v_seg_days  := v_seg_days || v_take;
        END LOOP;

        -- Nothing to split if only one year actually carries deducted days.
        IF (SELECT count(*) FROM unnest(v_seg_days) d WHERE d > 0) <= 1 THEN
            CONTINUE;
        END IF;

        v_ids := ARRAY[]::UUID[];

        FOR i IN 1 .. array_length(v_seg_years, 1) LOOP
            IF v_seg_days[i] <= 0 THEN
                CONTINUE;
            END IF;
            v_seg_start := GREATEST(r.start_date, make_date(v_seg_years[i], 1, 1));
            v_seg_end   := LEAST(r.end_date, make_date(v_seg_years[i], 12, 31));

            IF i = (SELECT min(j) FROM generate_subscripts(v_seg_days, 1) j WHERE v_seg_days[j] > 0) THEN
                UPDATE public.leave_requests
                   SET start_date = v_seg_start,
                       end_date   = v_seg_end,
                       working_days = v_seg_days[i]
                 WHERE id = r.id;
                v_ids := v_ids || r.id;
            ELSE
                INSERT INTO public.leave_requests (
                    profile_id, leave_type_id, start_date, end_date,
                    half_day_start, half_day_end, working_days,
                    status, origin, mandatory_leave_id, note, document_url,
                    ergani_status, detached, is_auto_carryover
                ) VALUES (
                    r.profile_id, r.leave_type_id, v_seg_start, v_seg_end,
                    FALSE, FALSE, v_seg_days[i],
                    r.status, r.origin, r.mandatory_leave_id, r.note, r.document_url,
                    r.ergani_status, FALSE, COALESCE(r.is_auto_carryover, FALSE)
                )
                RETURNING id INTO v_new_id;
                v_ids := v_ids || v_new_id;
            END IF;
        END LOOP;

        -- Link the halves both ways.
        FOR i IN 1 .. array_length(v_ids, 1) LOOP
            UPDATE public.leave_requests
               SET linked_request_id = v_ids[(i % array_length(v_ids, 1)) + 1]
             WHERE id = v_ids[i];
        END LOOP;

        v_split := v_split + 1;
    END LOOP;

    RAISE NOTICE 'Split % year-crossing leave(s) into per-year rows.', v_split;
END $$;
