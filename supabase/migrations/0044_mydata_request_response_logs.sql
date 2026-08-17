-- Migration 0044: capture full request/response of every myDATA REST API call.
-- Response bodies contain AFMs/VAT data, so reads are restricted to admins only.
ALTER TABLE public.aade_sync_logs
  ADD COLUMN IF NOT EXISTS method TEXT NULL,
  ADD COLUMN IF NOT EXISTS url TEXT NULL,
  ADD COLUMN IF NOT EXISTS request_headers TEXT NULL,
  ADD COLUMN IF NOT EXISTS response_status INT NULL,
  ADD COLUMN IF NOT EXISTS response_body TEXT NULL,
  ADD COLUMN IF NOT EXISTS duration_ms INT NULL;

-- Admin-only reads (request/response bodies carry counterparty AFMs)
DROP POLICY IF EXISTS aade_sync_logs_read ON public.aade_sync_logs;
CREATE POLICY aade_sync_logs_read ON public.aade_sync_logs
  FOR SELECT TO authenticated USING (is_admin());
