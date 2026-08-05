-- 0026: Public SECURITY DEFINER wrappers for Supabase Vault access via PostgREST.
-- The vault schema is not exposed via PostgREST, so rpc('vault.create_secret') fails
-- (PostgREST resolves the dotted name in the public schema). These wrappers are
-- callable as public.vault_set_secret / vault_get_secret / vault_delete_secret.

CREATE OR REPLACE FUNCTION public.vault_set_secret(p_name text, p_secret text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid;
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
  IF v_existing IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing, p_secret);
    RETURN v_existing;
  END IF;
  SELECT vault.create_secret(p_secret, p_name) INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.vault_get_secret(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.vault_delete_secret(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
  IF v_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.vault_set_secret(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vault_get_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vault_delete_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vault_set_secret(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_get_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_delete_secret(text) TO service_role;
