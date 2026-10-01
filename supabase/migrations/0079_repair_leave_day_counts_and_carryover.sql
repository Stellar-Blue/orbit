-- ==============================================================================
-- 0079: Repair the leave rows whose stored day count is wrong, then re-materialise
--       the carry-over chain from the corrected usage.
--
-- WHY (reported 2026-10-01): "Papakis had 19 leaves in 2024, he got 14 of them, so he had to
-- carry over 5 to 2025. You calculated 11."
--
-- Both halves of that are right. His 2024 rows are:
--     29/03 → 02/04   stored 1   actually 3
--     19/06           stored 1   actually 1
--     12/08 → 19/08   stored 1   actually 5   (15 August is a holiday)
--     23/12 → 31/12   stored 5   actually 5
--     -------------------------------------------------
--     used            stored 8   actually 14
-- 19 granted − 14 used = 5 carried. The app deducted by the STORED 8, so it carried 19 − 8 = 11.
--
-- The rows are the pre-2026-09-15 broken counter: `audit_log` shows each was INSERTed once
-- (2026-09-07) with `working_days = 1` and never touched, while their ranges hold 3 and 5 working
-- days. Exactly the 8 rows left for a payroll decision in the 2026-09-30 note; the user has now
-- made that call, so they are repaired here.
--
-- TWO PARTS, in this order:
--   1. correct `working_days` on every personal leave row that disagrees with its own dates
--   2. re-materialise the carry-over chain, because the stored carry-in of a year is what the
--      balance of the NEXT year reads — repairing the usage without this leaves 2026 reading a 0
--      carried-in pot for the very employee the repair credited
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CORRECT THE DAY COUNTS
--
-- Target: the employee's scheduled weekdays inside the range, minus public holidays, minus company
-- closures — exactly `countWorkingDaysForProfile` (auth-context), i.e. what the app would compute
-- if the leave were filed today.
--
-- Guarded so it can never overwrite a deliberate decision (this is payroll data):
--   - only personal rows (`origin <> 'mandatory'`: closure rows are owned by the 0055/0076 fan-out,
--     which counts scheduled days minus holidays and would be misjudged by the rule above);
--   - never rejected/cancelled/expired (no balance reads them) and never detached;
--   - never a half-day row — the flags and the stored count are allowed to disagree;
--   - `created_at` before 2026-09-15: the window the broken counter wrote through;
--   - and no audit event ever CHANGED `working_days` on the row. An admin override shows up as an
--     UPDATE whose before/after differ, and that row is skipped. (This is why the repair is safe
--     even though it is not a lower-only fix like 0078's: it only ever touches rows nobody has
--     adjusted.)
-- ------------------------------------------------------------------------------
WITH corrected AS (
    SELECT lr.id,
           lr.note,
           lr.working_days AS stored_days,
           (SELECT count(*)
              FROM generate_series(lr.start_date::TIMESTAMP, lr.end_date::TIMESTAMP, INTERVAL '1 day') g
             WHERE (ARRAY['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[extract(dow FROM g)::INT + 1] =
                   ANY (COALESCE(NULLIF(p.work_schedule, ARRAY[]::TEXT[]), ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri']::TEXT[]))
               AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.date = g::DATE)
               AND NOT EXISTS (
                   SELECT 1 FROM public.mandatory_leaves m
                   WHERE m.status <> 'cancelled' AND g::DATE BETWEEN m.start_date AND m.end_date
               )
           ) AS correct_days
    FROM public.leave_requests lr
    JOIN public.profiles p ON p.id = lr.profile_id
    WHERE lr.origin <> 'mandatory'
      AND COALESCE(lr.detached, FALSE) = FALSE
      AND lr.status NOT IN ('rejected', 'cancelled', 'expired')
      AND lr.half_day_start = FALSE
      AND lr.half_day_end = FALSE
      AND lr.created_at < '2026-09-15'
      AND NOT EXISTS (
          SELECT 1 FROM public.audit_log a
          WHERE a.table_name = 'leave_requests'
            AND a.row_id = lr.id
            AND a.action = 'UPDATE'
            AND (a.after_data ->> 'working_days') IS DISTINCT FROM (a.before_data ->> 'working_days')
      )
)
UPDATE public.leave_requests lr
SET working_days = c.correct_days,
    note = COALESCE(lr.note || ' ', '') || '[auto: day count corrected against the leave dates]'
FROM corrected c
WHERE lr.id = c.id
  AND c.stored_days <> c.correct_days;

-- ------------------------------------------------------------------------------
-- 2. RE-MATERIALISE THE CARRY-OVER CHAIN
--
-- A port of `planLeaveCarryover` + `syncLeaveCarryover` (auth-context) — same walk, same maths —
-- run once here because the repair above changed a closed year's usage and therefore every pot
-- derived from it. Afterwards Settings → Leaves → Carry-Over Recalculation previews 0 changes.
--
--   derived(y) = clamp( entitlement(y-1) + carryIn(y-1) − used(y-1) )
--   carryIn(y-1) = the row's stored value, UNLESS the row is automatic and this run already wrote
--                  it — which is why the loop walks years ASCENDING and re-reads the table: one
--                  pass settles the whole chain instead of needing a second run.
--   used(y)     = the first `working_days` qualifying days of each row that fall in that year
--                 (a range straddling 31 December is split by year, not attributed to its start).
--
-- Skipped, exactly like the app: rows flagged `carryover_is_manual`, and any year whose PRECEDING
-- year has no entitlement row (the chain starts where explicit setup starts — otherwise everybody
-- would carry over the company default from years nobody granted).
--
-- NOT ported: the app also zeroes a pot that has expired for the CURRENT year. The policy sets no
-- due date (`carryover_expiry_months IS NULL`), so there is nothing to zero; set a due date and let
-- the app's own run own that rule.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_current_year   INT := extract(year FROM current_date)::INT;
    v_cap            NUMERIC;
    v_default        NUMERIC;
    v_expiry_months  INT;
    v_expires        DATE;
    v_min_year       INT;
    v_prev_ent       NUMERIC;
    v_prev_carry     NUMERIC;
    v_prev_used      NUMERIC;
    v_derived        NUMERIC;
    v_p              RECORD;
    v_y              INT;
    v_existing       RECORD;
BEGIN
    SELECT max_carryover_days, default_annual_days, carryover_expiry_months
      INTO v_cap, v_default, v_expiry_months
      FROM public.leave_policy
     LIMIT 1;

    -- Usage per (employee, year), mirroring `deductedDaysInYear`: the deducted days are the FIRST
    -- `working_days` qualifying days of the range. Personal leave skips closure days; closure rows
    -- skip holidays. Rows whose leave type does not count against the balance are ignored, exactly
    -- as `computeBalance` ignores them.
    DROP TABLE IF EXISTS _usage;
    CREATE TEMP TABLE _usage AS
    WITH slots AS (
        SELECT lr.id,
               lr.profile_id,
               lr.origin,
               lr.working_days,
               g::DATE AS d,
               row_number() OVER (PARTITION BY lr.id ORDER BY g) AS rn
        FROM public.leave_requests lr
        JOIN public.profiles pr ON pr.id = lr.profile_id
        JOIN public.leave_types lt ON lt.id = lr.leave_type_id
        CROSS JOIN LATERAL generate_series(lr.start_date::TIMESTAMP, lr.end_date::TIMESTAMP, INTERVAL '1 day') g
        WHERE COALESCE(lr.detached, FALSE) = FALSE
          AND lr.status IN ('approved', 'in_progress', 'taken', 'cancellation_requested')
          AND COALESCE(lt.counts_against_balance, TRUE) = TRUE
          AND (ARRAY['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[extract(dow FROM g)::INT + 1] =
                ANY (COALESCE(NULLIF(pr.work_schedule, ARRAY[]::TEXT[]), ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri']::TEXT[]))
          AND CASE WHEN lr.origin = 'mandatory'
                   THEN NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.date = g::DATE)
                   ELSE NOT EXISTS (
                       SELECT 1 FROM public.mandatory_leaves m
                       WHERE m.status <> 'cancelled' AND g::DATE BETWEEN m.start_date AND m.end_date
                   )
              END
    )
    SELECT profile_id,
           extract(year FROM d)::INT AS year,
           count(*) FILTER (WHERE origin <> 'mandatory' AND rn <= working_days) AS taken,
           count(*) FILTER (WHERE origin = 'mandatory') AS mand
    FROM slots
    GROUP BY 1, 2;
    CREATE INDEX ON _usage (profile_id, year);

    FOR v_p IN
        SELECT DISTINCT e.profile_id
        FROM public.leave_entitlements e
        JOIN public.profiles pr ON pr.id = e.profile_id
        WHERE pr.status = 'active' AND pr.employment_type <> 'contractor'
    LOOP
        SELECT min(year) INTO v_min_year FROM public.leave_entitlements WHERE profile_id = v_p.profile_id;

        FOR v_y IN (v_min_year + 1)..v_current_year LOOP
            SELECT * INTO v_existing
            FROM public.leave_entitlements
            WHERE profile_id = v_p.profile_id AND year = v_y;

            IF FOUND AND v_existing.carryover_is_manual THEN
                CONTINUE;
            END IF;
            -- The chain starts where explicit setup starts, and walks forward from there.
            IF NOT EXISTS (SELECT 1 FROM public.leave_entitlements WHERE profile_id = v_p.profile_id AND year = v_y - 1) THEN
                CONTINUE;
            END IF;

            -- Re-read: if this loop wrote v_y - 1 a moment ago, this is that fresh value.
            SELECT entitlement_days, carried_over_days
              INTO v_prev_ent, v_prev_carry
              FROM public.leave_entitlements
             WHERE profile_id = v_p.profile_id AND year = v_y - 1;

            SELECT COALESCE(taken, 0) + COALESCE(mand, 0)
              INTO v_prev_used
              FROM _usage
             WHERE profile_id = v_p.profile_id AND year = v_y - 1;
            v_prev_used := COALESCE(v_prev_used, 0);

            v_derived := GREATEST(0, COALESCE(v_prev_ent, v_default) + COALESCE(v_prev_carry, 0) - v_prev_used);
            IF v_cap IS NOT NULL THEN
                v_derived := LEAST(v_derived, v_cap);
            END IF;

            v_expires := CASE
                             WHEN v_expiry_months IS NULL THEN NULL
                             ELSE (date_trunc('month', make_date(v_y, 1, 1)) + (v_expiry_months || ' months')::INTERVAL - INTERVAL '1 day')::DATE
                         END;

            INSERT INTO public.leave_entitlements
                (profile_id, year, entitlement_days, carried_over_days, carryover_expires_on, carryover_is_manual)
            VALUES
                (v_p.profile_id, v_y, COALESCE(v_existing.entitlement_days, v_default), v_derived, v_expires, FALSE)
            ON CONFLICT (profile_id, year) DO UPDATE
               SET carried_over_days = EXCLUDED.carried_over_days,
                   carryover_expires_on = EXCLUDED.carryover_expires_on;
        END LOOP;
    END LOOP;

    DROP TABLE IF EXISTS _usage;
END $$;
