-- Sign in with Google / Microsoft (OpenID Connect).

-- Accounts created through a provider have no password.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- A provider identity (issuer-scoped subject) belongs to exactly one user.
CREATE TABLE user_identities (
  provider   text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject    text NOT NULL,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      citext,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX ON user_identities (user_id);

-- Short-lived OAuth state (CSRF protection, PKCE verifier, nonce) and the one-time
-- code the portal exchanges for a session. Secrets are stored hashed where possible.
CREATE TABLE oauth_states (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash      text NOT NULL UNIQUE,
  provider        text NOT NULL,
  code_verifier   text NOT NULL,
  nonce           text NOT NULL,
  next            text,
  login_code_hash text UNIQUE,
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz
);

-- Users may create their own workspace after signing in with a provider.
CREATE OR REPLACE FUNCTION count_user_orgs(p_user uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM memberships WHERE user_id = p_user AND role = 'org_admin'
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safetab_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_identities, oauth_states TO safetab_app;
    GRANT EXECUTE ON FUNCTION count_user_orgs(uuid) TO safetab_app;
  END IF;
END $$;
