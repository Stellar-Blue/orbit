-- ==============================================================================
-- 0073: profiles.title was retired from the UI but stayed NOT NULL, breaking every insert.
--
-- `title` (the free-text Job Title, historically seeded as 'Team Member') was retired on
-- 2026-09-14: Role & Seniority — the effective-dated `profile_role_history` — is the single
-- job descriptor, and nothing reads or writes `profiles.title` any more.
--
-- The column is `TEXT NOT NULL` with NO default, so the two code paths that create a profile
-- both failed with `null value in column "title" ... violates not-null constraint`:
--   - People → "Onboard New Person" (`addProfile` in src/lib/auth-context.tsx)
--   - first sign-in JIT provisioning (src/app/auth/callback/route.ts), which signs the user
--     back out as `?error=UnprovisionedUser`
--
-- Making the column nullable (rather than dropping it) is deliberate: existing rows keep their
-- values and the legacy data stays available, while new rows honestly record "no title".
-- Adding a DEFAULT would just stamp retired placeholder text into every new hire.
--
-- Drop the column in a later migration once nobody wants the legacy values.
-- ==============================================================================

ALTER TABLE public.profiles ALTER COLUMN title DROP NOT NULL;

COMMENT ON COLUMN public.profiles.title IS
    'RETIRED 2026-09-14 — legacy free-text job title, superseded by profile_role_history (Role & Seniority). Nullable and unwritten; kept only for historic values.';
