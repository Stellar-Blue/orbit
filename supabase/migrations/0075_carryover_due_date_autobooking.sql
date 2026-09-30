-- ==============================================================================
-- 0075: Carry-over DUE DATE — warning window + last-minute automatic booking.
--
-- `leave_policy.carryover_expiry_months` (0074) already gives the carried-over pot a due date
-- per year (`leave_entitlements.carryover_expires_on`). This adds the two pieces the business
-- asked for around that deadline:
--
--   carryover_warning_months  How long before the deadline the employee is warned that the
--                             days must be used (default 3 months).
--   carryover_auto_book       When the days can no longer be taken by hand, book whatever is
--                             left on the remaining working days before the deadline, so the
--                             pot is not silently forfeited. Admin can switch it off.
--
-- `leave_requests.is_auto_carryover` marks the rows created by that automatic booking. It is
-- what makes the run idempotent, and it is deliberately a column of its own rather than a new
-- `origin` value: `origin` is checked and rendered all over the leave UI ("Admin Entry" …), so
-- extending it would ripple through the grids and exports for no gain.
-- ==============================================================================

ALTER TABLE public.leave_policy
  ADD COLUMN IF NOT EXISTS carryover_warning_months INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS carryover_auto_book BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.leave_policy
  DROP CONSTRAINT IF EXISTS ck_leave_policy_warning_months,
  ADD CONSTRAINT ck_leave_policy_warning_months
    CHECK (carryover_warning_months >= 0 AND carryover_warning_months <= 12);

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS is_auto_carryover BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.leave_policy.carryover_warning_months IS
    'Months before the carry-over deadline that the employee starts being warned. Default 3.';
COMMENT ON COLUMN public.leave_policy.carryover_auto_book IS
    'When true, an unused carried-over pot is booked automatically on the last working days before it expires.';
COMMENT ON COLUMN public.leave_requests.is_auto_carryover IS
    'TRUE for leave rows Orbit booked automatically to save an expiring carry-over pot (see syncCarryoverExpiryBookings).';
