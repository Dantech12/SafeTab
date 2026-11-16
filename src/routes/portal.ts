import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../config.js";
import { PLAN_LIMITS } from "../billing/entitlements.js";

/**
 * Serves the public product page (/) and the supervisor portal (/app) from /public.
 * No build step and no third-party scripts: everything is same-origin, so the default
 * helmet CSP (script-src 'self') applies.
 */
const FILES: Record<string, string> = {
  "/": "landing.html",
  "/landing.js": "landing.js",
  "/landing.css": "landing.css",
  "/app": "index.html",
  "/app.js": "app.js",
  "/app.css": "app.css",
};
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export async function portalRoutes(app: FastifyInstance) {
  const dir = path.resolve("public");
  for (const [route, file] of Object.entries(FILES)) {
    app.get(route, async (_req, reply) => {
      const body = await readFile(path.join(dir, file));
      return reply
        .type(TYPES[path.extname(file)] ?? "application/octet-stream")
        .header("cache-control", "no-store")
        .send(body);
    });
  }

  /** Public pricing, read from server configuration so the page never drifts from billing. */
  app.get("/v1/public/plans", async () => {
    const c = config();
    return {
      currency: c.BILLING_CURRENCY,
      interval: "monthly",
      paymentProvider: "Paystack",
      plans: [
        { id: "individual", name: "Individual", amount: c.PLAN_INDIVIDUAL_AMOUNT, limits: PLAN_LIMITS.individual },
        { id: "organization", name: "Organization", amount: c.PLAN_ORGANIZATION_AMOUNT, limits: PLAN_LIMITS.organization },
      ],
    };
  });

  /**
   * Paystack redirects the payer here after checkout. Nothing is trusted from this
   * request: the portal calls POST /billing/verify, which asks Paystack server-side.
   */
  app.get("/billing/return", async (req, reply) => {
    const q = z.object({ ref: z.string().regex(/^st_[0-9a-f]{32}$/) }).safeParse(req.query);
    return reply.redirect(q.success ? `/app#/billing/return/${q.data.ref}` : "/app");
  });
}
