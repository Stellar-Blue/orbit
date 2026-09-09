-- ==============================================================================
-- 0055: Repair 2026 mandatory-leave fan-out.
-- The previous client fan-out was naive: it ignored whether the employee was
-- employed during the closure and hardcoded working_days (3 / part-time 2).
-- This re-syncs every PUBLISHED 2026 closure so that each eligible employee
-- (active, non-contractor, employed during the closure) has EXACTLY ONE approved
-- mandatory row whose working_days = their scheduled weekdays inside the range
-- that are not public holidays. Admin 'detached' manual corrections are preserved.
-- ==============================================================================

DO $$
DECLARE
  m RECORD;
  p RECORD;
  d DATE;
  wd INT;
  nm TEXT;
  ws TEXT[];
  names TEXT[] := ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  hols DATE[];
  row_count INT;
BEGIN
  SELECT COALESCE(array_agg(date), '{}'::date[]) INTO hols
  FROM public.public_holidays
  WHERE date BETWEEN '2026-01-01' AND '2026-12-31';

  FOR m IN
    SELECT * FROM public.mandatory_leaves
    WHERE status = 'published'
      AND start_date BETWEEN '2026-01-01' AND '2026-12-31'
  LOOP
    -- Remove rows for employees no longer eligible (preserve detached corrections).
    DELETE FROM public.leave_requests lr
    USING public.profiles pr
    WHERE lr.origin = 'mandatory'
      AND lr.mandatory_leave_id = m.id
      AND lr.profile_id = pr.id
      AND COALESCE(lr.detached, false) = false
      AND (pr.status <> 'active'
           OR pr.employment_type = 'contractor'
           OR pr.start_date > m.end_date
           OR (pr.end_date IS NOT NULL AND pr.end_date < m.start_date));

    FOR p IN
      SELECT * FROM public.profiles
      WHERE status = 'active'
        AND employment_type <> 'contractor'
        AND start_date <= m.end_date
        AND (end_date IS NULL OR end_date >= m.start_date)
    LOOP
      ws := COALESCE(p.work_schedule, ARRAY['Mon','Tue','Wed','Thu','Fri']::text[]);
      IF array_length(ws, 1) IS NULL THEN ws := ARRAY['Mon','Tue','Wed','Thu','Fri']::text[]; END IF;

      wd := 0;
      d := GREATEST(p.start_date, m.start_date);
      WHILE d <= m.end_date LOOP
        IF names[(EXTRACT(ISODOW FROM d))::int] = ANY (ws) AND NOT (d = ANY (hols)) THEN
          wd := wd + 1;
        END IF;
        d := d + 1;
      END LOOP;

      SELECT count(*) INTO row_count
      FROM public.leave_requests
      WHERE profile_id = p.id
        AND mandatory_leave_id = m.id
        AND origin = 'mandatory'
        AND COALESCE(detached, false) = false;

      nm := 'Company-wide mandatory leave: ' || m.name;

      IF row_count = 0 THEN
        INSERT INTO public.leave_requests
          (id, profile_id, leave_type_id, start_date, end_date,
           half_day_start, half_day_end, working_days, status, origin,
           mandatory_leave_id, note, ergani_status)
        VALUES
          (gen_random_uuid(), p.id, m.leave_type_id, GREATEST(p.start_date, m.start_date), m.end_date,
           false, false, wd, 'approved', 'mandatory',
           m.id, nm, 'not_required');
      ELSE
        UPDATE public.leave_requests SET
          working_days = wd,
          start_date = GREATEST(p.start_date, m.start_date),
          end_date = m.end_date,
          note = nm
        WHERE profile_id = p.id
          AND mandatory_leave_id = m.id
          AND origin = 'mandatory'
          AND COALESCE(detached, false) = false;
      END IF;
    END LOOP;
  END LOOP;
END $$;
