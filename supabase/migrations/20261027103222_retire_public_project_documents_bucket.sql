-- ==============================================================================
-- Retire the public `project-documents` bucket.
--
-- Runs only after the object copy into `project-documents-private`
-- (20261027103144) has been verified: same object count, same paths, same sizes.
-- Nothing is deleted here — the bucket and its objects stay in place as a rollback
-- copy. This migration only removes the anonymous access:
--   * public = false, so /storage/v1/object/public/project-documents/<path> stops
--     serving objects to the internet;
--   * the four bucket-name-only policies (created in 20260918100000 without a TO
--     clause, so they applied to `public`/anon) are dropped.
--
-- With no policies left, only service_role can read the bucket, which is all the
-- rollback copy needs.
-- ==============================================================================

UPDATE storage.buckets SET public = false WHERE id = 'project-documents';

DROP POLICY IF EXISTS "Enable project document uploads" ON storage.objects;
DROP POLICY IF EXISTS "Enable project document access" ON storage.objects;
DROP POLICY IF EXISTS "Enable project document modifications" ON storage.objects;
DROP POLICY IF EXISTS "Enable project document deletions" ON storage.objects;
