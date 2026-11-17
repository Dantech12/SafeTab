import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q, withTenant } from "../db/pool.js";
import { audit } from "../audit.js";
import { HttpError } from "../lib/errors.js";
import { hashToken } from "../lib/tokens.js";
import { authorizeUrl, completeSignIn, enabledProviders, isProvider, OidcError, PROVIDERS, randomToken, type VerifiedIdentity } from "../auth/oidc.js";
import { issueSession } from "./auth.js";

const STATE_TTL_MS = 10 * 60_000;
const LOGIN_CODE_TTL_MS = 2 * 60_000;
const MAX_WORKSPACES = 5;
// Only these portal locations may be used as "continue to" after sign-in.
const NEXT_RE = /^#\/(subscribe(\/(school|family))?|signup\/(school|family)|(invite|claim)\/[A-Za-z0-9_-]{20,200})$/;

/** Finds or creates the SafeTab user for a verified provider identity. */
async function userFor(id: VerifiedIdentity): Promise<{ userId: string; created: boolean } | { error: string }> {
  const linked = (await q("SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2", [id.provider, id.subject])).rows[0];
  if (linked) return { userId: linked.user_id, created: false };
  if (!id.email) return { error: "no_email" };

  const existing = (await q("SELECT id FROM users WHERE email = $1", [id.email])).rows[0];
  if (existing) {
    // Link only when the provider vouches for the email address (Google does; Microsoft
    // doesn't), so nobody can take over an account with an unverified address.
    if (!id.emailVerified) return { error: "email_in_use" };
    await q("INSERT INTO user_identities (provider, subject, user_id, email) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [id.provider, id.subject, existing.id, id.email]);
    return { userId: existing.id, created: false };
  }
  const name = id.name || id.email.split("@")[0]!;
  const u = (await q("INSERT INTO users (email, password_hash, display_name) VALUES ($1, NULL, $2) RETURNING id", [id.email, name.slice(0, 120)])).rows[0];
  await q("INSERT INTO user_identities (provider, subject, user_id, email) VALUES ($1, $2, $3, $4)", [id.provider, id.subject, u.id, id.email]);
  return { userId: u.id, created: true };
}

export async function oauthRoutes(app: FastifyInstance) {
  const { deps } = app;
  const strict = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

  app.get("/v1/public/auth-providers", async () => ({ providers: enabledProviders() }));

  app.get("/auth/:provider/start", strict, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!isProvider(provider) || !enabledProviders().some((p) => p.id === provider)) return reply.redirect("/app#/oauth-error/not_enabled");
    const nextRaw = (req.query as { next?: string }).next;
    const next = nextRaw && NEXT_RE.test(nextRaw) ? nextRaw : null;
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken(48);
    await q(
      "INSERT INTO oauth_states (state_hash, provider, code_verifier, nonce, next, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [hashToken(state), provider, verifier, nonce, next, new Date(Date.now() + STATE_TTL_MS)]);
    return reply.redirect(authorizeUrl(provider, state, nonce, verifier));
  });

  app.get("/auth/:provider/callback", strict, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const query = req.query as { code?: string; state?: string; error?: string };
    if (!isProvider(provider)) return reply.redirect("/app#/oauth-error/not_enabled");
    if (query.error) return reply.redirect("/app#/oauth-error/cancelled");
    if (!query.code || !query.state) return reply.redirect("/app#/oauth-error/invalid");

    // Single use: the state row is consumed atomically.
    const st = (await q(
      `UPDATE oauth_states SET used_at = now()
       WHERE state_hash = $1 AND provider = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING id, code_verifier, nonce, next`, [hashToken(query.state), provider])).rows[0];
    if (!st) return reply.redirect("/app#/oauth-error/expired");

    let identity: VerifiedIdentity;
    try {
      identity = await completeSignIn(provider, query.code, st.code_verifier, st.nonce, deps.oidc);
    } catch (e) {
      req.log.warn({ err: e instanceof Error ? e.message : String(e), provider }, "oidc sign-in failed");
      return reply.redirect(`/app#/oauth-error/${e instanceof OidcError ? "invalid" : "provider_unavailable"}`);
    }
    const result = await userFor(identity);
    if ("error" in result) return reply.redirect(`/app#/oauth-error/${result.error}`);

    const loginCode = randomToken();
    await q("UPDATE oauth_states SET login_code_hash = $2, user_id = $3, expires_at = $4 WHERE id = $1",
      [st.id, hashToken(loginCode), result.userId, new Date(Date.now() + LOGIN_CODE_TTL_MS)]);
    return reply.redirect(`/app#/oauth/${loginCode}`);
  });

  /** The portal swaps the one-time code (from the URL fragment) for a session. */
  app.post("/v1/auth/oauth/exchange", strict, async (req) => {
    const { code } = z.object({ code: z.string().min(20).max(200) }).parse(req.body);
    const row = (await q(
      `UPDATE oauth_states SET login_code_hash = NULL, expires_at = now()
       WHERE login_code_hash = $1 AND expires_at > now()
       RETURNING user_id, next, provider`, [hashToken(code)])).rows[0];
    if (!row) throw new HttpError(400, "oauth_code_expired");
    const token = await issueSession(row.user_id);
    const orgs = (await q("SELECT org_id, role, org_name, org_kind FROM lookup_user_memberships($1)", [row.user_id])).rows;
    for (const o of orgs) {
      await withTenant(o.org_id, (tx) => audit(tx, { actorType: "user", actorId: row.user_id, action: "auth.signed_in_with_provider", metadata: { provider: row.provider }, ip: req.ip }));
    }
    return { token, next: row.next, orgs, providerName: PROVIDERS[row.provider as "google"].name };
  });

  /** Creates a workspace for a signed-in user (e.g. after signing up with Google). */
  app.post("/v1/orgs", strict, async (req, reply) => {
    const { userId } = await app.sessionUser(req);
    const body = z.object({
      kind: z.enum(["family", "school"]),
      name: z.string().trim().min(1).max(200),
      country: z.string().regex(/^[A-Z]{2}$/).optional(),
    }).parse(req.body);
    const count = (await q("SELECT count_user_orgs($1) AS n", [userId])).rows[0].n;
    if (count >= MAX_WORKSPACES) throw new HttpError(409, "workspace_limit_reached");
    const orgId = (await q("SELECT create_organization($1, $2, $3, $4) AS id", [body.kind, body.name, body.country ?? null, userId])).rows[0].id;
    await withTenant(orgId, (tx) => audit(tx, { actorType: "user", actorId: userId, action: "org.created", targetType: "org", targetId: orgId, ip: req.ip }));
    return reply.status(201).send({ orgId });
  });
}
