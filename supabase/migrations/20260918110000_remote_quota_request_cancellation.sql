-- Employees may withdraw (cancel) their own remote quota exception request while it is
-- still pending. Two things were in the way:
--   1. the status CHECK (0041) only allowed pending/approved/rejected;
--   2. the UPDATE policy from 0063 is admin-only, so an owner's update silently matched
--      zero rows.
-- Widening the CHECK keeps the withdrawal auditable (no hard delete), and the new policy
-- lets an owner move ONLY their own *pending* row to 'cancelled'. Approving/rejecting
-- stays admin-only — the WITH CHECK forbids any other resulting status.

ALTER TABLE public.remote_quota_requests
  DROP CONSTRAINT IF EXISTS remote_quota_requests_status_check;

ALTER TABLE public.remote_quota_requests
  ADD CONSTRAINT remote_quota_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

COMMENT ON COLUMN public.remote_quota_requests.status IS
  'pending | approved | rejected | cancelled (employee withdrew before a decision)';

DROP POLICY IF EXISTS policy_remote_quota_requests_withdraw ON public.remote_quota_requests;
CREATE POLICY policy_remote_quota_requests_withdraw ON public.remote_quota_requests
  FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id() AND status = 'pending')
  WITH CHECK (profile_id = public.current_profile_id() AND status = 'cancelled');
