-- 0029: external_refs.profile_id — stale mirror cleanup must find refs of DELETED records,
-- which can't be reached through orbit_id joins to current rows.

ALTER TABLE public.external_refs ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Backfill from the originating tables
UPDATE public.external_refs er
SET profile_id = lr.profile_id
FROM leave_requests lr
WHERE er.provider = 'm365' AND er.orbit_kind = 'leave' AND lr.id = er.orbit_id;

UPDATE public.external_refs er
SET profile_id = rp.profile_id
FROM remote_patterns rp
WHERE er.provider = 'm365' AND er.orbit_kind = 'remote' AND rp.id = er.orbit_id AND er.profile_id IS NULL;

UPDATE public.external_refs er
SET profile_id = rd.profile_id
FROM remote_days rd
WHERE er.provider = 'm365' AND er.orbit_kind = 'remote' AND rd.id = er.orbit_id AND er.profile_id IS NULL;

CREATE INDEX IF NOT EXISTS external_refs_profile_idx ON public.external_refs (provider, profile_id, deleted_at);
