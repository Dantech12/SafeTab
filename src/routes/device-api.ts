import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { q, withTenant } from "../db/pool.js";
import { audit } from "../audit.js";
import { hashToken, newToken } from "../lib/tokens.js";
import { HttpError, unauthorized } from "../lib/errors.js";
import { accessLevel } from "../billing/entitlements.js";
import { deployDevicePolicy, loadSpec } from "../policy/deploy.js";
import { PackageName, isInDowntime } from "../policy/spec.js";
import { dataInventory } from "./org.js";

/**
 * API for the visible SafeTab student companion app on an enrolled device. The device
 * authenticates with its own credential (never a parent's password) and can only read
 * its own notice and submit aggregate usage totals for itself.
 */
async function deviceAuth(req: FastifyRequest): Promise<{ deviceId: string; orgId: string }> {
  const h = req.headers.authorization;
  const token = h?.startsWith("Bearer ") ? h.slice(7) : undefined;
  if (!token) throw unauthorized();
  const r = await q("SELECT device_id, org_id FROM lookup_device_by_token($1)", [hashToken(token)]);
  if (!r.rows[0]) throw unauthorized();
  return { deviceId: r.rows[0].device_id, orgId: r.rows[0].org_id };
}

const UsageUpload = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  apps: z.array(z.object({ package: PackageName, minutes: z.number().int().min(0).max(1440) })).max(300),
});

export async function deviceApiRoutes(app: FastifyInstance) {
  const { deps } = app;

  app.post("/device/v1/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const body = z.object({ registrationCode: z.string().min(20).max(100) }).parse(req.body);
    const found = (await q("SELECT device_id, org_id FROM lookup_device_by_registration($1)", [hashToken(body.registrationCode)])).rows[0];
    if (!found) throw new HttpError(400, "invalid_or_expired_code");
    const token = newToken();
    await withTenant(found.org_id, async (tx) => {
      const upd = await tx.query(
        `UPDATE device_credentials SET token_hash = $2, issued_at = now(), registration_code_hash = NULL, registration_expires_at = NULL
         WHERE device_id = $1 AND registration_code_hash = $3`,
        [found.device_id, hashToken(token), hashToken(body.registrationCode)]);
      if (upd.rowCount !== 1) throw new HttpError(400, "invalid_or_expired_code"); // single use
      await audit(tx, { actorType: "device", actorId: found.device_id, action: "device.companion_registered", targetType: "device", targetId: found.device_id });
      // Re-push policy so the managed configuration no longer carries the (now used) code.
      await deployDevicePolicy(tx, deps.mdm, found.device_id, "registration", deps.now());
    });
    return { deviceToken: token };
  });

  /** Age-appropriate transparency screen content for the student. */
  app.get("/device/v1/notice", async (req) => {
    const { deviceId, orgId } = await deviceAuth(req);
    return withTenant(orgId, async (tx) => {
      const o = (await tx.query("SELECT name, kind, usage_retention_days, audit_retention_days FROM organizations")).rows[0];
      const d = (await tx.query("SELECT d.student_id, d.ownership, s.age_band FROM devices d JOIN students s ON s.id = d.student_id WHERE d.id = $1", [deviceId])).rows[0];
      const { spec } = await loadSpec(tx, d.student_id);
      const sub = (await tx.query("SELECT plan, status, current_period_end, grace_until FROM subscriptions")).rows[0];
      const collecting = spec.usageSummaries.enabled && accessLevel(sub, deps.now()) === "full";
      const manager = o.kind === "school" ? `your school (${o.name})` : "your parent or guardian";
      return {
        managedBy: manager,
        ageBand: d.age_band,
        summary: d.age_band === "under_13"
          ? `This tablet is looked after by ${manager}. They can choose which apps you can use and when the tablet rests. They cannot read your messages, see your screen or hear you.`
          : `This device is managed by ${manager}. They can set app and web rules and downtime. They cannot see your messages, screen, camera, microphone, location or browsing history.`,
        activeControls: {
          downtime: spec.downtime.enabled ? spec.downtime.windows : [],
          inDowntimeNow: isInDowntime(spec, deps.now()),
          apps: { mode: spec.apps.mode, count: spec.apps.packages.length },
          web: { mode: spec.web.mode, appliesTo: "Chrome" },
        },
        usageSummaries: { enabled: spec.usageSummaries.enabled, collectingNow: collecting },
        dataInventory: dataInventory(o.usage_retention_days, o.audit_retention_days),
      };
    });
  });

  app.post("/device/v1/checkin", async (req) => {
    const { deviceId, orgId } = await deviceAuth(req);
    await withTenant(orgId, (tx) => tx.query("UPDATE devices SET last_checkin_at = now() WHERE id = $1", [deviceId]));
    return { ok: true };
  });

  /** Daily per-app minute totals. Rejected unless the supervisor enabled summaries AND billing is active. */
  app.post("/device/v1/usage", async (req, reply) => {
    const { deviceId, orgId } = await deviceAuth(req);
    const body = UsageUpload.parse(req.body);
    const day = new Date(`${body.day}T00:00:00Z`);
    const now = deps.now();
    const ageDays = (now.getTime() - day.getTime()) / 86400_000;
    if (Number.isNaN(ageDays) || ageDays < -1 || ageDays > 3) throw new HttpError(400, "day_out_of_range");
    return withTenant(orgId, async (tx) => {
      const d = (await tx.query("SELECT student_id, state FROM devices WHERE id = $1", [deviceId])).rows[0];
      if (!d || d.state !== "active") throw unauthorized();
      const { spec } = await loadSpec(tx, d.student_id);
      const sub = (await tx.query("SELECT plan, status, current_period_end, grace_until FROM subscriptions")).rows[0];
      if (!spec.usageSummaries.enabled) return reply.status(409).send({ error: "usage_summaries_disabled", collect: false });
      if (accessLevel(sub, now) !== "full") return reply.status(409).send({ error: "collection_paused", collect: false });
      for (const a of body.apps) {
        await tx.query(
          `INSERT INTO app_usage_daily (org_id, device_id, student_id, day, package, minutes)
           VALUES (app_current_org(), $1, $2, $3, $4, $5)
           ON CONFLICT (device_id, day, package) DO UPDATE SET minutes = EXCLUDED.minutes`,
          [deviceId, d.student_id, body.day, a.package, a.minutes]);
      }
      await tx.query("UPDATE devices SET last_checkin_at = now() WHERE id = $1", [deviceId]);
      return { accepted: body.apps.length, collect: true };
    });
  });
}
