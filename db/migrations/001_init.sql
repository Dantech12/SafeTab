-- SafeTab core schema.
-- Design notes:
--  * Every tenant-owned table carries org_id and is protected by row-level security (RLS).
--    The runtime DB role (safetab_app) is NOT the table owner and has NOBYPASSRLS, so a
--    missing WHERE clause in application code still cannot read another tenant's rows.
--    RLS is intentionally not FORCEd: the owner role (migrations, the narrow SECURITY
--    DEFINER lookups below, and the retention job) is exempt; the app role never is.
--  * A family (Individual plan) is modelled as an organization of kind 'family' so that
--    tenancy, roles, audit and billing work identically for both plans.
--  * Student data is minimised: a display name (a nickname/pseudonym is fine) and an age
--    band. No date of birth, photo, phone number, location or content of any kind.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Tenant context helper. Returns NULL when not set, so RLS denies by default.
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;

CREATE TABLE organizations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL CHECK (kind IN ('family', 'school')),
  name                 text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  country              text CHECK (country ~ '^[A-Z]{2}$'),
  usage_retention_days int  NOT NULL DEFAULT 30 CHECK (usage_retention_days BETWEEN 1 AND 90),
  audit_retention_days int  NOT NULL DEFAULT 365 CHECK (audit_retention_days BETWEEN 90 AND 2555),
  amapi_enterprise     text, -- e.g. "enterprises/LC0abc123" (Android Management API)
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Users are global identities (one adult may belong to several orgs).
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext NOT NULL UNIQUE,
  password_hash    text NOT NULL,          -- argon2id; never plaintext
  display_name     text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  failed_logins    int NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,        -- HMAC-SHA256(pepper, token); token itself never stored
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);

CREATE TABLE memberships (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('org_admin', 'supervisor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        text NOT NULL CHECK (role IN ('org_admin', 'supervisor')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid NOT NULL REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE students (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  age_band     text NOT NULL CHECK (age_band IN ('under_13', '13_15', '16_17')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

-- Least privilege for school staff: a supervisor only sees assigned students.
CREATE TABLE supervisor_assignments (
  org_id     uuid NOT NULL,
  user_id    uuid NOT NULL,
  student_id uuid NOT NULL,
  PRIMARY KEY (org_id, user_id, student_id),
  FOREIGN KEY (org_id, user_id) REFERENCES memberships(org_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, student_id) REFERENCES students(org_id, id) ON DELETE CASCADE
);

CREATE TABLE devices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  student_id             uuid NOT NULL,
  ownership              text NOT NULL CHECK (ownership IN ('school_owned', 'family_owned')),
  platform               text NOT NULL DEFAULT 'android' CHECK (platform IN ('android')),
  state                  text NOT NULL DEFAULT 'pending_enrollment'
                         CHECK (state IN ('pending_enrollment', 'active', 'lost', 'retired')),
  label                  text CHECK (length(label) <= 80),
  enrollment_token_name  text UNIQUE,      -- AMAPI enrollmentTokens resource name
  enrollment_expires_at  timestamptz,
  mdm_device_name        text UNIQUE,      -- AMAPI devices resource name
  applied_policy_version bigint,
  last_status_at         timestamptz,      -- last MDM status report
  last_checkin_at        timestamptz,      -- last companion-app check-in
  compliance             jsonb NOT NULL DEFAULT '{}'::jsonb,
  in_downtime            boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, student_id) REFERENCES students(org_id, id) ON DELETE CASCADE
);

-- Companion app credentials. The one-time registration code is delivered to the
-- force-installed companion app via its *managed configuration* (official channel);
-- the child never types an adult's password.
CREATE TABLE device_credentials (
  device_id               uuid PRIMARY KEY,
  org_id                  uuid NOT NULL,
  registration_code_hash  text UNIQUE,
  registration_expires_at timestamptz,
  token_hash              text UNIQUE,
  issued_at               timestamptz,
  revoked_at              timestamptz,
  FOREIGN KEY (org_id, device_id) REFERENCES devices(org_id, id) ON DELETE CASCADE
);

-- One policy document per student; version increments on every change.
CREATE TABLE policies (
  org_id     uuid NOT NULL,
  student_id uuid NOT NULL,
  version    bigint NOT NULL DEFAULT 1,
  spec       jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, student_id),
  FOREIGN KEY (org_id, student_id) REFERENCES students(org_id, id) ON DELETE CASCADE
);

-- Per-device, per-version rollout status. Never report "applied" until the device confirms.
CREATE TABLE policy_deployments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  device_id      uuid NOT NULL,
  spec_version   bigint NOT NULL,          -- our policies.version
  policy_version bigint,                   -- version assigned by the MDM (AMAPI policy.version); NULL if push failed
  reason         text NOT NULL CHECK (reason IN ('policy_change', 'downtime_start', 'downtime_end', 'registration', 'enrollment')),
  status         text NOT NULL CHECK (status IN ('pending', 'applied', 'unsupported', 'failed')),
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, policy_version),
  FOREIGN KEY (org_id, device_id) REFERENCES devices(org_id, id) ON DELETE CASCADE
);

-- Aggregate only: minutes per app package per day. No timestamps of individual sessions,
-- no window titles, no URLs, no content.
CREATE TABLE app_usage_daily (
  org_id     uuid NOT NULL,
  device_id  uuid NOT NULL,
  student_id uuid NOT NULL,
  day        date NOT NULL,
  package    text NOT NULL CHECK (package ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$'),
  minutes    int NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
  PRIMARY KEY (device_id, day, package),
  FOREIGN KEY (org_id, device_id) REFERENCES devices(org_id, id) ON DELETE CASCADE
);
CREATE INDEX ON app_usage_daily (org_id, student_id, day);

-- Append-only audit trail of sensitive actions (including who viewed activity data).
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  org_id        uuid NOT NULL,
  actor_type    text NOT NULL CHECK (actor_type IN ('user', 'device', 'system')),
  actor_id      uuid,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (org_id, created_at DESC);

CREATE TABLE subscriptions (
  org_id                     uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan                       text NOT NULL CHECK (plan IN ('individual', 'organization')),
  status                     text NOT NULL DEFAULT 'none'
                             CHECK (status IN ('none', 'active', 'non_renewing', 'past_due', 'lapsed', 'cancelled')),
  paystack_customer_code     text,
  paystack_subscription_code text UNIQUE,
  paystack_email_token       text,
  current_period_end         timestamptz,
  grace_until                timestamptz,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  reference   text PRIMARY KEY,           -- our server-generated reference
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan        text NOT NULL CHECK (plan IN ('individual', 'organization')),
  amount      int NOT NULL CHECK (amount > 0), -- subunits
  currency    text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status      text NOT NULL DEFAULT 'initialized'
              CHECK (status IN ('initialized', 'success', 'failed', 'abandoned')),
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Webhook idempotency (system table, no tenant data stored).
CREATE TABLE webhook_events (
  id           text PRIMARY KEY,           -- provider + ":" + sha256(raw body)
  provider     text NOT NULL,
  event_type   text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE data_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  student_id   uuid,
  kind         text NOT NULL CHECK (kind IN ('export', 'delete')),
  requested_by uuid NOT NULL REFERENCES users(id),
  status       text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

------------------------------------------------------------------------------
-- Row-level security
------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['memberships','invitations','students','supervisor_assignments',
    'devices','device_credentials','policies','policy_deployments','app_usage_daily',
    'audit_log','subscriptions','payments','data_requests']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (id = app_current_org()) WITH CHECK (id = app_current_org());

------------------------------------------------------------------------------
-- Narrow cross-tenant lookups (SECURITY DEFINER). Each returns only the org id
-- (and minimal keys) needed to then open a properly tenant-scoped transaction.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lookup_user_memberships(p_user uuid)
RETURNS TABLE (org_id uuid, role text, org_name text, org_kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.org_id, m.role, o.name, o.kind FROM memberships m JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = p_user
$$;

CREATE OR REPLACE FUNCTION lookup_invitation(p_token_hash text)
RETURNS TABLE (id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, org_id FROM invitations
  WHERE token_hash = p_token_hash AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
$$;

CREATE OR REPLACE FUNCTION lookup_device_by_token(p_token_hash text)
RETURNS TABLE (device_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT device_id, org_id FROM device_credentials
  WHERE token_hash = p_token_hash AND revoked_at IS NULL
$$;

CREATE OR REPLACE FUNCTION lookup_device_by_registration(p_code_hash text)
RETURNS TABLE (device_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT device_id, org_id FROM device_credentials
  WHERE registration_code_hash = p_code_hash AND revoked_at IS NULL AND registration_expires_at > now()
$$;

CREATE OR REPLACE FUNCTION lookup_device_by_mdm(p_enrollment_token text, p_mdm_name text)
RETURNS TABLE (device_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, org_id FROM devices
  WHERE (p_enrollment_token IS NOT NULL AND enrollment_token_name = p_enrollment_token)
     OR (p_mdm_name IS NOT NULL AND mdm_device_name = p_mdm_name)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION lookup_payment_org(p_reference text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM payments WHERE reference = p_reference
$$;

CREATE OR REPLACE FUNCTION lookup_subscription_org(p_subscription_code text, p_customer_code text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM subscriptions
  WHERE (p_subscription_code IS NOT NULL AND paystack_subscription_code = p_subscription_code)
     OR (p_customer_code IS NOT NULL AND paystack_customer_code = p_customer_code)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION list_org_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM organizations
$$;

-- Creating an org happens before any tenant context exists.
CREATE OR REPLACE FUNCTION create_organization(p_kind text, p_name text, p_country text, p_owner uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO organizations (kind, name, country) VALUES (p_kind, p_name, p_country) RETURNING id INTO new_id;
  INSERT INTO memberships (org_id, user_id, role) VALUES (new_id, p_owner, 'org_admin');
  INSERT INTO subscriptions (org_id, plan, status)
    VALUES (new_id, CASE WHEN p_kind = 'family' THEN 'individual' ELSE 'organization' END, 'none');
  RETURN new_id;
END $$;

------------------------------------------------------------------------------
-- Grants for the runtime role
------------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safetab_app') THEN
    GRANT USAGE ON SCHEMA public TO safetab_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO safetab_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO safetab_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO safetab_app;
    -- Audit log is append-only for the application, except retention purges via owner jobs.
    REVOKE UPDATE, DELETE ON audit_log FROM safetab_app;
  END IF;
END $$;
