-- ==============================================================================
-- Employee qualification documents — degrees, certifications, language certificates.
--
-- Two halves that must agree:
--   * employee_documents holds the metadata and the review state;
--   * the file lives in the private `employee-documents` bucket under the uploader's
--     auth uid folder, so storage RLS can enforce "own folder" without a profile lookup.
--
-- Employees add and remove their own documents, always inserted as `pending`; only an
-- admin can move a document to verified/rejected (with reviewer and date). Reads are the
-- owner and admins. The bucket is private, so downloads are signed on read.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('degree', 'certification', 'language', 'other')),
    title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
    issuer TEXT,
    issued_on DATE,
    expires_on DATE,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    file_size BIGINT,
    mime_type TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_employee_documents_expiry CHECK (
        expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on
    )
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_profile
    ON public.employee_documents(profile_id, created_at DESC);

ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_employee_documents_select ON public.employee_documents;
CREATE POLICY policy_employee_documents_select ON public.employee_documents
    FOR SELECT TO authenticated
    USING (public.is_admin() OR profile_id = public.current_profile_id());

-- An employee may only add documents for themselves, and only as an unreviewed pending row.
DROP POLICY IF EXISTS policy_employee_documents_insert ON public.employee_documents;
CREATE POLICY policy_employee_documents_insert ON public.employee_documents
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_admin()
        OR (
            profile_id = public.current_profile_id()
            AND status = 'pending'
            AND reviewed_by IS NULL
            AND reviewed_at IS NULL
        )
    );

-- Only an admin moves a document between pending / verified / rejected.
DROP POLICY IF EXISTS policy_employee_documents_review ON public.employee_documents;
CREATE POLICY policy_employee_documents_review ON public.employee_documents
    FOR UPDATE TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS policy_employee_documents_delete ON public.employee_documents;
CREATE POLICY policy_employee_documents_delete ON public.employee_documents
    FOR DELETE TO authenticated
    USING (public.is_admin() OR profile_id = public.current_profile_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_documents TO authenticated;
REVOKE ALL ON public.employee_documents FROM anon;

DROP TRIGGER IF EXISTS trg_audit_employee_documents ON public.employee_documents;
CREATE TRIGGER trg_audit_employee_documents
    BEFORE INSERT OR UPDATE OR DELETE ON public.employee_documents
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ------------------------------------------------------------------------------
-- Storage: private bucket, 20 MB ceiling, PDF / image / Word only.
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'employee-documents',
    'employee-documents',
    false,
    20971520,
    '{"application/pdf","image/png","image/jpeg","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"}'
)
ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS policy_employee_documents_files_insert ON storage.objects;
CREATE POLICY policy_employee_documents_files_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'employee-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS policy_employee_documents_files_select ON storage.objects;
CREATE POLICY policy_employee_documents_files_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'employee-documents'
        AND (public.is_admin() OR (storage.foldername(name))[1] = auth.uid()::text)
    );

DROP POLICY IF EXISTS policy_employee_documents_files_delete ON storage.objects;
CREATE POLICY policy_employee_documents_files_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'employee-documents'
        AND (public.is_admin() OR (storage.foldername(name))[1] = auth.uid()::text)
    );
