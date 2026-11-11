import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { q, withTenant } from "../db/pool.js";
import { requirePerm } from "../auth/rbac.js";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { accessLevel, effectiveStatus, PLAN_LIMITS, type Plan } from "../billing/entitlements.js";
import { confirmPayment, planPricing } from "../billing/service.js";

export async function billingRoutes(app: FastifyInstance) {
  const { deps } = app;

  app.get("/v1/orgs/:orgId/billing", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "billing.manage");
    return withTenant(ctx.orgId, async (tx) => {
      const sub = (await tx.query("SELECT plan, status, current_period_end, grace_until FROM subscriptions")).rows[0];
      const pricing = planPricing(sub.plan);
      return {
        plan: sub.plan,
        price: { amount: pricing.amount, currency: pricing.currency, interval: "monthly" },
        status: effectiveStatus(sub, deps.now()),
        access: accessLevel(sub, deps.now()),
        currentPeriodEnd: sub.current_period_end,
        graceUntil: sub.grace_until,
        limits: PLAN_LIMITS[sub.plan as Plan],
      };
    });
  });

  /** Server-side Paystack initialization. Amount/plan come from config, never from the client. */
  app.post("/v1/orgs/:orgId/billing/checkout", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "billing.manage");
    const reference = `st_${randomUUID().replaceAll("-", "")}`;
    const user = (await q("SELECT email FROM users WHERE id = $1", [ctx.userId])).rows[0];
    return withTenant(ctx.orgId, async (tx) => {
      const sub = (await tx.query("SELECT plan, status, current_period_end, grace_until FROM subscriptions FOR UPDATE")).rows[0];
      if (accessLevel(sub, deps.now()) === "full" && sub.status === "active") throw new HttpError(409, "already_active");
      const plan = sub.plan as Plan; // family org => individual, school org => organization
      const { amount, currency, planCode } = planPricing(plan);
      await tx.query("INSERT INTO payments (reference, org_id, plan, amount, currency) VALUES ($1, app_current_org(), $2, $3, $4)",
        [reference, plan, amount, currency]);
      const init = await deps.paystack.initialize({
        email: user.email, amount, currency, plan: planCode, reference,
        callback_url: `${config().PUBLIC_BASE_URL}/billing/return?ref=${reference}`,
        metadata: { org_id: ctx.orgId, plan },
      });
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "billing.checkout_started", targetType: "payment", targetId: reference, ip: ctx.ip });
      return { authorizationUrl: init.authorization_url, reference };
    });
  });

  /** Called after the Paystack redirect. Status is decided by GET /transaction/verify, not the redirect. */
  app.post("/v1/orgs/:orgId/billing/verify", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "billing.manage");
    const { reference } = z.object({ reference: z.string().regex(/^st_[0-9a-f]{32}$/) }).parse(req.body);
    return withTenant(ctx.orgId, async (tx) => ({ result: await confirmPayment(tx, deps.paystack, reference, deps.now()) }));
  });

  app.post("/v1/orgs/:orgId/billing/cancel", async (req) => {
    const ctx = await app.userCtx(req);
    requirePerm(ctx, "billing.manage");
    return withTenant(ctx.orgId, async (tx) => {
      const sub = (await tx.query("SELECT paystack_subscription_code, paystack_email_token, current_period_end FROM subscriptions FOR UPDATE")).rows[0];
      if (!sub.paystack_subscription_code || !sub.paystack_email_token) throw new HttpError(409, "no_paystack_subscription");
      await deps.paystack.disableSubscription(sub.paystack_subscription_code, sub.paystack_email_token);
      // Paid-for time is honoured until current_period_end; then the org becomes read-only.
      await tx.query("UPDATE subscriptions SET status = 'cancelled', updated_at = now()");
      await audit(tx, { actorType: "user", actorId: ctx.userId, action: "billing.cancelled", ip: ctx.ip });
      return { status: "cancelled", accessUntil: sub.current_period_end };
    });
  });
}
