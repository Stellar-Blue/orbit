-- ==============================================================================
-- Company calendar: who is away, visible to everyone.
--
-- 0063 narrowed policy_leave_select and remote_days to own rows, so the company
-- calendar could only draw the viewer's own leave and remote days. The grid needs
-- colleagues' dates but not what is behind them, so it reads this projection:
-- dates, status and remote mode only — never reason, note, document, half-day or
-- Ergani state.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.company_calendar(p_from DATE, p_to DATE)
RETURNS TABLE (
    kind TEXT,
    profile_id UUID,
    leave_request_id UUID,
    start_date DATE,
    end_date DATE,
    mode TEXT,
    location TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 'leave'::TEXT,
           lr.profile_id,
           lr.id,
           lr.start_date,
           lr.end_date,
           NULL::TEXT,
           NULL::TEXT
    FROM public.leave_requests lr
    WHERE lr.origin <> 'mandatory'
      AND lr.status IN ('approved', 'in_progress', 'taken')
      AND lr.start_date <= p_to
      AND lr.end_date >= p_from
    UNION ALL
    SELECT 'remote'::TEXT,
           rd.profile_id,
           NULL::UUID,
           rd.date,
           rd.date,
           rd.mode,
           rd.location
    FROM public.remote_days rd
    WHERE rd.mode <> 'office'
      AND rd.date BETWEEN p_from AND p_to;
$$;

REVOKE ALL ON FUNCTION public.company_calendar(DATE, DATE) FROM PUBLIC;
-- Supabase grants EXECUTE on new functions to anon through default privileges, which a plain
-- REVOKE FROM PUBLIC leaves in place. Unauthenticated callers must not read attendance.
REVOKE ALL ON FUNCTION public.company_calendar(DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.company_calendar(DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.company_calendar(DATE, DATE) IS
    'Company-wide leave and remote spans for the calendar grid. SECURITY DEFINER because RLS hides colleagues'' rows from non-admins; never returns reasons, notes or documents.';
