-- Migration 0043: AADE myDATA sync communication log (for the helper/debug panel)
-- Non-sensitive metadata only: never store the aade-user-id, subscription key, AFMs, or raw payloads.
CREATE TABLE IF NOT EXISTS public.aade_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  detail TEXT NULL,
  mark BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aade_sync_logs_created ON public.aade_sync_logs (created_at DESC);

ALTER TABLE public.aade_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY aade_sync_logs_read ON public.aade_sync_logs FOR SELECT TO authenticated USING (true);
