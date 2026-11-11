import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant } from "../db/pool.js";
import { requirePerm, requireStudentAccess } from "../auth/rbac.js";
import { audit } from "../audit.js";
import { HttpError, notFound } from "../lib/errors.js";
import { PLAN_LIMITS } from "../billing/entitlements.js";
import { deployDevicePolicy } from "../policy/deploy.js";
import { policyIdForDevice } from "../mdm/provider.js";
import { requireFullAccess } from "./students.js";
import { config } from "../config.js";

const Uuid = z.string().uuid();
const ENROLLMENT_TTL_S = 24 * 3600;

export async function deviceRoutes(app: FastifyInstance) {
  const { deps } = app;

  /**
   * Records the org's Android Enterprise. In production this is set by the AMAPI signup
   * callback (signupUrls.create -> admin completes Google flow -> enterprises.create with
   * the returned enterpriseToken). Exposed here for setup and testing.
   */
  app.put("/v1/orgs/:orgId/android-enterprise", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "org.manage");
    // Production must use the signup flow (routes/android.ts) so the enterprise is verified.
    if (config().NODE_ENV === "production") throw new HttpError(404, "not_found");
    const body = z.object({ enterpriseName: z.string().regex(/^enterprises\/[A-Za-z0-9_-]+$/) }).parse(req.body);
    return withTenant(ctx.orgId, async (tx) => {
      await tx.query("UPDATE organizations SET amapi_enterprise = $1", [body.enterpriseName]);
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "org.android_enterprise_set", metadata: body, ip: ctx.ip });
      return { enterpriseName: body.enterpriseName };
    });
  });

  app.get("/v1/orgs/:orgId/devices", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "device.manage");
    return withTenant(ctx.orgId, async (tx) => ({
      devices: (await tx.query(
        `SELECT id, student_id, label, ownership, platform, state, last_checkin_at, last_status_at, applied_policy_version, in_downtime, compliance
         FROM devices ORDER BY created_at`)).rows,
    }));
  });

  /**
   * Creates a one-time, short-lived enrollment token. IT staff (or the parent) scans the
   * QR code during first-boot setup of a factory-reset device. Enrollment is therefore
   * visible to whoever holds the device and cannot be done silently on a device in use.
   */
  app.post("/v1/orgs/:orgId/students/:studentId/devices", async (req, reply) => {
    const ctx = await app.userCtx(req);
    const { studentId } = z.object({ orgId: Uuid, studentId: Uuid }).parse(req.params);
    const body = z.object({
      ownership: z.enum(["school_owned", "family_owned"]),
      label: z.string().trim().max(80).optional(),
    }).parse(req.body);
    return withTenant(ctx.orgId, async (tx) => {
      await requireStudentAccess(tx, ctx, studentId, "device.enroll");
      await requireFullAccess(tx, deps.now());
      const org = (await tx.query("SELECT kind, amapi_enterprise FROM organizations")).rows[0];
      if (!org.amapi_enterprise) throw new HttpError(409, "android_enterprise_not_configured");
      const sub = (await tx.query("SELECT plan FROM subscriptions")).rows[0];
      const count = Number((await tx.query("SELECT count(*) FROM devices WHERE state <> 'retired'")).rows[0].count);
      if (count >= PLAN_LIMITS[sub.plan as "individual" | "organization"].devices) throw new HttpError(402, "device_limit_reached");

      const dev = (await tx.query(
        `INSERT INTO devices (org_id, student_id, ownership, label) VALUES (app_current_org(), $1, $2, $3) RETURNING id`,
        [studentId, body.ownership, body.label ?? null])).rows[0];
      // The policy must exist before the enrollment token that references it.
      const deployed = await deployDevicePolicy(tx, deps.mdm, dev.id, "enrollment", deps.now());
      if (deployed.status === "failed") throw new HttpError(502, "mdm_policy_push_failed");
      const token = await deps.mdm.createEnrollmentToken(org.amapi_enterprise, policyIdForDevice(dev.id), ENROLLMENT_TTL_S, dev.id);
      await tx.query("UPDATE devices SET enrollment_token_name = $2, enrollment_expires_at = $3 WHERE id = $1", [dev.id, token.name, token.expiresAt]);
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "device.enrollment_created", targetType: "device", targetId: dev.id, metadata: { ownership: body.ownership }, ip: ctx.ip });
      return reply.status(201).send({ deviceId: dev.id, qrCode: token.qrCode, expiresAt: token.expiresAt });
    });
  });

  app.post("/v1/orgs/:orgId/devices/:deviceId/lost", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "device.manage");
    const { deviceId } = z.object({ orgId: Uuid, deviceId: Uuid }).parse(req.params);
    return withTenant(ctx.orgId, async (tx) => {
      const d = (await tx.query("SELECT mdm_device_name, state FROM devices WHERE id = $1 FOR UPDATE", [deviceId])).rows[0];
      if (!d || d.state === "retired") throw notFound("device_not_found");
      if (d.mdm_device_name) await deps.mdm.lockDevice(d.mdm_device_name);
      // Revoke the companion-app credential so a lost device cannot upload or read notices.
      await tx.query("UPDATE device_credentials SET revoked_at = now() WHERE device_id = $1", [deviceId]);
      await tx.query("UPDATE devices SET state = 'lost' WHERE id = $1", [deviceId]);
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "device.marked_lost", targetType: "device", targetId: deviceId, ip: ctx.ip });
      return { deviceId, state: "lost" };
    });
  });

  /** Removes management. For fully managed devices AMAPI devices.delete also wipes the device. */
  app.post("/v1/orgs/:orgId/devices/:deviceId/retire", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "device.manage");
    const { deviceId } = z.object({ orgId: Uuid, deviceId: Uuid }).parse(req.params);
    z.object({ confirmWipe: z.literal(true) }).parse(req.body ?? {});
    return withTenant(ctx.orgId, async (tx) => {
      const d = (await tx.query("SELECT mdm_device_name, state FROM devices WHERE id = $1 FOR UPDATE", [deviceId])).rows[0];
      if (!d || d.state === "retired") throw notFound("device_not_found");
      if (d.mdm_device_name) await deps.mdm.deleteDevice(d.mdm_device_name);
      await tx.query("UPDATE device_credentials SET revoked_at = now() WHERE device_id = $1", [deviceId]);
      await tx.query("UPDATE devices SET state = 'retired' WHERE id = $1", [deviceId]);
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "device.retired", targetType: "device", targetId: deviceId, ip: ctx.ip });
      return { deviceId, state: "retired" };
    });
  });
}
