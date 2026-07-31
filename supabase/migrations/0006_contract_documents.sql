-- Migration 0006: Add Document Attachment columns to Contracts registry table & Supabase Storage Bucket

ALTER TABLE contracts 
ADD COLUMN IF NOT EXISTS document_name TEXT NULL,
ADD COLUMN IF NOT EXISTS document_url TEXT NULL,
ADD COLUMN IF NOT EXISTS document_uploaded_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN contracts.document_url IS 'Supabase Storage file URL or fallback Data URL for contract documents';

-- Initialize Supabase Storage Bucket for contract-documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contract-documents',
  'contract-documents',
  true, -- Public read for authenticated internal application URLs
  52428800, -- 50MB file limit
  '{"application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","image/png","image/jpeg"}'
)
ON CONFLICT (id) DO NOTHING;

-- Storage Security Policies
DROP POLICY IF EXISTS "Enable contract document uploads" ON storage.objects;
CREATE POLICY "Enable contract document uploads" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'contract-documents');

DROP POLICY IF EXISTS "Enable contract document access" ON storage.objects;
CREATE POLICY "Enable contract document access" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'contract-documents');

DROP POLICY IF EXISTS "Enable contract document modifications" ON storage.objects;
CREATE POLICY "Enable contract document modifications" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'contract-documents');

DROP POLICY IF EXISTS "Enable contract document deletions" ON storage.objects;
CREATE POLICY "Enable contract document deletions" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'contract-documents');
