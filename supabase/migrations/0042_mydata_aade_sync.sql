-- Migration 0042: AADE myDATA issued-invoice import (RequestTransmittedDocs)
-- Tracks the durable AADE MARK cursor, stores raw transmitted docs + cancellations (audit/reconciliation),
-- and mirrors issued invoices into the invoices registry as AR (direction='outgoing', mark=AADE MARK).

-- 1. Sync state (single row; MARK is the durable AADE cursor)
CREATE TABLE IF NOT EXISTS public.aade_sync_state (
  id BIGINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_completed_mark BIGINT NOT NULL DEFAULT 0,
  last_success_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.aade_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. Raw transmitted documents (keep the AADE payload alongside normalised fields per the integration guide)
CREATE TABLE IF NOT EXISTS public.aade_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mark BIGINT NOT NULL UNIQUE,          -- AADE MARK = durable source identifier
  uid TEXT NULL,                        -- AADE document uid (traceability)
  issue_date DATE NULL,
  invoice_type_code TEXT NULL,          -- AADE invoice type code (e.g. 1.1)
  series TEXT NULL,
  aa TEXT NULL,                         -- sequential number
  receiver_vat_number TEXT NULL,
  currency TEXT NULL,
  net NUMERIC NULL,
  vat NUMERIC NULL,
  gross NUMERIC NULL,
  qr_url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'cancelled' (cancellation never deletes the record)
  raw_xml TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Cancellation records (cancellationMark -> invoiceMark)
CREATE TABLE IF NOT EXISTS public.aade_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_mark BIGINT NOT NULL,
  cancellation_mark BIGINT NOT NULL,
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_mark, cancellation_mark)
);

-- Fast lookup by AADE MARK on the invoices registry (idempotent import)
CREATE INDEX IF NOT EXISTS idx_invoices_mark ON public.invoices (mark);

ALTER TABLE public.aade_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aade_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aade_cancellations ENABLE ROW LEVEL SECURITY;

-- Readable by authenticated users; writes are service-role only through API routes (consistent with app RLS model)
CREATE POLICY aade_sync_state_read ON public.aade_sync_state FOR SELECT TO authenticated USING (true);
CREATE POLICY aade_documents_read ON public.aade_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY aade_cancellations_read ON public.aade_cancellations FOR SELECT TO authenticated USING (true);
