-- ==============================================================================
-- leave_requests: employees cancel their own request.
--
-- src/app/leave/page.tsx -> handleCancelLeaveRequest moves an employee's OWN row into one
-- of two states (see cancelLeaveRequest / requestLeaveCancellation in src/lib/auth-context.tsx):
--   * 'cancelled'              — a still-pending request is withdrawn immediately;
--   * 'cancellation_requested' — an upcoming approved request asks an admin to cancel it.
--
-- Two database facts stopped that from ever working, and the UI turned both into the
-- generic "Could not withdraw request" / "Could not request cancellation" toast:
--   1. the status CHECK (0001) only allowed pending/approved/rejected/cancelled, so writing
--      'cancellation_requested' was rejected outright;
--   2. the UPDATE policy either is admin-only or (0001) carries an implicit WITH CHECK that
--      forces the new row to stay 'pending', so an owner's withdraw matched zero rows.
--
-- Widening the CHECK to the full LeaveStatus set (src/lib/types.ts) keeps the marker
-- auditable rather than deleting the row, and the new policy lets an owner move ONLY their
-- own row into one of the two cancellation states. Approving/rejecting, editing and every
-- admin action are untouched.
-- ==============================================================================

-- 1. Accept every status the application can store.
ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_status_check;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_status_check
  CHECK (status IN (
    'pending',
    'approved',
    'rejected',
    'cancelled',
    'cancellation_requested',
    'in_progress',
    'taken',
    'expired'
  ));

-- 2. Accept the Ergani marker the cancellation flow writes. Approving a cancellation of a
--    request already submitted to Ergani flags it 'needs_amendment' (decideLeaveCancellation).
ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_ergani_status_check;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_ergani_status_check
  CHECK (ergani_status IN ('not_required', 'pending', 'submitted', 'needs_amendment'));

-- 3. Let an employee withdraw / request cancellation of their own row.
DROP POLICY IF EXISTS policy_leave_owner_cancel ON public.leave_requests;
CREATE POLICY policy_leave_owner_cancel ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id())
  WITH CHECK (
    profile_id = public.current_profile_id()
    AND status IN ('cancelled', 'cancellation_requested')
  );
