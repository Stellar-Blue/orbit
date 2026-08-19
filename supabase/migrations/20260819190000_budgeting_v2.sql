-- Update budget_lines to support auto-generation sources

ALTER TABLE public.budget_lines
ADD COLUMN source_type TEXT DEFAULT 'manual' CHECK (source_type IN ('manual', 'contract', 'payroll')),
ADD COLUMN source_id UUID;

-- Since source_id might be duplicate for different months (e.g. same contract generating multiple months of lines)
-- we just leave it as an informative reference rather than a strict FK with unique constraint.
-- However, we should index it for faster drill-down queries.
CREATE INDEX idx_budget_lines_source_id ON public.budget_lines (source_id);
