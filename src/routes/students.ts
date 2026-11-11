import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant, type Tx } from "../db/pool.js";
import { requirePerm, requireStudentAccess, visibleStudents } from "../auth/rbac.js";
import { audit } from "../audit.js";
import { HttpError } from "../lib/errors.js";
import { accessLevel, PLAN_LIMITS } from "../billing/entitlements.js";
import { parsePolicySpec } from "../policy/spec.js";
import { deployDevicePolicy, loadSpec } from "../policy/deploy.js";

const Uuid = z.string().uuid();
const StudentParams = z.object({ orgId: Uuid, studentId: Uuid });

export async function requireFullAccess(tx: Tx, now: Date): Promise<void> {
  const sub = (await tx.query("SELECT plan, status, current_period_end, grace_until FROM subscriptions")).rows[0];
  if (!sub || accessLevel(sub, now) !== "full") throw new HttpError(402, "subscription_inactive_read_only");
}

export async function studentRoutes(app: FastifyInstance) {
  const { deps } = app;

  app.post("/v1/orgs/:orgId/students", async (req, reply) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "student.create");
    const body = z.object({
      displayName: z.string().trim().min(1).max(80), // a nickname is fine; no legal name required
      ageBand: z.enum(["under_13", "13_15", "16_17"]),
    }).parse(req.body);
    return withTenant(ctx.orgId, async (tx) => {
      const sub = (await tx.query("SELECT plan FROM subscriptions")).rows[0];
      const count = Number((await tx.query("SELECT count(*) FROM students")).rows[0].count);
      if (count >= PLAN_LIMITS[sub.plan as "individual" | "organization"].students) throw new HttpError(402, "student_limit_reached");
      const r = await tx.query(
        "INSERT INTO students (org_id, display_name, age_band) VALUES (app_current_org(), $1, $2) RETURNING id, display_name, age_band, created_at",
        [body.displayName, body.ageBand],
      );
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "student.created", targetType: "student", targetId: r.rows[0].id, ip: ctx.ip });
      return reply.status(201).send(r.rows[0]);
    });
  });

  app.get("/v1/orgs/:orgId/students", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "student.read");
    return withTenant(ctx.orgId, async (tx) => {
      const f = visibleStudents(ctx);
      const r = await tx.query(`SELECT s.id, s.display_name, s.age_band, s.created_at FROM students s WHERE ${f.sql} ORDER BY s.display_name`, f.params);
      return { students: r.rows };
    });
  });

  app.get("/v1/orgs/:orgId/students/:studentId", async (req) => {
    const ctx = await app.userCtx(req);
    const { studentId } = StudentParams.parse(req.params);
    return withTenant(ctx.orgId, async (tx) => {
      await requireStudentAccess(tx, ctx, studentId, "student.read");
      const s = (await tx.query("SELECT id, display_name, age_band, created_at FROM students WHERE id = $1", [studentId])).rows[0];
      const devices = (await tx.query(
        `SELECT id, label, ownership, platform, state, last_checkin_at, last_status_at, applied_policy_version, in_downtime
         FROM devices WHERE student_id = $1 ORDER BY created_at`, [studentId])).rows;
      return { ...s, devices };
    });
  });

  // ---- Policy ---------------------------------------------------------------
  app.get("/v1/orgs/:orgId/students/:studentId/policy", async (req) => {
    const ctx = await app.userCtx(req);
    const { studentId } = StudentParams.parse(req.params);
    return withTenant(ctx.orgId, async (tx) => {
      await requireStudentAccess(tx, ctx, studentId, "student.read");
      const { spec, version } = await loadSpec(tx, studentId);
      // Latest deployment per device: shows pending / applied / failed, plus per-control support.
      const rollout = (await tx.query(
        `SELECT DISTINCT ON (d.id) d.id AS device_id, d.label, d.state, pd.spec_version, pd.status, pd.detail, pd.updated_at
         FROM devices d LEFT JOIN policy_deployments pd ON pd.device_id = d.id
         WHERE d.student_id = $1 AND d.state <> 'retired'
         ORDER BY d.id, pd.created_at DESC NULLS LAST`, [studentId])).rows.map((r) => ({
        deviceId: r.device_id, label: r.label, deviceState: r.state, specVersion: r.spec_version,
        status: r.status ?? "pending", controls: r.detail?.controls ?? [], error: r.detail?.error,
        nonCompliance: r.detail?.nonCompliance ?? [], updatedAt: r.updated_at,
      }));
      return { version, spec, rollout };
    });
  });

  app.put("/v1/orgs/:orgId/students/:studentId/policy", async (req) => {
    const ctx = await app.userCtx(req);
    const { studentId } = StudentParams.parse(req.params);
    const body = z.object({ spec: z.unknown(), expectedVersion: z.number().int().min(0) }).parse(req.body);
    const spec = parsePolicySpec(body.spec);
    return withTenant(ctx.orgId, async (tx) => {
      await requireStudentAccess(tx, ctx, studentId, "policy.write");
      await requireFullAccess(tx, deps.now());
      const current = await tx.query("SELECT version FROM policies WHERE student_id = $1 FOR UPDATE", [studentId]);
      const currentVersion = current.rows[0] ? Number(current.rows[0].version) : 0;
      // Optimistic concurrency: two supervisors cannot silently overwrite each other.
      if (currentVersion !== body.expectedVersion) throw new HttpError(409, "policy_version_conflict");
      const version = currentVersion + 1;
      await tx.query(
        `INSERT INTO policies (org_id, student_id, version, spec, updated_by) VALUES (app_current_org(), $1, $2, $3, $4)
         ON CONFLICT (org_id, student_id) DO UPDATE SET version = EXCLUDED.version, spec = EXCLUDED.spec,
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [studentId, version, JSON.stringify(spec), ctx.userId],
      );
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "policy.updated", targetType: "student", targetId: studentId,
        metadata: { version, apps: spec.apps.mode, appCount: spec.apps.packages.length, web: spec.web.mode, downtime: spec.downtime.enabled, usageSummaries: spec.usageSummaries.enabled }, ip: ctx.ip });

      const devices = (await tx.query("SELECT id FROM devices WHERE student_id = $1 AND state IN ('active', 'pending_enrollment')", [studentId])).rows;
      const results = [];
      for (const d of devices) results.push({ deviceId: d.id, ...(await deployDevicePolicy(tx, deps.mdm, d.id, "policy_change", deps.now())) });
      // Never claim "applied" here: devices confirm asynchronously.
      return { version, deployments: results.map(({ deviceId, status }) => ({ deviceId, status })) };
    });
  });

  // ---- Activity summary -------------------------------------------------------
  app.get("/v1/orgs/:orgId/students/:studentId/activity", async (req) => {
    const ctx = await app.userCtx(req);
    const { studentId } = StudentParams.parse(req.params);
    const query = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).parse(req.query);
    return withTenant(ctx.orgId, async (tx) => {
      await requireStudentAccess(tx, ctx, studentId, "activity.read");
      const daily = (await tx.query(
        `SELECT day, sum(minutes)::int AS minutes FROM app_usage_daily
         WHERE student_id = $1 AND day >= current_date - $2::int GROUP BY day ORDER BY day`, [studentId, query.days])).rows;
      const topApps = (await tx.query(
        `SELECT package, sum(minutes)::int AS minutes FROM app_usage_daily
         WHERE student_id = $1 AND day >= current_date - $2::int GROUP BY package ORDER BY minutes DESC LIMIT 10`, [studentId, query.days])).rows;
      const devices = (await tx.query(
        `SELECT id, label, state, last_checkin_at, last_status_at, compliance->'policyCompliant' AS policy_compliant, in_downtime
         FROM devices WHERE student_id = $1 AND state <> 'retired'`, [studentId])).rows;
      const { spec } = await loadSpec(tx, studentId);
      // Viewing a child's activity is itself an audited event.
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "activity.viewed", targetType: "student", targetId: studentId, metadata: { days: query.days }, ip: ctx.ip });
      return { usageSummariesEnabled: spec.usageSummaries.enabled, days: query.days, daily, topApps, devices };
    });
  });

  // ---- Export / deletion --------------------------------------------------------
  app.get("/v1/orgs/:orgId/students/:studentId/export", async (req) => {
    const ctx = await app.userCtx(req);
    const { studentId } = StudentParams.parse(req.params);
    return withTenant(ctx.orgId, async (tx) => {
      await requireStudentAccess(tx, ctx, studentId, "data.export");
      const student = (await tx.query("SELECT id, display_name, age_band, created_at FROM students WHERE id = $1", [studentId])).rows[0];
      const devices = (await tx.query("SELECT id, label, ownership, platform, state, created_at, last_checkin_at FROM devices WHERE student_id = $1", [studentId])).rows;
      const policy = (await tx.query("SELECT version, spec, updated_at FROM policies WHERE student_id = $1", [studentId])).rows[0] ?? null;
      const usage = (await tx.query("SELECT day, package, minutes FROM app_usage_daily WHERE student_id = $1 ORDER BY day, package", [studentId])).rows;
      await tx.query("INSERT INTO data_requests (org_id, student_id, kind, requested_by, completed_at) VALUES (app_current_org(), $1, 'export', $2, now())", [studentId, ctx.userId]);
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "student.exported", targetType: "student", targetId: studentId, ip: ctx.ip });
      return { exportedAt: new Date().toISOString(), student, devices, policy, appUsageDaily: usage };
    });
  });

  app.delete("/v1/orgs/:orgId/students/:studentId", async (req, reply) => {
    const ctx = await app.userCtx(req);
    const { studentId } = StudentParams.parse(req.params);
    return withTenant(ctx.orgId, async (tx) => {
      await requireStudentAccess(tx, ctx, studentId, "data.delete");
      const active = await tx.query("SELECT 1 FROM devices WHERE student_id = $1 AND state <> 'retired'", [studentId]);
      if (active.rowCount) throw new HttpError(409, "retire_devices_first");
      await tx.query("DELETE FROM students WHERE id = $1", [studentId]); // cascades to devices, policy, usage
      await tx.query("INSERT INTO data_requests (org_id, student_id, kind, requested_by, completed_at) VALUES (app_current_org(), NULL, 'delete', $1, now())", [ctx.userId]);
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "student.deleted", targetType: "student", targetId: studentId, ip: ctx.ip });
      return reply.status(204).send();
    });
  });
}
