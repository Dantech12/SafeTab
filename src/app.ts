import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { config } from "./config.js";
import { q } from "./db/pool.js";
import { HttpError, unauthorized, notFound } from "./lib/errors.js";
import { hashToken } from "./lib/tokens.js";
import type { Role, UserCtx } from "./auth/rbac.js";
import type { MdmProvider } from "./mdm/provider.js";
import type { PaystackClient } from "./billing/paystack.js";
import { authRoutes } from "./routes/auth.js";
import { orgRoutes } from "./routes/org.js";
import { studentRoutes } from "./routes/students.js";
import { deviceRoutes } from "./routes/devices.js";
import { deviceApiRoutes } from "./routes/device-api.js";
import { billingRoutes } from "./routes/billing.js";
import { webhookRoutes } from "./routes/webhooks.js";

export interface Deps {
  mdm: MdmProvider;
  paystack: PaystackClient;
  /** Verifies the OIDC bearer token on Google Pub/Sub push requests. */
  verifyPubSubPush: (authorizationHeader: string | undefined) => Promise<boolean>;
  now: () => Date;
}

declare module "fastify" {
  interface FastifyInstance {
    deps: Deps;
    /** Authenticated portal user, scoped to the :orgId in the URL. */
    userCtx(req: FastifyRequest): Promise<UserCtx>;
    /** Authenticated user without org scope. */
    sessionUser(req: FastifyRequest): Promise<{ userId: string; sessionId: string }>;
  }
}

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config().NODE_ENV === "test" ? false : {
      // Never log credentials or bodies.
      redact: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-paystack-signature\"]"],
    },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  app.decorate("deps", deps);
  await app.register(helmet);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.decorate("sessionUser", async (req: FastifyRequest) => {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const r = await q(
      "SELECT id, user_id FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()",
      [hashToken(token)],
    );
    const s = r.rows[0];
    if (!s) throw unauthorized();
    return { userId: s.user_id as string, sessionId: s.id as string };
  });

  app.decorate("userCtx", async (req: FastifyRequest) => {
    const { userId } = await app.sessionUser(req);
    const orgId = (req.params as { orgId?: string }).orgId;
    if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) throw notFound();
    const m = await q("SELECT role FROM lookup_user_memberships($1) WHERE org_id = $2", [userId, orgId]);
    // 404 rather than 403: do not reveal whether another tenant's org exists.
    if (!m.rows[0]) throw notFound("org_not_found");
    return { userId, orgId, role: m.rows[0].role as Role, ip: req.ip };
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code });
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "validation_failed",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: "internal_error" });
  });

  app.get("/healthz", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(orgRoutes);
  await app.register(studentRoutes);
  await app.register(deviceRoutes);
  await app.register(deviceApiRoutes);
  await app.register(billingRoutes);
  await app.register(webhookRoutes);
  return app;
}
