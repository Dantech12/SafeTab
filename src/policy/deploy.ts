import type { Tx } from "../db/pool.js";
import { config } from "../config.js";
import { hashToken, newToken } from "../lib/tokens.js";
import type { MdmDeviceStatus, MdmProvider } from "../mdm/provider.js";
import { policyIdForDevice } from "../mdm/provider.js";
import { compilePolicy } from "./compile.js";
import { DEFAULT_POLICY, isInDowntime, isInSchoolHours, PolicySpec, type PolicySpec as Spec } from "./spec.js";
import { consentStatus } from "./consent.js";

export type DeployReason = "policy_change" | "downtime_start" | "downtime_end" | "registration" | "enrollment" | "schedule" | "consent_change";

/**
 * What the schedule means for one device right now. Family-owned tablets never get
 * downtime, and get school-hours rules only with a parent's consent to those exact rules.
 */
export async function scheduleState(tx: Tx, studentId: string, ownership: string, spec: Spec, now: Date) {
  const family = ownership === "family_owned";
  const inDowntime = !family && config().COMPANION_APP_ENABLED && isInDowntime(spec, now);
  let consentOk = !family;
  if (family && spec.schoolHours.enabled) consentOk = (await consentStatus(tx, studentId, spec)).status === "active";
  const inSchoolHours = consentOk && isInSchoolHours(spec, now);
  const schoolHours: "active" | "inactive" | "no_consent" = !consentOk ? "no_consent" : inSchoolHours ? "active" : "inactive";
  return { inDowntime, inSchoolHours, schoolHours };
}

export async function loadSpec(tx: Tx, studentId: string): Promise<{ spec: Spec; version: number }> {
  const r = await tx.query("SELECT spec, version FROM policies WHERE student_id = $1", [studentId]);
  const row = r.rows[0];
  if (!row) return { spec: DEFAULT_POLICY, version: 0 };
  return { spec: PolicySpec.parse(row.spec), version: Number(row.version) };
}

/**
 * Compiles and pushes the current policy for one device and records a deployment row.
 * The deployment starts as 'pending'; it only becomes 'applied' once the device reports
 * the new version (see reconcileDeviceStatus). The MDM call happens inside the DB
 * transaction for simplicity; at larger scale use a transactional outbox + worker.
 */
export async function deployDevicePolicy(
  tx: Tx,
  mdm: MdmProvider,
  deviceId: string,
  reason: DeployReason,
  now: Date,
): Promise<{ status: "pending" | "failed"; registrationCode?: string }> {
  const d = await tx.query(
    `SELECT d.id, d.student_id, d.ownership, d.state, o.amapi_enterprise, c.token_hash
       FROM devices d JOIN organizations o ON o.id = d.org_id
       LEFT JOIN device_credentials c ON c.device_id = d.id
      WHERE d.id = $1`,
    [deviceId],
  );
  const dev = d.rows[0];
  if (!dev) throw new Error("device not found");
  if (!dev.amapi_enterprise) throw new Error("organization has no Android enterprise configured");

  const { spec, version: specVersion } = await loadSpec(tx, dev.student_id);
  const { inDowntime, inSchoolHours, schoolHours } = await scheduleState(tx, dev.student_id, dev.ownership, spec, now);

  // Until the companion app registers, each push carries a fresh one-time code.
  let registrationCode: string | undefined;
  const companionEnabled = config().COMPANION_APP_ENABLED;
  if (companionEnabled && !dev.token_hash) {
    registrationCode = newToken(24);
    await tx.query(
      `INSERT INTO device_credentials (device_id, org_id, registration_code_hash, registration_expires_at)
       VALUES ($1, app_current_org(), $2, $3)
       ON CONFLICT (device_id) DO UPDATE SET registration_code_hash = EXCLUDED.registration_code_hash,
         registration_expires_at = EXCLUDED.registration_expires_at`,
      [deviceId, hashToken(registrationCode), new Date(now.getTime() + 7 * 86400_000)],
    );
  }

  const { policy, controls } = compilePolicy({
    spec,
    ownership: dev.ownership,
    inDowntime,
    companionPackage: config().COMPANION_APP_PACKAGE,
    companionEnabled,
    apiBaseUrl: config().PUBLIC_BASE_URL,
    registrationCode,
    schoolHours,
  });

  let mdmVersion: number | null = null;
  let status: "pending" | "failed" = "pending";
  let error: string | undefined;
  try {
    mdmVersion = (await mdm.upsertPolicy(dev.amapi_enterprise, policyIdForDevice(deviceId), policy)).version;
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message.slice(0, 300) : "unknown";
  }

  await tx.query(
    `INSERT INTO policy_deployments (org_id, device_id, spec_version, policy_version, reason, status, detail)
     VALUES (app_current_org(), $1, $2, $3, $4, $5, $6)`,
    [deviceId, specVersion, mdmVersion, reason, status, JSON.stringify({ controls, error })],
  );
  await tx.query("UPDATE devices SET in_downtime = $2, in_school_hours = $3 WHERE id = $1", [deviceId, inDowntime, inSchoolHours]);
  return { status, registrationCode };
}

/** Applies an MDM status report (AMAPI STATUS_REPORT / devices.get) to our records. */
export async function reconcileDeviceStatus(tx: Tx, deviceId: string, s: MdmDeviceStatus, now: Date): Promise<void> {
  const applied = s.appliedPolicyVersion ?? null;
  await tx.query(
    `UPDATE devices SET applied_policy_version = COALESCE($2, applied_policy_version),
       last_status_at = $3, compliance = $4,
       state = CASE WHEN state = 'pending_enrollment' AND $5 = 'ACTIVE' THEN 'active' ELSE state END
     WHERE id = $1`,
    [deviceId, applied, s.lastStatusReportTime ? new Date(s.lastStatusReportTime) : now,
      JSON.stringify({ policyCompliant: s.policyCompliant ?? null, nonCompliance: (s.nonComplianceDetails ?? []).slice(0, 20) }),
      s.state ?? null],
  );
  if (applied == null) return;

  const failed = (s.nonComplianceDetails ?? []).length > 0 && s.policyCompliant === false;
  // Exact version the device now runs: applied or failed (with reasons).
  await tx.query(
    `UPDATE policy_deployments SET status = $3, updated_at = now(),
       detail = detail || jsonb_build_object('nonCompliance', $4::jsonb)
     WHERE device_id = $1 AND policy_version = $2 AND status = 'pending'`,
    [deviceId, applied, failed ? "failed" : "applied", JSON.stringify(s.nonComplianceDetails ?? [])],
  );
  // Older pending versions were superseded by what the device confirmed.
  await tx.query(
    `UPDATE policy_deployments SET status = 'applied', updated_at = now(),
       detail = detail || '{"superseded": true}'::jsonb
     WHERE device_id = $1 AND policy_version < $2 AND status = 'pending'`,
    [deviceId, applied],
  );
}
