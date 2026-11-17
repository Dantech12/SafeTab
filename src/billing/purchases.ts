import { randomUUID } from "node:crypto";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { q, type Tx } from "../db/pool.js";
import { HttpError } from "../lib/errors.js";
import { hashToken, newToken } from "../lib/tokens.js";
import type { Plan } from "./entitlements.js";
import { PaystackRejectedError, type PaystackClient } from "./paystack.js";
import { resolvePlanCode } from "./plans.js";
import { planPricing } from "./service.js";

/**
 * Pay first, create the account afterwards.
 *  1. createPurchase: server-side Paystack transaction for a plan + email. The payer's
 *     browser receives a secret claim token (only its hash is stored).
 *  2. confirmPurchase: payment confirmed with Paystack (GET /transaction/verify), from
 *     the browser after the pop-up and/or from the signed webhook.
 *  3. claimPurchase: once signed in, the payer attaches the paid plan to their
 *     workspace using the claim token. Single use.
 */
const addMonth = (d: Date) => { const n = new Date(d); n.setUTCMonth(n.getUTCMonth() + 1); return n; };

function paystackError(e: unknown): never {
  if (e instanceof PaystackRejectedError) throw new HttpError(502, "paystack_rejected", undefined, e.paystackMessage || `HTTP ${e.status}`);
  throw new HttpError(502, "paystack_unavailable");
}

export async function createPurchase(paystack: PaystackClient, plan: Plan, email: string, log: (m: string) => void) {
  const key = config().PAYSTACK_SECRET_KEY;
  if (!key || /REPLACE_ME/.test(key)) throw new HttpError(503, "payments_not_configured");
  const { amount, currency, planCode: configuredCode } = planPricing(plan);
  const reference = `st_${randomUUID().replaceAll("-", "")}`;
  const claimToken = newToken();
  let planCode: string;
  try {
    planCode = await resolvePlanCode(paystack, { plan, amount, currency, configuredCode }, log);
  } catch (e) { paystackError(e); }
  const r = await q(
    "INSERT INTO purchases (plan, email, amount, currency, reference, claim_token_hash) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [plan, email, amount, currency, reference, hashToken(claimToken)]);
  let init;
  try {
    init = await paystack.initialize({
      email, amount, currency, plan: planCode, reference,
      callback_url: `${config().PUBLIC_BASE_URL}/checkout/return?ref=${reference}`,
      metadata: { purchase_id: r.rows[0].id, plan },
    });
  } catch (e) {
    await q("UPDATE purchases SET status = 'failed' WHERE reference = $1", [reference]);
    paystackError(e);
  }
  return { reference, claimToken, accessCode: init.access_code, authorizationUrl: init.authorization_url, amount, currency, plan };
}

/** Confirms a purchase with Paystack. Safe to call repeatedly. */
export async function confirmPurchase(paystack: PaystackClient, reference: string): Promise<"paid" | "claimed" | "pending" | "failed" | "mismatch" | "unknown"> {
  const p = (await q("SELECT id, status, amount, currency FROM purchases WHERE reference = $1", [reference])).rows[0];
  if (!p) return "unknown";
  if (p.status === "paid" || p.status === "claimed") return p.status;
  const t = await paystack.verify(reference);
  if (t.reference !== reference || t.amount !== p.amount || t.currency !== p.currency || t.metadata?.purchase_id !== p.id) return "mismatch";
  if (t.status === "failed" || t.status === "abandoned") {
    await q("UPDATE purchases SET status = 'failed' WHERE id = $1 AND status = 'initialized'", [p.id]);
    return "failed";
  }
  if (t.status !== "success") return "pending";
  await q(
    `UPDATE purchases SET status = 'paid', paid_at = now(), paystack_customer_code = COALESCE($2, paystack_customer_code)
     WHERE id = $1 AND status IN ('initialized', 'failed')`, [p.id, t.customer?.customer_code ?? null]);
  return "paid";
}

/** Webhook events for purchases that don't belong to a workspace yet. */
export async function handlePurchaseEvent(event: string, data: any, paystack: PaystackClient): Promise<boolean> {
  if (event === "charge.success" && data.reference) {
    const known = (await q("SELECT 1 FROM purchases WHERE reference = $1", [data.reference])).rowCount;
    if (known) { await confirmPurchase(paystack, data.reference); return true; }
  }
  if (event === "subscription.create" && data.customer?.customer_code) {
    // Keep the subscription details so cancel / card updates work once claimed.
    const r = await q(
      `UPDATE purchases SET paystack_subscription_code = $2, paystack_email_token = $3, next_payment_date = $4::timestamptz
       WHERE paystack_customer_code = $1 AND status = 'paid' RETURNING id`,
      [data.customer.customer_code, data.subscription_code ?? null, data.email_token ?? null, data.next_payment_date ?? null]);
    return !!r.rowCount;
  }
  return false;
}

export async function purchaseByToken(claimToken: string) {
  return (await q("SELECT id, plan, email, amount, currency, status, reference FROM purchases WHERE claim_token_hash = $1",
    [hashToken(claimToken)])).rows[0] as { id: string; plan: Plan; email: string; amount: number; currency: string; status: string; reference: string } | undefined;
}

/** Attaches a paid purchase to the caller's workspace (inside its tenant transaction). */
export async function claimPurchase(tx: Tx, paystack: PaystackClient, claimToken: string, userId: string, now: Date) {
  const p = await purchaseByToken(claimToken);
  if (!p) throw new HttpError(404, "purchase_not_found");
  if (p.status === "claimed") throw new HttpError(409, "purchase_already_claimed");
  const sub = (await tx.query("SELECT plan, status, current_period_end FROM subscriptions FOR UPDATE")).rows[0];
  if (sub.plan !== p.plan) throw new HttpError(409, "purchase_plan_mismatch");
  if (p.status === "initialized") {
    try { if ((await confirmPurchase(paystack, p.reference)) === "paid") p.status = "paid"; } catch { /* not confirmed yet */ }
  }
  if (p.status !== "paid") throw new HttpError(409, "purchase_not_paid");

  if (sub.status === "active" && sub.current_period_end && new Date(sub.current_period_end) > now) throw new HttpError(409, "already_active");

  // Single use: only one claim can move the purchase from paid to claimed.
  // Same transaction as the subscription update: both happen, or neither.
  const won = await tx.query(
    `UPDATE purchases SET status = 'claimed', claimed_at = now(), claimed_org_id = app_current_org()
     WHERE id = $1 AND status = 'paid'
     RETURNING paystack_customer_code, paystack_subscription_code, paystack_email_token, next_payment_date`, [p.id]);
  if (!won.rowCount) throw new HttpError(409, "purchase_already_claimed");
  const w = won.rows[0];
  await tx.query(
    `UPDATE subscriptions SET status = 'active', grace_until = NULL,
       paystack_customer_code = COALESCE($1, paystack_customer_code),
       paystack_subscription_code = COALESCE($2, paystack_subscription_code),
       paystack_email_token = COALESCE($3, paystack_email_token),
       current_period_end = $4, updated_at = now()`,
    [w.paystack_customer_code, w.paystack_subscription_code, w.paystack_email_token, w.next_payment_date ?? addMonth(now)]);
  await tx.query(
    `INSERT INTO payments (reference, org_id, plan, amount, currency, status, verified_at)
     VALUES ($1, app_current_org(), $2, $3, $4, 'success', now()) ON CONFLICT (reference) DO NOTHING`,
    [p.reference, p.plan, p.amount, p.currency]);
  await audit(tx, { actorType: "user", actorId: userId, action: "billing.purchase_claimed", targetType: "payment", targetId: p.reference });
  return { plan: p.plan };
}
