-- ==============================================================================
-- A private home for project attachments, plus the table rules that go with it.
--
-- 20260918100000 created `project-documents` with public = true and four storage
-- policies that only checked the bucket name and omitted the TO clause, so they
-- applied to `public` (anon): every object was readable at
-- /storage/v1/object/public/project-documents/<path>, and anonymous callers could
-- upload, overwrite and delete. `project_links` and `project_documents` had the same
-- defect — `USING (true)` with no TO clause plus Supabase's default anon grant on new
-- tables in `public`.
--
-- The application now writes to `project-documents-private` instead. The old bucket
-- is left in place, untouched, until its contents have been copied and verified; it
-- is retired in 20261027103222.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. New bucket: private, same size limit and MIME allow-list as the old one.
-- ------------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-documents-private',
  'project-documents-private',
  false,
  52428800,
  '{"application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/csv","image/png","image/jpeg","text/plain"}'
)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ------------------------------------------------------------------------------
-- 2. Storage policies: the bucket name alone is not an authorization check.
--    Project attachments are only surfaced in the admin-only contracts registry.
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS policy_project_documents_bucket_admin ON storage.objects;
CREATE POLICY policy_project_documents_bucket_admin ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'project-documents-private' AND public.is_admin())
  WITH CHECK (bucket_id = 'project-documents-private' AND public.is_admin());

-- ------------------------------------------------------------------------------
-- 3. Tables: admin-only, and strip the implicit anon grants.
--
-- The permissive sets are dropped first: project_links_admin / project_documents_admin
-- were FOR ALL with no TO clause, so they granted anon the same access as
-- authenticated users.
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS project_links_select ON public.project_links;
DROP POLICY IF EXISTS project_links_admin ON public.project_links;
DROP POLICY IF EXISTS project_links_owner_write ON public.project_links;
DROP POLICY IF EXISTS project_links_owner_delete ON public.project_links;

DROP POLICY IF EXISTS project_documents_select ON public.project_documents;
DROP POLICY IF EXISTS project_documents_admin ON public.project_documents;
DROP POLICY IF EXISTS project_documents_owner_insert ON public.project_documents;
DROP POLICY IF EXISTS project_documents_owner_delete ON public.project_documents;

DROP POLICY IF EXISTS policy_project_links_admin ON public.project_links;
DROP POLICY IF EXISTS policy_project_documents_admin ON public.project_documents;

REVOKE ALL ON TABLE public.project_links FROM anon;
REVOKE ALL ON TABLE public.project_documents FROM anon;

CREATE POLICY policy_project_links_admin ON public.project_links
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY policy_project_documents_admin ON public.project_documents
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
