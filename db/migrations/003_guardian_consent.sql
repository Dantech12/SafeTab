-- Parent/guardian accounts and parental consent for school-hours rules on
-- parent-owned tablets.

-- New role: a parent/guardian sees only their own child (via supervisor_assignments)
-- and is the only role that can give or withdraw consent.
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('org_admin', 'supervisor', 'guardian'));
ALTER TABLE invitations DROP CONSTRAINT invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK (role IN ('org_admin', 'supervisor', 'guardian'));

-- A guardian invitation is for one specific student.
ALTER TABLE invitations ADD COLUMN student_id uuid;
ALTER TABLE invitations ADD CONSTRAINT invitations_student_fk
  FOREIGN KEY (org_id, student_id) REFERENCES students(org_id, id) ON DELETE CASCADE;
ALTER TABLE invitations ADD CONSTRAINT invitations_guardian_student
  CHECK ((role = 'guardian') = (student_id IS NOT NULL));

ALTER TABLE devices ADD COLUMN in_school_hours boolean NOT NULL DEFAULT false;

ALTER TABLE policy_deployments DROP CONSTRAINT policy_deployments_reason_check;
ALTER TABLE policy_deployments ADD CONSTRAINT policy_deployments_reason_check CHECK (reason IN
  ('policy_change', 'downtime_start', 'downtime_end', 'registration', 'enrollment', 'schedule', 'consent_change'));

-- Consent is given by the guardian themself, for an exact set of rules (scope). If the
-- school changes the rules, the scope no longer matches and enforcement pauses.
CREATE TABLE parental_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  student_id      uuid NOT NULL,
  guardian_id     uuid NOT NULL REFERENCES users(id),
  signature_name  text NOT NULL CHECK (length(signature_name) BETWEEN 2 AND 120),
  scope           text NOT NULL,     -- canonical school-hours rules agreed to
  consent_text    text NOT NULL,     -- exact wording shown when agreeing
  text_version    text NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  withdrawn_at    timestamptz,
  FOREIGN KEY (org_id, student_id) REFERENCES students(org_id, id) ON DELETE CASCADE
);
CREATE INDEX ON parental_consents (org_id, student_id, granted_at DESC);

ALTER TABLE parental_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON parental_consents
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

-- Membership listing for login now includes guardians (function unchanged in shape).

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safetab_app') THEN
    GRANT SELECT, INSERT, UPDATE ON parental_consents TO safetab_app;
    -- Consent history is evidence: the app may withdraw (UPDATE) but never delete.
    REVOKE DELETE ON parental_consents FROM safetab_app;
  END IF;
END $$;
