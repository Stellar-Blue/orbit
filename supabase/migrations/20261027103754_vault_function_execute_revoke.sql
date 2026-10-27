-- ==============================================================================
-- The vault_* wrappers must not be callable by anon or authenticated.
--
-- 0026 revoked EXECUTE from PUBLIC before granting it to service_role, but Supabase
-- installs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO
-- anon, authenticated` on the project, so each wrapper also carried explicit grants
-- to both roles. Only a named REVOKE removes those — the same class of hole
-- 0070_coverage_load_anon_revoke fixed for coverage_load.
--
-- The wrappers are SECURITY DEFINER and read vault.decrypted_secrets by name, so any
-- holder of the public anon key could read, overwrite or delete the Slack and
-- Microsoft 365 tokens, the myDATA credentials and the DeepSeek key.
--
-- Every caller is a server-side route using the service-role client
-- (src/lib/integrations/server.ts, src/lib/integrations/msal.ts, invoice_report.ts),
-- so service_role keeps EXECUTE and nothing else does. No SQL function, view or RLS
-- policy calls these wrappers, so internal definer calls are unaffected.
-- ==============================================================================

REVOKE ALL ON FUNCTION public.vault_get_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vault_get_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.vault_get_secret(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.vault_set_secret(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vault_set_secret(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.vault_set_secret(text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.vault_delete_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vault_delete_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.vault_delete_secret(text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.vault_get_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_set_secret(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_delete_secret(text) TO service_role;
