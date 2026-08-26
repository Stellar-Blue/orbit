-- 0050: Per-user Slack requirement.
--
-- Replaces the blanket "Slack is mandatory for every gated employment type" gate
-- with an explicit per-profile flag that admins control. Admins now choose which
-- users must connect Slack; it is no longer mandatory for everyone.
--
-- Backfill preserves current behavior: everyone who was previously gated
-- (full_time / part_time / intern) stays required; contractors and anyone else
-- remain not required. The column defaults to FALSE so newly created profiles are
-- not forced to connect until an admin explicitly opts them in.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slack_required BOOLEAN NOT NULL DEFAULT false;

-- Preserve the existing mandatory set (one-time backfill of pre-existing rows).
UPDATE public.profiles
  SET slack_required = true
  WHERE employment_type IN ('full_time', 'part_time', 'intern')
    AND slack_required = false;

COMMENT ON COLUMN public.profiles.slack_required IS
  'Admin-controlled: when true, this user must connect Slack (onboarding gate + status mirroring). Admins choose per user; not mandatory by default.';
