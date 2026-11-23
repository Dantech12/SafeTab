import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q, withTenant } from "../db/pool.js";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { hashToken, newToken } from "../lib/tokens.js";
import { hashPassword } from "../auth/passwords.js";
import { layout } from "../lib/mailer.js";

const RESET_TTL_MS = 30 * 60_000;
const MAX_PER_HOUR = 3;
const Password = z.string().min(12, "use at least 12 characters").max(200);

/**
 * "Forgot password?":
 *  - The request endpoint always answers the same way, whether or not the email has an
 *    account, and sends the email in the background (no timing difference).
 *  - Links are random, single use, expire after 30 minutes, and only their hash is stored.
 *  - Setting a new password signs the user out everywhere and sends a notice email.
 */
export async function passwordRoutes(app: FastifyInstance) {
  const { deps } = app;
  const strict = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };

  app.post("/v1/auth/password/forgot", strict, async (req) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(req.body);
    const generic = { ok: true, message: "If an account exists for that email, we've sent a link to reset the password." };

    void (async () => {
      const user = (await q("SELECT id, display_name FROM users WHERE email = $1", [email])).rows[0];
      if (!user) return;
      const recent = Number((await q("SELECT count(*) FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '1 hour'", [user.id])).rows[0].count);
      if (recent >= MAX_PER_HOUR) return; // quietly limit; the response is the same
      const token = newToken();
      await q("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [user.id, hashToken(token), new Date(Date.now() + RESET_TTL_MS)]);
      const url = `${config().PUBLIC_BASE_URL}/app#/reset/${token}`;
      const { html, text } = layout({
        title: "Reset your password",
        intro: `Hi ${user.display_name}, someone (hopefully you) asked to reset the password for your ${config().BUSINESS_NAME || "SafeTab"} account. This link works once and expires in 30 minutes.`,
        button: { label: "Choose a new password", url },
        outro: "If you didn't ask for this, you can ignore this email. Your password won't change.",
      });
      await deps.mailer.send({ to: email, subject: "Reset your password", html, text });
    })().catch((e) => req.log.error({ err: e instanceof Error ? e.message : String(e) }, "password reset email failed"));

    return generic;
  });

  /** Lets the reset page show a friendly message before asking for a password. */
  app.post("/v1/auth/password/check", strict, async (req) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    const r = (await q(
      `SELECT u.email FROM password_resets p JOIN users u ON u.id = p.user_id
       WHERE p.token_hash = $1 AND p.used_at IS NULL AND p.expires_at > now()`, [hashToken(token)])).rows[0];
    if (!r) throw new HttpError(400, "reset_link_invalid");
    return { email: r.email };
  });

  app.post("/v1/auth/password/reset", strict, async (req) => {
    const body = z.object({ token: z.string().min(20).max(200), password: Password }).parse(req.body);
    // Single use: consume the link atomically.
    const row = (await q(
      `UPDATE password_resets SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`, [hashToken(body.token)])).rows[0];
    if (!row) throw new HttpError(400, "reset_link_invalid");

    const hash = await hashPassword(body.password);
    const u = (await q(
      "UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1 RETURNING email, display_name",
      [row.user_id, hash])).rows[0];
    // Sign out everywhere, and invalidate any other outstanding reset links.
    await q("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [row.user_id]);
    await q("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [row.user_id]);

    const orgs = (await q("SELECT org_id FROM lookup_user_memberships($1)", [row.user_id])).rows;
    for (const o of orgs) {
      await withTenant(o.org_id, (tx) => audit(tx, { actorType: "user", actorId: row.user_id, action: "auth.password_reset", ip: req.ip }));
    }
    const { html, text } = layout({
      title: "Your password was changed",
      intro: `Hi ${u.display_name}, the password for your ${config().BUSINESS_NAME || "SafeTab"} account was just changed, and you were signed out on all devices.`,
      outro: `If this wasn't you, reset your password again straight away${config().SUPPORT_EMAIL ? ` and contact ${config().SUPPORT_EMAIL}` : ""}.`,
    });
    deps.mailer.send({ to: u.email, subject: "Your password was changed", html, text })
      .catch((e) => req.log.error({ err: e instanceof Error ? e.message : String(e) }, "password changed email failed"));
    return { ok: true };
  });
}
