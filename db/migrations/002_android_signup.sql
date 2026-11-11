-- Android Enterprise signup (AMAPI signupUrls -> enterprises.create).
-- The callback from Google is an unauthenticated browser redirect, so it is tied back to the
-- org with a random, single-use state value stored only as a hash.
ALTER TABLE organizations
  ADD COLUMN amapi_signup_url_name   text,
  ADD COLUMN amapi_signup_state_hash text UNIQUE,
  ADD COLUMN amapi_signup_expires_at timestamptz,
  ADD COLUMN amapi_signup_by         uuid REFERENCES users(id);

CREATE OR REPLACE FUNCTION lookup_android_signup(p_state_hash text)
RETURNS TABLE (org_id uuid, signup_url_name text, started_by uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, amapi_signup_url_name, amapi_signup_by FROM organizations
  WHERE amapi_signup_state_hash = p_state_hash AND amapi_signup_expires_at > now() AND amapi_enterprise IS NULL
$$;

-- Orgs with a connected enterprise, for the status-polling job.
CREATE OR REPLACE FUNCTION list_android_orgs()
RETURNS TABLE (org_id uuid, enterprise text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, amapi_enterprise FROM organizations WHERE amapi_enterprise IS NOT NULL
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safetab_app') THEN
    GRANT EXECUTE ON FUNCTION lookup_android_signup(text) TO safetab_app;
    GRANT EXECUTE ON FUNCTION list_android_orgs() TO safetab_app;
  END IF;
END $$;
