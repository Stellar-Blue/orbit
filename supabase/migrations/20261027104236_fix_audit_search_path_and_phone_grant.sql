-- ==============================================================================
-- Two controls that had drifted in the live database.
--
-- 1. audit_trigger_func is SECURITY DEFINER with no pinned search_path and inserts
--    into an unqualified `audit_log`. pg_temp is searched before public for relations,
--    so any signed-in user could create a temp table named audit_log and divert the
--    audit row for their own write (verified: an employee insert into leave_requests
--    landed in pg_temp.audit_log and never reached public.audit_log). Pinning
--    `search_path = public, pg_temp` makes the unqualified name resolve to the real
--    table again.
--
-- 2. 20260917120000 revoked table-level SELECT on profiles so that `phone` became
--    admin/self-only, read through the profile_phones view. The live database still
--    carries table-level SELECT plus the phone column grant, so every employee can
--    read every colleague's number straight from /rest/v1/profiles (verified: 12 of
--    15 rows readable by an employee). Re-apply the revoke and grant every column
--    except phone, so columns added later are still readable.
--
-- At this point profile_phones is still a SECURITY DEFINER view (phone is not selectable
-- through the table for authenticated, so an invoker view would break the admin/self
-- feature). 20261027104737 replaces it with a row-level-secured table.
-- ==============================================================================

ALTER FUNCTION public.audit_trigger_func() SET search_path = public, pg_temp;

DO $$
DECLARE
    v_cols TEXT;
BEGIN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'profiles'
       AND column_name <> 'phone';

    EXECUTE 'REVOKE SELECT ON public.profiles FROM authenticated';
    EXECUTE format('GRANT SELECT (%s) ON public.profiles TO authenticated', v_cols);
END $$;
