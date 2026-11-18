import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { accessLevel } from "../billing/entitlements.js";
import { withTenant } from "../db/pool.js";
import { requirePerm } from "../auth/rbac.js";
import { audit } from "../audit.js";
import { hashToken, newToken } from "../lib/tokens.js";
import { HttpError } from "../lib/errors.js";
import { config } from "../config.js";
import { layout } from "../lib/mailer.js";

const Uuid = z.string().uuid();
const INVITE_TTL_MS = 72 * 3600_000;

/** Machine-readable "what we collect" statement shown in the portal and on the device. */
export function dataInventory(usageRetentionDays: number, auditRetentionDays: number) {
  return {
    collected: [
      { item: "Student display name and age band", purpose: "Identify the profile and pick age-appropriate notices", visibleTo: "org admins; assigned supervisors", retention: "until the profile is deleted" },
      { item: "Device status (enrolled, last check-in, policy version, compliance)", purpose: "Show whether controls are applied", visibleTo: "org admins; assigned supervisors", retention: "until the device is retired" },
      { item: "Daily minutes per app (only if usage summaries are enabled)", purpose: "Screen-time summary", visibleTo: "org admins; assigned supervisors", retention: `${usageRetentionDays} days` },
      { item: "Audit log of supervisor actions, including who viewed activity", purpose: "Accountability", visibleTo: "org admins", retention: `${auditRetentionDays} days` },
    ],
    notCollected: [
      "messages, emails or chat content", "keystrokes", "screenshots, camera or microphone",
      "location", "browsing history or search terms", "contacts, photos or files", "passwords or credentials",
    ],
  };
}

export async function orgRoutes(app: FastifyInstance) {
  app.get("/v1/orgs/:orgId", async (req) => {
    const ctx = await app.userCtx(req);
    return withTenant(ctx.orgId, async (tx) => {
      const o = (await tx.query("SELECT id, kind, name, country, usage_retention_days, audit_retention_days, amapi_enterprise IS NOT NULL AS android_configured FROM organizations")).rows[0];
      const sub = (await tx.query("SELECT plan, status, current_period_end, grace_until FROM subscriptions")).rows[0];
      // false => everything except billing is locked until they pay (see app.ts).
      const paid = !!sub && accessLevel(sub, app.deps.now()) === "full";
      return { ...o, myRole: ctx.role, paid, everPaid: !!sub && sub.status !== "none", companionAppEnabled: config().COMPANION_APP_ENABLED, pilotMode: config().NODE_ENV !== "production" };
    });
  });

  app.patch("/v1/orgs/:orgId/settings", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "org.manage");
    const body = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      usageRetentionDays: z.number().int().min(1).max(90).optional(),
      auditRetentionDays: z.number().int().min(90).max(2555).optional(),
    }).parse(req.body);
    return withTenant(ctx.orgId, async (tx) => {
      const r = await tx.query(
        `UPDATE organizations SET name = COALESCE($1, name), usage_retention_days = COALESCE($2, usage_retention_days),
           audit_retention_days = COALESCE($3, audit_retention_days)
         RETURNING name, usage_retention_days, audit_retention_days`,
        [body.name ?? null, body.usageRetentionDays ?? null, body.auditRetentionDays ?? null],
      );
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "org.settings_updated", metadata: body, ip: ctx.ip });
      return r.rows[0];
    });
  });

  app.get("/v1/orgs/:orgId/data-inventory", async (req) => {
    const ctx = await app.userCtx(req);
    return withTenant(ctx.orgId, async (tx) => {
      const o = (await tx.query("SELECT usage_retention_days, audit_retention_days FROM organizations")).rows[0];
      return dataInventory(o.usage_retention_days, o.audit_retention_days);
    });
  });

  app.post("/v1/orgs/:orgId/invitations", async (req, reply) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "org.manage");
    const body = z.object({
      email: z.string().email().max(254),
      role: z.enum(["org_admin", "supervisor", "guardian"]),
      // Required for guardians: the one child this parent may see and consent for.
      studentId: Uuid.optional(),
    }).refine((b) => (b.role === "guardian") === !!b.studentId, "studentId is required for guardians (only)").parse(req.body);
    const token = newToken();
    return withTenant(ctx.orgId, async (tx) => {
      if (body.studentId && !(await tx.query("SELECT 1 FROM students WHERE id = $1", [body.studentId])).rowCount) {
        throw new HttpError(400, "unknown_student");
      }
      const r = await tx.query(
        `INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at, student_id)
         VALUES (app_current_org(), $1, $2, $3, $4, $5, $6) RETURNING id, expires_at`,
        [body.email, body.role, hashToken(token), ctx.userId, new Date(Date.now() + INVITE_TTL_MS), body.studentId ?? null],
      );
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "invitation.created", targetType: "invitation", targetId: r.rows[0].id, metadata: { role: body.role, studentId: body.studentId ?? null }, ip: ctx.ip });
      const acceptUrl = `${config().PUBLIC_BASE_URL}/app#/invite/${token}`;
      const prod = config().NODE_ENV === "production";
      if (prod && !app.deps.mailer.configured) throw new HttpError(503, "email_not_configured");

      // Email the link to the invitee only. (Outside production the link is also shown to
      // the inviter, so the pilot works before an email service is set up.)
      const org = (await tx.query("SELECT name FROM organizations")).rows[0];
      const inviter = (await tx.query("SELECT display_name FROM users WHERE id = $1", [ctx.userId])).rows[0];
      const child = body.studentId ? (await tx.query("SELECT display_name FROM students WHERE id = $1", [body.studentId])).rows[0] : null;
      const { html, text } = layout(body.role === "guardian"
        ? {
            title: `${org.name} invited you to SafeTab`,
            intro: `${inviter.display_name} at ${org.name} invited you as a parent of ${child?.display_name ?? "your child"}. In SafeTab you can see the school-hours rules for your child's tablet and choose whether to agree. Nothing changes on the tablet unless you agree.`,
            button: { label: "View invitation", url: acceptUrl },
            outro: "This link works once and expires in 3 days. If you weren't expecting it, you can ignore this email.",
          }
        : {
            title: `Join ${org.name} on SafeTab`,
            intro: `${inviter.display_name} invited you to help manage ${org.name}'s tablets on SafeTab as ${body.role === "org_admin" ? "an admin" : "a teacher / supervisor"}.`,
            button: { label: "Accept invitation", url: acceptUrl },
            outro: "This link works once and expires in 3 days. If you weren't expecting it, you can ignore this email.",
          });
      let emailed = false;
      try {
        await app.deps.mailer.send({ to: body.email, subject: body.role === "guardian" ? `${org.name}: school-hours rules for ${child?.display_name ?? "your child"}` : `Invitation to join ${org.name}`, html, text });
        emailed = app.deps.mailer.configured;
      } catch (e) {
        if (prod) throw new HttpError(502, "email_failed");
        req.log.warn({ err: e instanceof Error ? e.message : String(e) }, "invitation email failed");
      }
      return reply.status(201).send({ id: r.rows[0].id, expiresAt: r.rows[0].expires_at, emailed, ...(prod ? {} : { acceptUrl, token }) });
    });
  });

  app.get("/v1/orgs/:orgId/members", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "org.manage");
    return withTenant(ctx.orgId, async (tx) => {
      const r = await tx.query(
        `SELECT m.user_id, m.role, m.created_at,
           COALESCE(array_agg(a.student_id) FILTER (WHERE a.student_id IS NOT NULL), '{}') AS assigned_students
         FROM memberships m LEFT JOIN supervisor_assignments a ON a.user_id = m.user_id
         GROUP BY m.user_id, m.role, m.created_at ORDER BY m.created_at`,
      );
      return { members: r.rows };
    });
  });

  app.put("/v1/orgs/:orgId/members/:userId/assignments", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "org.manage");
    const { userId } = z.object({ userId: Uuid }).parse(req.params);
    const body = z.object({ studentIds: z.array(Uuid).max(1000) }).parse(req.body);
    return withTenant(ctx.orgId, async (tx) => {
      const m = await tx.query("SELECT role FROM memberships WHERE user_id = $1", [userId]);
      if (!m.rows[0]) throw new HttpError(404, "member_not_found");
      const ids = [...new Set(body.studentIds)];
      // RLS limits this count to the caller's org, so foreign student IDs are rejected.
      const found = Number((await tx.query("SELECT count(*) FROM students WHERE id = ANY($1::uuid[])", [ids])).rows[0].count);
      if (found !== ids.length) throw new HttpError(400, "unknown_student");
      await tx.query("DELETE FROM supervisor_assignments WHERE user_id = $1", [userId]);
      for (const sid of ids) {
        // FK (org_id, student_id) guarantees the student belongs to this org.
        await tx.query("INSERT INTO supervisor_assignments (org_id, user_id, student_id) VALUES (app_current_org(), $1, $2)", [userId, sid]);
      }
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "member.assignments_updated", targetType: "user", targetId: userId, metadata: { count: ids.length }, ip: ctx.ip });
      return { userId, studentIds: ids };
    });
  });

  app.delete("/v1/orgs/:orgId/members/:userId", async (req, reply) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "org.manage");
    const { userId } = z.object({ userId: Uuid }).parse(req.params);
    return withTenant(ctx.orgId, async (tx) => {
      const admins = Number((await tx.query("SELECT count(*) FROM memberships WHERE role = 'org_admin' AND user_id <> $1", [userId])).rows[0].count);
      if (admins === 0) throw new HttpError(409, "cannot_remove_last_admin");
      await tx.query("DELETE FROM memberships WHERE user_id = $1", [userId]);
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "member.removed", targetType: "user", targetId: userId, ip: ctx.ip });
      return reply.status(204).send();
    });
  });

  app.get("/v1/orgs/:orgId/audit", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "audit.read");
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.number().int().optional() }).parse(req.query);
    return withTenant(ctx.orgId, async (tx) => {
      const r = await tx.query(
        `SELECT a.id, a.actor_type, a.actor_id, a.action, a.target_type, a.target_id, a.metadata, a.created_at,
           u.display_name AS actor_name,
           CASE WHEN a.target_type = 'student' THEN (SELECT display_name FROM students s WHERE s.id::text = a.target_id) END AS target_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
         WHERE ($1::bigint IS NULL OR a.id < $1) ORDER BY a.id DESC LIMIT $2`,
        [query.before ?? null, query.limit],
      );
      return { entries: r.rows };
    });
  });
}
