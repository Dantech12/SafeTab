import { createHash } from "node:crypto";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { q, withTenant, type Tx } from "../db/pool.js";
import type { Plan } from "./entitlements.js";
import type { PaystackClient, PaystackTransaction } from "./paystack.js";

export function planPricing(plan: Plan) {
  const c = config();
  return plan === "individual"
    ? { amount: c.PLAN_INDIVIDUAL_AMOUNT, planCode: c.PAYSTACK_PLAN_INDIVIDUAL, currency: c.BILLING_CURRENCY }
    : { amount: c.PLAN_ORGANIZATION_AMOUNT, planCode: c.PAYSTACK_PLAN_ORGANIZATION, currency: c.BILLING_CURRENCY };
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
  await tx.query(
    `UPDATE subscriptions SET plan = $1, status = 'active', grace_until = NULL,
       paystack_customer_code = COALESCE($2, paystack_customer_code),
       current_period_end = GREATEST(COALESCE(current_period_end, $3), $3), updated_at = now()`,
    [payment.plan, t.customer?.customer_code ?? null, addMonth(now)],
  );
  await audit(tx, { actorType: "system", action: "billing.payment_verified", targetType: "payment", targetId: reference });
  return "success";
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

  let orgId: string | null = null;
  if (data.reference) orgId = (await q("SELECT lookup_payment_org($1) AS id", [data.reference])).rows[0]?.id ?? null;
  if (!orgId && (subCode || customerCode)) {
    orgId = (await q("SELECT lookup_subscription_org($1, $2) AS id", [subCode, customerCode])).rows[0]?.id ?? null;
  }
  if (!orgId) return; // unknown to us; acknowledged so Paystack stops retrying

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
