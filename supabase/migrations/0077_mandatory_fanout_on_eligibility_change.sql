-- ==============================================================================
-- 0077: Re-run the mandatory fan-out when an employee BECOMES eligible.
--
-- 0076 covers profile INSERT. The other way somebody ends up short is by starting to qualify
-- later: re-activated after a departure, switched from contractor to employee, or given a
-- start_date that moves them into a closure. `syncMandatoryFanout` (client) already reports this
-- as a real case — "use after hiring/reactivating employees" — but that needs an admin to press
-- the button.
--
-- Fires only when one of the columns that decide eligibility actually changes, so an ordinary
-- profile edit (photo, phone, team) does not pay for it. Adding rows is safe and idempotent;
-- REMOVING rows for somebody who stopped qualifying stays with the client sync, which knows to
-- leave admin-detached corrections alone.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.trg_fanout_mandatory_on_profile_eligibility()
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

DROP TRIGGER IF EXISTS trg_mandatory_fanout_on_profile_change ON public.profiles;
CREATE TRIGGER trg_mandatory_fanout_on_profile_change
    AFTER UPDATE OF status, employment_type, start_date, end_date, work_schedule ON public.profiles
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status
       OR OLD.employment_type IS DISTINCT FROM NEW.employment_type
       OR OLD.start_date IS DISTINCT FROM NEW.start_date
       OR OLD.end_date IS DISTINCT FROM NEW.end_date
       OR OLD.work_schedule IS DISTINCT FROM NEW.work_schedule)
    EXECUTE FUNCTION public.trg_fanout_mandatory_on_profile_eligibility();

-- Catch anything the UPDATE rule would have caught had it existed.
SELECT count(*) AS rows_added_by_eligibility_repair
FROM public.profiles p, LATERAL public.fanout_mandatory_leaves(p.id) AS added;
