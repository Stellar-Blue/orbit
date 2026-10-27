-- ==============================================================================
-- Multiple signed documents per contract.
--
-- The registry used to hold one attachment on `contracts` (document_name /
-- document_url / document_uploaded_at). `contract_documents` already existed for
-- versioned copies but had no display name and was never written to, so the
-- dossier now lists every document from this table instead.
--
-- Additive only: the legacy columns stay in place, and any document already
-- attached to a contract is copied across exactly once.
-- ==============================================================================

ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT;

COMMENT ON COLUMN public.contract_documents.file_name IS
  'Original uploaded file name. storage_path holds the Supabase object path, or a legacy data:/public URL.';

CREATE INDEX IF NOT EXISTS contract_documents_contract_idx
  ON public.contract_documents (contract_id, uploaded_at DESC);

-- Carry the single legacy attachment over to the list, without duplicating rows on re-run.
INSERT INTO public.contract_documents (contract_id, storage_path, file_name, uploaded_at)
SELECT c.id,
       c.document_url,
       COALESCE(NULLIF(c.document_name, ''), 'Contract document'),
       COALESCE(c.document_uploaded_at, now())
FROM public.contracts c
WHERE COALESCE(c.document_url, '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.contract_documents d
    WHERE d.contract_id = c.id AND d.storage_path = c.document_url
  );

-- Same posture as the other attachment tables: authenticated admins write (RLS), anon has no grants.
REVOKE ALL ON TABLE public.contract_documents FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contract_documents TO authenticated;
