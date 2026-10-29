-- The made avatar: the choices behind `photo_url`, kept so the person can reopen the maker and
-- adjust the face instead of starting from scratch. `photo_url` still holds the picture itself (a
-- data URL), so every screen that already shows a photo keeps working untouched.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_config jsonb;

COMMENT ON COLUMN public.profiles.avatar_config IS
  'Choices behind a made avatar (see src/lib/avatar.ts); NULL when the photo is an upload or absent.';

-- Column-level grants: `authenticated` may read and change only its own avatar (RLS decides which
-- row), and the service role needs it to clear the design when a real photo replaces it.
GRANT SELECT (avatar_config) ON public.profiles TO authenticated;
GRANT UPDATE (avatar_config) ON public.profiles TO authenticated;
GRANT SELECT (avatar_config), INSERT (avatar_config), UPDATE (avatar_config) ON public.profiles TO service_role;
