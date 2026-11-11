import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q, withTenant } from "../db/pool.js";
import { requirePerm } from "../auth/rbac.js";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { hashToken, newToken } from "../lib/tokens.js";

// Applies to the unauthenticated browser-redirect callback (state value).
const SIGNUP_TTL_MS = 24 * 60 * 60_000;

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5}</style></head>` +
  `<body><h1>${title}</h1><p>${body}</p></body></html>`;

/**
 * Android Enterprise signup (AMAPI):
 *  1. Org admin calls POST /android/signup -> receives a Google-hosted signup URL.
 *  2. Admin completes Google's flow; Google redirects the browser to our callback with
 *     `enterpriseToken` appended.
 *  3. Callback matches the random `state` (stored hashed, single use, 1 h) and calls
 *     enterprises.create, saving the enterprise on that org.
 */
export async function androidRoutes(app: FastifyInstance) {
  const { deps } = app;

  app.post("/v1/orgs/:orgId/android/signup", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "org.manage");
    return withTenant(ctx.orgId, async (tx) => {
      const org = (await tx.query("SELECT amapi_enterprise FROM organizations")).rows[0];
      if (org.amapi_enterprise) throw new HttpError(409, "android_already_connected");
      const state = newToken(24);
      // Google only accepts https callback URLs. Without a public https address (e.g. a
      // laptop on http://localhost) use "manual" mode: Google redirects to a static https
      // page and the admin pastes the resulting address back via /android/complete.
      const mode = config().PUBLIC_BASE_URL.startsWith("https://") ? "redirect" : "manual";
      const callbackUrl = mode === "redirect"
        ? `${config().PUBLIC_BASE_URL}/android/callback?state=${state}`
        : config().ANDROID_MANUAL_CALLBACK_URL;
      const signup = await deps.mdm.createSignupUrl(callbackUrl);
      await tx.query(
        `UPDATE organizations SET amapi_signup_url_name = $1, amapi_signup_state_hash = $2,
           amapi_signup_expires_at = $3, amapi_signup_by = $4`,
        [signup.name, hashToken(state), new Date(Date.now() + SIGNUP_TTL_MS), ctx.userId]);
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "android.signup_started", ip: ctx.ip });
      return { signupUrl: signup.url, mode, expiresInMinutes: SIGNUP_TTL_MS / 60_000 };
    });
  });

  /**
   * Manual completion: the signed-in org admin submits the enterpriseToken that Google
   * appended to the callback address. Bound to this org's own pending signup.
   */
  app.post("/v1/orgs/:orgId/android/complete", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "org.manage");
    const body = z.object({ enterpriseToken: z.string().trim().min(1).max(500) }).parse(req.body);
    return withTenant(ctx.orgId, async (tx) => {
      const org = (await tx.query(
        "SELECT name, amapi_enterprise, amapi_signup_url_name FROM organizations FOR UPDATE")).rows[0];
      if (org.amapi_enterprise) throw new HttpError(409, "android_already_connected");
      // No local expiry here: Google's pages can take a while, the caller is an authenticated
      // org admin, and Google itself rejects stale or invalid tokens.
      if (!org.amapi_signup_url_name) {
        throw new HttpError(400, "no_pending_signup_start_again");
      }
      let ent: { name: string };
      try {
        ent = await deps.mdm.createEnterprise(org.amapi_signup_url_name, body.enterpriseToken, org.name);
      } catch {
        throw new HttpError(400, "google_rejected_token_start_again");
      }
      await tx.query(
        `UPDATE organizations SET amapi_enterprise = $1, amapi_signup_url_name = NULL,
           amapi_signup_state_hash = NULL, amapi_signup_expires_at = NULL`, [ent.name]);
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "android.connected", metadata: { enterprise: ent.name, mode: "manual" }, ip: ctx.ip });
      return { connected: true, enterpriseName: ent.name };
    });
  });

  app.get("/v1/orgs/:orgId/android", async (req) => {
    const ctx = await app.userCtx(req);
    return withTenant(ctx.orgId, async (tx) => {
      const o = (await tx.query("SELECT amapi_enterprise FROM organizations")).rows[0];
      return { connected: !!o.amapi_enterprise, enterpriseName: o.amapi_enterprise };
    });
  });

  // Browser redirect from Google. Unauthenticated by nature; protected by the single-use state.
  app.get("/android/callback", async (req, reply) => {
    const query = z.object({ state: z.string().min(20).max(100), enterpriseToken: z.string().min(1).max(500) }).safeParse(req.query);
    reply.type("text/html; charset=utf-8");
    if (!query.success) return reply.status(400).send(page("Android setup failed", "The link is incomplete. Start again from SafeTab."));
    const found = (await q("SELECT org_id, signup_url_name, started_by FROM lookup_android_signup($1)", [hashToken(query.data.state)])).rows[0];
    if (!found) return reply.status(400).send(page("Android setup link expired", "This link was already used or has expired. Start again from SafeTab."));

    await withTenant(found.org_id, async (tx) => {
      const org = (await tx.query("SELECT name FROM organizations FOR UPDATE")).rows[0];
      const ent = await deps.mdm.createEnterprise(found.signup_url_name, query.data.enterpriseToken, org.name);
      await tx.query(
        `UPDATE organizations SET amapi_enterprise = $1, amapi_signup_url_name = NULL,
           amapi_signup_state_hash = NULL, amapi_signup_expires_at = NULL`, [ent.name]);
      await audit(tx, { actorType: "user", actorId: found.started_by, action: "android.connected", metadata: { enterprise: ent.name } });
    });
    return reply.send(page("Android connected", "Your organization is now connected to Android Enterprise. You can close this tab and return to SafeTab."));
  });
}
