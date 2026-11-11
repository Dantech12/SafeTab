import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q, withTenant } from "../db/pool.js";
import { dummyVerify, hashPassword, verifyPassword } from "../auth/passwords.js";
import { hashToken, newToken } from "../lib/tokens.js";
import { HttpError, unauthorized } from "../lib/errors.js";
import { audit } from "../audit.js";
import { PLAN_LIMITS } from "../billing/entitlements.js";

const Password = z.string().min(12, "use at least 12 characters").max(200);
const SESSION_TTL_MS = 12 * 3600_000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;

async function issueSession(userId: string) {
  const token = newToken();
  await q("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)", [
    userId, hashToken(token), new Date(Date.now() + SESSION_TTL_MS),
  ]);
  return token;
}

const Signup = z.object({
  email: z.string().email().max(254),
  password: Password,
  displayName: z.string().trim().min(1).max(120),
  account: z.object({
    kind: z.enum(["family", "school"]),
    name: z.string().trim().min(1).max(200),
    country: z.string().regex(/^[A-Z]{2}$/).optional(),
  }),
});

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  // Adults only: students never get portal accounts and never type a parent's password.
  app.post("/v1/auth/signup", strict, async (req, reply) => {
    const body = Signup.parse(req.body);
    const hash = await hashPassword(body.password);
    const u = await q("INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id",
      [body.email, hash, body.displayName]);
    // Same response shape whether or not the email exists would require email verification
    // flows; until those exist we return a generic conflict.
    if (!u.rows[0]) throw new HttpError(409, "signup_failed");
    const userId = u.rows[0].id as string;
    const org = await q("SELECT create_organization($1, $2, $3, $4) AS id", [body.account.kind, body.account.name, body.account.country ?? null, userId]);
    const orgId = org.rows[0].id as string;
    await withTenant(orgId, (tx) => audit(tx, { actorType: "user", actorId: userId, action: "org.created", targetType: "org", targetId: orgId, ip: req.ip }));
    const token = await issueSession(userId);
    return reply.status(201).send({ token, userId, orgId });
  });

  app.post("/v1/auth/login", strict, async (req) => {
    const body = z.object({ email: z.string().email(), password: z.string().max(200) }).parse(req.body);
    const r = await q("SELECT id, password_hash, failed_logins, locked_until FROM users WHERE email = $1", [body.email]);
    const user = r.rows[0];
    if (!user) {
      await dummyVerify(body.password);
      throw unauthorized("invalid_credentials");
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) throw unauthorized("invalid_credentials");
    if (!(await verifyPassword(user.password_hash, body.password))) {
      const fails = user.failed_logins + 1;
      await q("UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1", [
        user.id, fails >= MAX_FAILED ? 0 : fails, fails >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : null,
      ]);
      throw unauthorized("invalid_credentials");
    }
    await q("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1", [user.id]);
    const token = await issueSession(user.id);
    const orgs = await q("SELECT org_id, role, org_name, org_kind FROM lookup_user_memberships($1)", [user.id]);
    return { token, orgs: orgs.rows };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const { sessionId } = await app.sessionUser(req);
    await q("UPDATE sessions SET revoked_at = now() WHERE id = $1", [sessionId]);
    return reply.status(204).send();
  });

  app.get("/v1/me", async (req) => {
    const { userId } = await app.sessionUser(req);
    const u = await q("SELECT id, email, display_name FROM users WHERE id = $1", [userId]);
    const orgs = await q("SELECT org_id, role, org_name, org_kind FROM lookup_user_memberships($1)", [userId]);
    return { user: u.rows[0], orgs: orgs.rows };
  });

  /**
   * Accept an invitation. The invitation is bound to an email address: an existing account
   * must be signed in with that same email; a new account is created with that email.
   * This prevents an invite link from being used to link an unrelated account.
   */
  app.post("/v1/invitations/accept", strict, async (req, reply) => {
    const body = z.object({
      token: z.string().min(20).max(200),
      password: Password.optional(),
      displayName: z.string().trim().min(1).max(120).optional(),
    }).parse(req.body);
    const inv = (await q("SELECT id, org_id FROM lookup_invitation($1)", [hashToken(body.token)])).rows[0];
    if (!inv) throw new HttpError(400, "invalid_or_expired_invitation");

    return withTenant(inv.org_id, async (tx) => {
      const invitation = (await tx.query("SELECT email, role, student_id FROM invitations WHERE id = $1 FOR UPDATE", [inv.id])).rows[0];
      if (invitation.role !== "guardian") {
        // Parents don't count toward the staff seat limit.
        const sub = (await tx.query("SELECT plan FROM subscriptions")).rows[0];
        const members = Number((await tx.query("SELECT count(*) FROM memberships WHERE role <> 'guardian'")).rows[0].count);
        if (members >= PLAN_LIMITS[sub.plan as "individual" | "organization"].members) throw new HttpError(402, "member_limit_reached");
      }

      let userId: string;
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const s = await app.sessionUser(req);
        const u = (await q("SELECT email FROM users WHERE id = $1", [s.userId])).rows[0];
        if (u.email.toLowerCase() !== String(invitation.email).toLowerCase()) throw new HttpError(403, "invitation_email_mismatch");
        userId = s.userId;
      } else {
        if (!body.password || !body.displayName) throw new HttpError(400, "password_and_display_name_required");
        const existing = await q("SELECT 1 FROM users WHERE email = $1", [invitation.email]);
        if (existing.rowCount) throw new HttpError(409, "sign_in_to_accept");
        const created = await q("INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id",
          [invitation.email, await hashPassword(body.password), body.displayName]);
        userId = created.rows[0].id;
      }
      const existing = (await tx.query("SELECT role FROM memberships WHERE user_id = $1", [userId])).rows[0];
      if (existing && existing.role !== "guardian" && invitation.role === "guardian") {
        throw new HttpError(409, "staff_account_cannot_be_guardian_use_another_email");
      }
      if (!existing) {
        await tx.query("INSERT INTO memberships (org_id, user_id, role) VALUES (app_current_org(), $1, $2)", [userId, invitation.role]);
      } else if (existing.role === "guardian" && invitation.role !== "guardian") {
        // A parent who is also invited as staff becomes staff (the inviter chose this).
        await tx.query("UPDATE memberships SET role = $2 WHERE user_id = $1", [userId, invitation.role]);
      }
      if (invitation.student_id) {
        // A parent with two children at the school accepts one invitation per child.
        await tx.query(
          "INSERT INTO supervisor_assignments (org_id, user_id, student_id) VALUES (app_current_org(), $1, $2) ON CONFLICT DO NOTHING",
          [userId, invitation.student_id]);
      }
      await tx.query("UPDATE invitations SET accepted_at = now() WHERE id = $1", [inv.id]);
      await audit(tx, { actorType: "user", actorId: userId, action: "member.joined", targetType: "user", targetId: userId, metadata: { role: invitation.role }, ip: req.ip });
      const token = authHeader ? undefined : await issueSession(userId);
      return reply.status(200).send({ orgId: inv.org_id, role: invitation.role, token });
    });
  });
}
