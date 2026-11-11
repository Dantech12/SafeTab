import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type Tx } from "../db/pool.js";
import { requireStudentAccess } from "../auth/rbac.js";
import { audit } from "../audit.js";
import { HttpError } from "../lib/errors.js";
import type { MdmProvider } from "../mdm/provider.js";
import { deployDevicePolicy, loadSpec } from "../policy/deploy.js";
import { CONSENT_TEXT_VERSION, consentStatus, consentText } from "../policy/consent.js";
import { schoolHoursScope } from "../policy/spec.js";

const Params = z.object({ orgId: z.string().uuid(), studentId: z.string().uuid() });

/** Re-push policy to the student's parent-owned tablets after consent changes. */
async function redeployFamilyDevices(tx: Tx, mdm: MdmProvider, studentId: string, now: Date) {
  const devices = (await tx.query(
    "SELECT id FROM devices WHERE student_id = $1 AND ownership = 'family_owned' AND state IN ('active', 'pending_enrollment')",
    [studentId])).rows;
  for (const d of devices) await deployDevicePolicy(tx, mdm, d.id, "consent_change", now);
}

export async function consentRoutes(app: FastifyInstance) {
  const { deps } = app;

  app.get("/v1/orgs/:orgId/students/:studentId/consent", async (req) => {
    const ctx = await app.userCtx(req);
    const { studentId } = Params.parse(req.params);
    return withTenant(ctx.orgId, async (tx) => {
      await requireStudentAccess(tx, ctx, studentId, "student.read");
      const { spec } = await loadSpec(tx, studentId);
      const org = (await tx.query("SELECT name FROM organizations")).rows[0];
      const student = (await tx.query("SELECT display_name FROM students WHERE id = $1", [studentId])).rows[0];
      const { status, consent } = await consentStatus(tx, studentId, spec);
      const hasRules = spec.schoolHours.enabled && spec.schoolHours.blockedApps.length > 0;
      // Staff see which parents are linked; parents only see their own record.
      const guardians = ctx.role === "guardian" ? [] : (await tx.query(
        `SELECT u.display_name, u.email FROM supervisor_assignments a
           JOIN memberships m ON m.user_id = a.user_id AND m.role = 'guardian'
           JOIN users u ON u.id = a.user_id
         WHERE a.student_id = $1 ORDER BY u.display_name`, [studentId])).rows;
      return {
        status,
        hasRules,
        consent: consent && {
          signatureName: consent.signature_name,
          grantedAt: consent.granted_at,
          withdrawnAt: consent.withdrawn_at,
          byMe: consent.guardian_id === ctx.userId,
        },
        consentText: hasRules ? consentText(org.name, student.display_name, spec) : null,
        canGive: ctx.role === "guardian",
        guardians,
      };
    });
  });

  app.post("/v1/orgs/:orgId/students/:studentId/consent", async (req) => {
    const ctx = await app.userCtx(req);
    const { studentId } = Params.parse(req.params);
    const body = z.object({
      signatureName: z.string().trim().min(2).max(120),
      agree: z.literal(true),
    }).parse(req.body);
    return withTenant(ctx.orgId, async (tx) => {
      // Only the parent/guardian themself — staff cannot consent on a family's behalf.
      await requireStudentAccess(tx, ctx, studentId, "consent.give");
      const { spec } = await loadSpec(tx, studentId);
      if (!spec.schoolHours.enabled || !spec.schoolHours.blockedApps.length) throw new HttpError(409, "no_school_hours_rules_to_consent_to");
      const org = (await tx.query("SELECT name FROM organizations")).rows[0];
      const student = (await tx.query("SELECT display_name FROM students WHERE id = $1", [studentId])).rows[0];
      const r = await tx.query(
        `INSERT INTO parental_consents (org_id, student_id, guardian_id, signature_name, scope, consent_text, text_version)
         VALUES (app_current_org(), $1, $2, $3, $4, $5, $6) RETURNING id, granted_at`,
        [studentId, ctx.userId, body.signatureName, schoolHoursScope(spec), consentText(org.name, student.display_name, spec), CONSENT_TEXT_VERSION]);
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "consent.granted", targetType: "student", targetId: studentId, metadata: { consentId: r.rows[0].id }, ip: ctx.ip });
      await redeployFamilyDevices(tx, deps.mdm, studentId, deps.now());
      return { status: "active", grantedAt: r.rows[0].granted_at };
    });
  });

  app.post("/v1/orgs/:orgId/students/:studentId/consent/withdraw", async (req) => {
    const ctx = await app.userCtx(req);
    const { studentId } = Params.parse(req.params);
    return withTenant(ctx.orgId, async (tx) => {
      await requireStudentAccess(tx, ctx, studentId, "consent.give");
      const r = await tx.query(
        `UPDATE parental_consents SET withdrawn_at = now()
         WHERE student_id = $1 AND withdrawn_at IS NULL RETURNING id`, [studentId]);
      if (!r.rowCount) throw new HttpError(409, "no_active_consent");
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "consent.withdrawn", targetType: "student", targetId: studentId, ip: ctx.ip });
      // Enforcement stops immediately; staff are prompted to retire the tablet.
      await redeployFamilyDevices(tx, deps.mdm, studentId, deps.now());
      return { status: "withdrawn" };
    });
  });
}
