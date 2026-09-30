-- ==============================================================================
-- 0074: Automatic carry-over of unused leave into the next year.
--
-- `leave_entitlements` already stores `carried_over_days` per (employee, year), but nothing
-- ever calculated it — admins typed it by hand. This migration adds the policy knobs and the
-- one flag needed to keep automatic values from fighting manual ones.
--
-- Policy (singleton `leave_policy`):
--   max_carryover_days      NULL = uncapped (nothing is forfeited)
--                           0    = no carry-over at all
--                           N    = at most N days move to the next year
--   carryover_expiry_months NULL = carried days stay usable for the whole next year
--                           N    = they expire N months into the new year (3 = 31 March)
--
-- `leave_entitlements.carryover_is_manual` marks a carried-over value an admin typed
-- deliberately: the automatic calculation never overwrites those, the same way the mandatory
-- fan-out leaves `detached` rows alone.
--
-- NOTHING is auto-written here — the client derives the carry-over live (see
-- `getDerivedCarryover` in auth-context) and can materialise it on demand from
-- Settings → Leaves → "Recalculate carry-over".
-- ==============================================================================

ALTER TABLE public.leave_policy
  ADD COLUMN IF NOT EXISTS max_carryover_days NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS carryover_expiry_months INTEGER NULL;

ALTER TABLE public.leave_policy
  DROP CONSTRAINT IF EXISTS ck_leave_policy_max_carryover,
  ADD CONSTRAINT ck_leave_policy_max_carryover
    CHECK (max_carryover_days IS NULL OR max_carryover_days >= 0);

ALTER TABLE public.leave_policy
  DROP CONSTRAINT IF EXISTS ck_leave_policy_expiry_months,
  ADD CONSTRAINT ck_leave_policy_expiry_months
    CHECK (carryover_expiry_months IS NULL OR (carryover_expiry_months >= 1 AND carryover_expiry_months <= 12));

ALTER TABLE public.leave_entitlements
  ADD COLUMN IF NOT EXISTS carryover_is_manual BOOLEAN NOT NULL DEFAULT FALSE;

-- Rows that already carry a non-zero value were typed by an admin: protect them from the
-- first automatic run. Zeros stay recomputable (they are just the column default).
UPDATE public.leave_entitlements
SET carryover_is_manual = TRUE
WHERE carried_over_days <> 0 AND carryover_is_manual = FALSE;

COMMENT ON COLUMN public.leave_policy.max_carryover_days IS
    'Cap on days carried into the next year. NULL = uncapped, 0 = no carry-over.';
COMMENT ON COLUMN public.leave_policy.carryover_expiry_months IS
    'Months into the new year that carried days stay usable (3 = 31 March). NULL = never expires.';
COMMENT ON COLUMN public.leave_entitlements.carryover_is_manual IS
    'TRUE when an admin typed the carried-over value: the automatic carry-over calculation skips these rows.';
