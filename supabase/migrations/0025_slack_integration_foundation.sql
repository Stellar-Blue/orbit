-- 0025: Slack & Outlook Integration foundation (employee_integrations, exemptions, external refs, outbox, settings)

-- 1. Onboarding gate marker on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- 2. Per-user integration rows (Slack tokens are the only per-user secrets: token_ref -> vault secret id)
CREATE TABLE IF NOT EXISTS public.employee_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('slack', 'm365')),
  external_user_id TEXT,
  token_ref TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'revoked', 'skipped', 'exempt')),
  auto_reply_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  auto_reply_template TEXT,
  -- Last status Orbit set (used by the "never fight the human" rule)
  last_set_status_text TEXT,
  last_set_status_emoji TEXT,
  last_set_expiration_ts BIGINT,
  connected_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, provider)
);

-- 3. Admin-granted integration exemptions (time-boxed or permanent)
CREATE TABLE IF NOT EXISTS public.integration_exemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('slack', 'm365')),
  reason TEXT,
  granted_by UUID REFERENCES public.profiles(id),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_exemptions_profile_idx ON public.integration_exemptions (profile_id);

-- 4. External artifact refs (outlook events, auto-replies). Slack statuses are ephemeral and need no refs.
CREATE TABLE IF NOT EXISTS public.external_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('slack', 'm365')),
  orbit_kind TEXT NOT NULL CHECK (orbit_kind IN ('leave', 'remote', 'auto_reply', 'status')),
  orbit_id UUID NOT NULL,
  external_id TEXT,
  marker TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS external_refs_orbit_idx ON public.external_refs (provider, orbit_kind, orbit_id) WHERE deleted_at IS NULL;

-- 5. Generic integration outbox (generalized from the Attio outbox pattern)
CREATE TABLE IF NOT EXISTS public.integration_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('slack', 'm365')),
  operation TEXT NOT NULL,
  orbit_kind TEXT NOT NULL,
  orbit_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL UNIQUE,
  ordering_key TEXT NOT NULL DEFAULT '',
  attempts INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'skipped', 'failed', 'exception')),
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_outbox_pending_idx ON public.integration_outbox (status, next_retry_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS integration_outbox_ordering_idx ON public.integration_outbox (ordering_key, created_at) WHERE status IN ('pending', 'failed');

-- 6. Provider-level configuration (generic labels, emoji, toggles)
CREATE TABLE IF NOT EXISTS public.integration_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'slack' CHECK (provider IN ('slack', 'm365')),
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, key)
);

INSERT INTO public.integration_settings (provider, key, value, description) VALUES
  ('slack', 'leave_label', '"Out of office"', 'Generic label shown to colleagues for every leave type (privacy: type never leaves Orbit)'),
  ('slack', 'leave_emoji', '":palm_tree:"', 'Emoji used for approved leave statuses'),
  ('slack', 'remote_label', '"Working remotely"', 'Status text for remote days'),
  ('slack', 'remote_emoji', '":house:"', 'Emoji used for remote-day statuses'),
  ('slack', 'half_day_label', '"Out of office (afternoon)"', 'Status text for half-day leave'),
  ('m365', 'auto_reply_enabled', 'false', 'Master toggle for Outlook automatic replies'),
  ('m365', 'auto_reply_template_en', '"I am out of the office until {return_date}. For urgent matters contact {contact}."', 'Default English auto-reply template'),
  ('m365', 'auto_reply_template_gr', '"Είμαι εκτός γραφείου έως {return_date}. Για επείγοντα θέματα επικοινωνήστε με {contact}."', 'Default Greek auto-reply template')
ON CONFLICT (provider, key) DO NOTHING;

-- 7. Row Level Security
ALTER TABLE public.employee_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_exemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;

-- Employees read their own integration rows + exemptions (drives gate checks, banners)
CREATE POLICY policy_employee_integrations_own_read ON public.employee_integrations
  FOR SELECT TO authenticated USING (auth.uid() = profile_id);
CREATE POLICY policy_integration_exemptions_own_read ON public.integration_exemptions
  FOR SELECT TO authenticated USING (auth.uid() = profile_id);

-- Settings are readable by all authenticated users
CREATE POLICY policy_integration_settings_read ON public.integration_settings
  FOR SELECT TO authenticated USING (true);

-- external_refs and integration_outbox are server-side only (service role); no user policies.
-- Admin management (exemptions, exceptions, settings) goes through API routes with the service role.
