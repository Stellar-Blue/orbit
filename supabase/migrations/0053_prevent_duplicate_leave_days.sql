-- ==============================================================================
-- 0053: Guarantee NO duplicate leave days for the same employee.
--
-- (a) No two NON-mandatory leave requests may overlap for one employee, for any
--     status that occupies days (pending/approved/in_progress/taken/
--     cancellation_requested). Personal leave may still span a company mandatory
--     closure (existing design: balances clamp personal days inside closures).
-- (b) One fan-out row per employee per mandatory leave (blocks duplicate publishing).
-- (c) Two mandatory company closures may not overlap (prevents duplicate closure
--     days being fanned out to every employee).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.prevent_leave_overlap() RETURNS trigger AS $$
DECLARE
  conflict public.leave_requests%ROWTYPE;
BEGIN
  -- Rows that do not occupy days (or are being moved into a non-occupying state)
  -- never create a duplicate day.
  IF NEW.status IN ('rejected', 'cancelled', 'expired') THEN
    RETURN NEW;
  END IF;
  -- Mandatory fan-out rows mirror a company closure. Overlapping a personal leave is
  -- allowed; duplication inside ONE closure is blocked by the unique index below.
  IF NEW.origin = 'mandatory' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO conflict
  FROM public.leave_requests
  WHERE profile_id = NEW.profile_id
    AND id <> NEW.id
    AND origin <> 'mandatory'
    AND status NOT IN ('rejected', 'cancelled', 'expired')
    AND start_date <= NEW.end_date
    AND end_date >= NEW.start_date
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Duplicate leave days: overlaps existing leave % (% to %).', conflict.id, conflict.start_date, conflict.end_date;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_leave_overlap ON public.leave_requests;
CREATE TRIGGER trg_prevent_leave_overlap
  BEFORE INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_leave_overlap();

-- No employee can have two fan-out rows from the SAME mandatory leave.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_mandatory_fanout
  ON public.leave_requests (profile_id, mandatory_leave_id)
  WHERE mandatory_leave_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_mandatory_overlap() RETURNS trigger AS $$
DECLARE
  conflict public.mandatory_leaves%ROWTYPE;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO conflict
  FROM public.mandatory_leaves
  WHERE id <> NEW.id
    AND status <> 'cancelled'
    AND start_date <= NEW.end_date
    AND end_date >= NEW.start_date
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Overlapping company closure: "%" already covers % to % for everyone.', conflict.name, conflict.start_date, conflict.end_date;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_mandatory_overlap ON public.mandatory_leaves;
CREATE TRIGGER trg_prevent_mandatory_overlap
  BEFORE INSERT OR UPDATE ON public.mandatory_leaves
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mandatory_overlap();
