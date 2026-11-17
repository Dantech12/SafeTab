-- "Forgot password?" links. Only a hash of each link's secret is stored; links are
-- single use and short-lived.
CREATE TABLE password_resets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz
);
CREATE INDEX ON password_resets (user_id, created_at DESC);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safetab_app') THEN
    GRANT SELECT, INSERT, UPDATE ON password_resets TO safetab_app;
  END IF;
END $$;
