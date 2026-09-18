-- Project delivery details: lifecycle status, planned vs actual dates, day-based budget, plus
-- attachments and links (Linear issues, specs, client docs…).
--
-- Naming note: `projects.starts_on` / `ends_on` are the PLANNED window (they already existed);
-- the `actual_*` columns record what really happened.

-- 1. Status: add the delivery lifecycle (planned / in progress / done) without breaking existing rows.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('planned', 'in_progress', 'done', 'active', 'on_hold', 'completed', 'archived'));

COMMENT ON COLUMN public.projects.status IS
  'Delivery lifecycle: planned → in_progress → done (legacy values active/on_hold/completed/archived still accepted).';

-- 2. Actual dates + day budget (hours already exist in budget_hours).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS actual_start_on DATE,
  ADD COLUMN IF NOT EXISTS actual_end_on DATE,
  ADD COLUMN IF NOT EXISTS budget_days NUMERIC(10,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_actual_window_check') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_actual_window_check
      CHECK (actual_end_on IS NULL OR actual_start_on IS NULL OR actual_end_on >= actual_start_on);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_actual_after_planned_check') THEN
    -- Guards the obvious mistake of recording an actual start before the planned one.
    ALTER TABLE public.projects ADD CONSTRAINT projects_actual_after_planned_check
      CHECK (actual_start_on IS NULL OR starts_on IS NULL OR actual_start_on >= starts_on - INTERVAL '1 day');
  END IF;
END $$;

COMMENT ON COLUMN public.projects.starts_on IS 'Planned start date (the planned window lives in starts_on/ends_on).';
COMMENT ON COLUMN public.projects.ends_on IS 'Planned end date.';
COMMENT ON COLUMN public.projects.actual_start_on IS 'When work actually started.';
COMMENT ON COLUMN public.projects.actual_end_on IS 'When work actually finished (set when the project is done).';
COMMENT ON COLUMN public.projects.budget_days IS 'Effort budget in days, alongside budget_hours (kept in sync by the UI).';

-- 3. Links — mirrors the invoice_links table (title + url + optional kind hint).
CREATE TABLE IF NOT EXISTS public.project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT,
  url TEXT NOT NULL,
  kind TEXT, -- 'linear' | 'docs' | 'repo' | 'other' (icon hint only)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS project_links_project_idx ON public.project_links (project_id);

ALTER TABLE public.project_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_links_select ON public.project_links;
CREATE POLICY project_links_select ON public.project_links FOR SELECT USING (true);
DROP POLICY IF EXISTS project_links_admin ON public.project_links;
CREATE POLICY project_links_admin ON public.project_links FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS project_links_owner_write ON public.project_links;
CREATE POLICY project_links_owner_write ON public.project_links FOR INSERT WITH CHECK (auth.uid() = created_by);
DROP POLICY IF EXISTS project_links_owner_delete ON public.project_links;
CREATE POLICY project_links_owner_delete ON public.project_links FOR DELETE USING (auth.uid() = created_by);

-- 4. Documents — metadata rows; the bytes live in the project-documents bucket below.
CREATE TABLE IF NOT EXISTS public.project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  url TEXT,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_documents_project_idx ON public.project_documents (project_id);

ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_documents_select ON public.project_documents;
CREATE POLICY project_documents_select ON public.project_documents FOR SELECT USING (true);
DROP POLICY IF EXISTS project_documents_admin ON public.project_documents;
CREATE POLICY project_documents_admin ON public.project_documents FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS project_documents_owner_insert ON public.project_documents;
CREATE POLICY project_documents_owner_insert ON public.project_documents FOR INSERT WITH CHECK (auth.uid() = uploaded_by);
DROP POLICY IF EXISTS project_documents_owner_delete ON public.project_documents;
CREATE POLICY project_documents_owner_delete ON public.project_documents FOR DELETE USING (auth.uid() = uploaded_by);

-- 5. Storage bucket for project attachments (same shape as contract-documents).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-documents',
  'project-documents',
  true,
  52428800,
  '{"application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/csv","image/png","image/jpeg","text/plain"}'
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Enable project document uploads" ON storage.objects;
CREATE POLICY "Enable project document uploads" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-documents');
DROP POLICY IF EXISTS "Enable project document access" ON storage.objects;
CREATE POLICY "Enable project document access" ON storage.objects FOR SELECT
USING (bucket_id = 'project-documents');
DROP POLICY IF EXISTS "Enable project document modifications" ON storage.objects;
CREATE POLICY "Enable project document modifications" ON storage.objects FOR UPDATE
USING (bucket_id = 'project-documents');
DROP POLICY IF EXISTS "Enable project document deletions" ON storage.objects;
CREATE POLICY "Enable project document deletions" ON storage.objects FOR DELETE
USING (bucket_id = 'project-documents');

-- 6. Privileges: 0001's bulk grant predates these tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_documents TO authenticated;
