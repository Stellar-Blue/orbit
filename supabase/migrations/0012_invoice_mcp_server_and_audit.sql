-- Migration 0012: Orbit Invoice MCP Server & Audit Traces
-- Description: Creates mcp_tool_calls and mcp_idempotency tables for AI Operator tool tracking, replay protection, and error distributions. Adds created_via field to invoices.

-- 1. Extend invoices table with created_via tracking column
ALTER TABLE IF EXISTS public.invoices
ADD COLUMN IF NOT EXISTS created_via text DEFAULT 'ui' CHECK (created_via IN ('ui', 'mcp', 'api'));

-- 2. Create MCP Idempotency store for exact request replay guarantees
CREATE TABLE IF NOT EXISTS public.mcp_idempotency (
    idempotency_key text PRIMARY KEY,
    tool_name text NOT NULL,
    response_body jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- 3. Create MCP Tool Calls log table for auditability and observability (§4)
CREATE TABLE IF NOT EXISTS public.mcp_tool_calls (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tool_name text NOT NULL,
    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    duration_ms integer NOT NULL DEFAULT 0,
    outcome_code text NOT NULL DEFAULT 'SUCCESS',
    idempotency_key text,
    error_details jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- 4. Create indexes for quick observability filtering and metrics calculation
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_tool_name ON public.mcp_tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_outcome ON public.mcp_tool_calls(outcome_code);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_created_at ON public.mcp_tool_calls(created_at DESC);

-- 5. Enable Row-Level Security (RLS)
ALTER TABLE public.mcp_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tool_calls ENABLE ROW LEVEL SECURITY;

-- 6. Define RLS policies (Admins have read/write access; users can only interact via authorized server sessions)
CREATE POLICY "Admins can view all mcp tool calls"
    ON public.mcp_tool_calls
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    ));

CREATE POLICY "Authenticated sessions can record mcp tool calls"
    ON public.mcp_tool_calls
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

CREATE POLICY "All authenticated sessions can inspect and write idempotency keys"
    ON public.mcp_idempotency
    FOR ALL
    USING (auth.role() = 'authenticated' OR auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- 7. Seed initial demonstrative MCP tool call history for observability dashboard
INSERT INTO public.mcp_tool_calls (tool_name, duration_ms, outcome_code, created_at)
VALUES 
    ('search_counterparties', 45, 'SUCCESS', now() - interval '2 days'),
    ('get_contracts', 62, 'SUCCESS', now() - interval '2 days'),
    ('get_billing_status', 38, 'SUCCESS', now() - interval '1 day'),
    ('create_invoice', 110, 'DUPLICATE_INVOICE', now() - interval '1 day'),
    ('create_invoice', 95, 'SUCCESS', now() - interval '12 hours'),
    ('upload_invoice_document', 240, 'SUCCESS', now() - interval '12 hours'),
    ('record_payment', 85, 'SUCCESS', now() - interval '4 hours'),
    ('create_invoice', 65, 'VALIDATION_ARITHMETIC', now() - interval '2 hours'),
    ('create_invoice', 90, 'SUCCESS', now() - interval '1 hour')
ON CONFLICT DO NOTHING;
