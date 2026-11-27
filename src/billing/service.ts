import { createHash } from "node:crypto";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { q, withTenant, type Tx } from "../db/pool.js";
import type { Plan } from "./entitlements.js";
import type { PaystackClient, PaystackTransaction } from "./paystack.js";
import { handlePurchaseEvent } from "./purchases.js";

export function planPricing(plan: Plan) {
  const c = config();
  return plan === "individual"
    ? { amount: c.PLAN_INDIVIDUAL_AMOUNT, planCode: c.PAYSTACK_PLAN_INDIVIDUAL, currency: c.BILLING_CURRENCY }
    : { amount: c.PLAN_ORGANIZATION_AMOUNT, planCode: c.PAYSTACK_PLAN_ORGANIZATION, currency: c.BILLING_CURRENCY };
}

export type PayMethod = "card" | "momo";

/**
 * Card: a Paystack subscription that renews itself monthly (Paystack offers only cards
 * for subscriptions). Mobile Money: a one-off payment for one month, paid again by hand.
 */
export function checkoutOptions(method: PayMethod, planCode: string | null): { plan?: string; channels?: string[] } {
  return method === "momo" ? { channels: ["mobile_money"] } : { plan: planCode! };
}

const addMonth = (d: Date) => {
  const n = new Date(d);
  n.setUTCMonth(n.getUTCMonth() + 1);
  return n;
};

/**
 * Marks a payment successful ONLY after an authoritative server-side verification
 * (GET /transaction/verify) that matches our stored reference, amount, currency and org.
 * Safe to call repeatedly (from the redirect handler and from the webhook).
 */
export async function confirmPayment(
  tx: Tx,
  paystack: PaystackClient,
  reference: string,
  now: Date,
): Promise<"success" | "pending" | "failed" | "mismatch"> {
  const p = await tx.query("SELECT * FROM payments WHERE reference = $1 FOR UPDATE", [reference]);
  const payment = p.rows[0];
  if (!payment) return "mismatch";
  if (payment.status === "success") return "success";

  const t: PaystackTransaction = await paystack.verify(reference);
  const orgMatches = t.metadata?.org_id === payment.org_id;
  if (t.reference !== reference || t.amount !== payment.amount || t.currency !== payment.currency || !orgMatches) {
    await audit(tx, { actorType: "system", action: "billing.payment_mismatch", targetType: "payment", targetId: reference,
      metadata: { amount: t.amount, currency: t.currency } });
    return "mismatch";
  }
  if (t.status === "failed" || t.status === "abandoned") {
    await tx.query("UPDATE payments SET status = $2 WHERE reference = $1", [reference, t.status]);
    return "failed";
  }
  if (t.status !== "success") return "pending";

  await tx.query("UPDATE payments SET status = 'success', verified_at = $2 WHERE reference = $1", [reference, now]);
  if (payment.method === "momo") {
    // One month, added to any time already paid for. Doesn't renew by itself.
    await tx.query(
      `UPDATE subscriptions SET plan = $1, status = 'non_renewing', grace_until = NULL,
         paystack_customer_code = COALESCE($2, paystack_customer_code),
         current_period_end = GREATEST(COALESCE(current_period_end, $3), $3) + interval '1 month', updated_at = now()`,
      [payment.plan, t.customer?.customer_code ?? null, now],
    );
  } else {
    await tx.query(
      `UPDATE subscriptions SET plan = $1, status = 'active', grace_until = NULL,
         paystack_customer_code = COALESCE($2, paystack_customer_code),
         current_period_end = GREATEST(COALESCE(current_period_end, $3), $3), updated_at = now()`,
      [payment.plan, t.customer?.customer_code ?? null, addMonth(now)],
    );
  }
  await audit(tx, { actorType: "system", action: "billing.payment_verified", targetType: "payment", targetId: reference });
  return "success";
}

/**
 * The plan a webhook event is about: from the event itself, or (for a charge that names no
 * plan) from Paystack's verify API. null when there is none, e.g. a one-off payment.
 */
async function eventPlan(data: any, paystack: PaystackClient): Promise<unknown> {
  const fromEvent = [data.plan, data.subscription?.plan].find((p) => planCodeOf(p));
  if (fromEvent) return fromEvent;
  if (!data.reference || !data.customer?.customer_code) return null;
  const t = await paystack.verify(data.reference).catch(() => null);
  return planCodeOf(t?.plan) ? t!.plan : null;
}

/** Paystack sends a plan as an object with plan_code, or sometimes as the code itself. */
function planCodeOf(plan: unknown): string | null {
  if (typeof plan === "string") return plan || null;
  const code = (plan as { plan_code?: unknown } | null | undefined)?.plan_code;
  return typeof code === "string" && code ? code : null;
}

/**
 * True for SafeTab's own plans: the codes in .env, or the plans SafeTab finds or creates by
 * name (see plans.ts planName: "SafeTab Individual (GHS 60)", "SafeTab Organization (...)").
 */
export async function isSafeTabPlan(plan: unknown, paystack: PaystackClient): Promise<boolean> {
  const code = planCodeOf(plan);
  if (!code) return false;
  if (code === config().PAYSTACK_PLAN_INDIVIDUAL || code === config().PAYSTACK_PLAN_ORGANIZATION) return true;
  let name = typeof plan === "object" ? (plan as { name?: unknown }).name : undefined;
  if (typeof name !== "string") name = (await paystack.fetchPlan(code).catch(() => null))?.name;
  return typeof name === "string" && /^SafeTab (Individual|Organization) \(/.test(name);
}

/** Returns false if the event was already processed (idempotency on the raw body hash). */
async function firstDelivery(raw: Buffer, eventType: string): Promise<boolean> {
  const id = `paystack:${createHash("sha256").update(raw).digest("hex")}`;
  const r = await q("INSERT INTO webhook_events (id, provider, event_type) VALUES ($1, 'paystack', $2) ON CONFLICT DO NOTHING", [id, eventType]);
  return r.rowCount === 1;
}

/**
 * Handles a signature-verified Paystack webhook. The payload is used only to decide what
 * to look up; payment success is always re-verified with the API.
 */
export async function handlePaystackEvent(raw: Buffer, paystack: PaystackClient, now: Date): Promise<void> {
  const evt = JSON.parse(raw.toString("utf8")) as { event: string; data: any };
  if (!(await firstDelivery(raw, evt.event))) return;
  const data = evt.data ?? {};
  const subCode: string | null = data.subscription_code ?? data.subscription?.subscription_code ?? null;
  const customerCode: string | null = data.customer?.customer_code ?? null;

  // The Paystack account (and its single webhook) may be shared with other websites, and Paystack
  // keeps one customer per email across all of them. So an event is ours only if it carries one of
  // our payment references or subscription codes, or is for one of our plans. Matching on the
  // customer alone would let another site's subscription overwrite or cancel ours.
  let orgId: string | null = null;
  if (data.reference) orgId = (await q("SELECT lookup_payment_org($1) AS id", [data.reference])).rows[0]?.id ?? null;
  if (!orgId) {
    const plan = await eventPlan(data, paystack);
    if (plan && !(await isSafeTabPlan(plan, paystack))) return; // another website's plan
    if (subCode) orgId = (await q("SELECT lookup_subscription_org($1, NULL) AS id", [subCode])).rows[0]?.id ?? null;
    if (!orgId && customerCode && plan) {
      orgId = (await q("SELECT lookup_subscription_org(NULL, $1) AS id", [customerCode])).rows[0]?.id ?? null;
    }
  }
  if (!orgId) {
    // Paid before creating an account? (pay-first checkout from the product page)
    await handlePurchaseEvent(evt.event, data, paystack);
    return; // otherwise unknown to us; acknowledged so Paystack stops retrying
  }

  await withTenant(orgId, async (tx) => {
    const graceUntil = new Date(now.getTime() + config().BILLING_GRACE_DAYS * 86400_000);
    switch (evt.event) {
      case "charge.success": {
        if (data.reference && (await tx.query("SELECT 1 FROM payments WHERE reference = $1", [data.reference])).rowCount) {
          await confirmPayment(tx, paystack, data.reference, now);
        } else if (subCode || customerCode) {
          // Renewal charge created by Paystack for an existing subscription: verify it too.
          const t = await paystack.verify(data.reference);
          const sub = (await tx.query("SELECT plan FROM subscriptions")).rows[0];
          const expected = planPricing(sub.plan);
          if (t.status === "success" && t.amount === expected.amount && t.currency === expected.currency) {
            await tx.query(
              `UPDATE subscriptions SET status = CASE WHEN status = 'non_renewing' THEN status ELSE 'active' END,
                 grace_until = NULL, current_period_end = $1, updated_at = now()`,
              [addMonth(now)],
            );
          }
        }
        break;
      }
      case "subscription.create":
        await tx.query(
          `UPDATE subscriptions SET paystack_subscription_code = $1, paystack_email_token = $2,
             paystack_customer_code = COALESCE($3, paystack_customer_code),
             current_period_end = COALESCE($4::timestamptz, current_period_end), updated_at = now()`,
          [subCode, data.email_token ?? null, customerCode, data.next_payment_date ?? null],
        );
        break;
      case "invoice.payment_failed":
        await tx.query("UPDATE subscriptions SET status = 'past_due', grace_until = $1, updated_at = now()", [graceUntil]);
        break;
      case "subscription.not_renew":
        await tx.query("UPDATE subscriptions SET status = 'non_renewing', updated_at = now()");
        break;
      case "subscription.disable":
        await tx.query("UPDATE subscriptions SET status = 'cancelled', updated_at = now()");
        break;
      default:
        break; // e.g. subscription.expiring_cards: surface in the portal in a later milestone
    }
    await audit(tx, { actorType: "system", action: `billing.webhook.${evt.event}` });
  });
}
