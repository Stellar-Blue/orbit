-- ==============================================================================
-- 0071: Screen visibility — let admins hide whole screens from non-admins.
--
-- One row per screen an admin has touched; an ABSENT row means "visible", so no
-- seeding is needed and the catalogue of screens lives in the client
-- (`src/lib/screens.ts`). Rows are never deleted, so `updated_by`/`updated_at`
-- keep a record of who last flipped each switch.
--
-- Reads are open to every authenticated user: the client has to know what to hide
-- in the sidebar and which routes to block. Writes are admin-only (0057/0063 pattern).
--
-- NOTE this is a UI gate, not a security boundary — RLS is still what protects the
-- underlying data (e.g. hiding the Timesheets screen does not grant or revoke access
-- to `contract_timesheets` rows).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.screen_visibility (
    screen_key TEXT PRIMARY KEY,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.screen_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS policy_screen_visibility_select ON public.screen_visibility;
DROP POLICY IF EXISTS policy_screen_visibility_admin ON public.screen_visibility;
CREATE POLICY policy_screen_visibility_select ON public.screen_visibility
    FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_screen_visibility_admin ON public.screen_visibility
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- No `audit_trigger_func()` here: it assumes a UUID `id` column, and this table's key is
-- `screen_key`. `updated_by` / `updated_at` already record who flipped each switch.

COMMENT ON TABLE public.screen_visibility IS
    'Admin-controlled screen visibility for non-admins. Absent row = visible. UI gate only; RLS remains the data boundary.';
