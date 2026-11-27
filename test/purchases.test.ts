import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, makeApp, ownerQuery, paystackSign, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";
import { clearPlanCache } from "../src/billing/plans.js";

let t: TestCtx;
beforeAll(async () => {
  await resetDb();
  clearPlanCache();
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
  await closePool();
});

const checkout = (plan: string, email: string) => t.app.inject({ method: "POST", url: "/v1/public/checkout", payload: { plan, email } });
const status = (claimToken: string) => t.app.inject({ method: "POST", url: "/v1/public/checkout/status", payload: { claimToken } });
const paid = (reference: string, over: Record<string, unknown> = {}) => {
  const init = t.paystack.initialized.find((b) => b.reference === reference);
  t.paystack.transactions.set(reference, { status: "success", reference, amount: init.amount, currency: init.currency, metadata: init.metadata, customer: { customer_code: "CUS_pay1" }, ...over });
};
const hook = (body: unknown) => {
  const raw = JSON.stringify(body);
  return t.app.inject({ method: "POST", url: "/webhooks/paystack", headers: { "content-type": "application/json", "x-paystack-signature": paystackSign(raw) }, payload: raw });
};

describe("pay first, create the account afterwards", () => {
  let claimToken: string;
  let reference: string;

  it("starts a Paystack payment from just a plan and an email (amount from server config)", async () => {
    const r = await checkout("organization", "Head@School.test");
    expect(r.statusCode).toBe(200);
    ({ claimToken, reference } = r.json());
    expect(r.json()).toMatchObject({ plan: "organization", amount: 2000, currency: "USD", accessCode: "ac_test" });
    const sent = t.paystack.initialized.at(-1);
    expect(sent).toMatchObject({ email: "head@school.test", amount: 2000, reference, plan: "PLN_test_organization" });
    expect(sent.metadata.purchase_id).toBeTruthy();
    expect(sent.callback_url).toContain("/checkout/return?ref=");
    // Only a hash of the claim token is stored.
    const row = await ownerQuery("SELECT claim_token_hash FROM purchases WHERE reference = $1", [reference]);
    expect(row.rows[0].claim_token_hash).not.toBe(claimToken);
  });

  it("rejects bad input", async () => {
    expect((await checkout("gold", "a@b.test")).statusCode).toBe(400);
    expect((await checkout("individual", "not-an-email")).statusCode).toBe(400);
  });

  it("is not paid until Paystack confirms it, and a wrong amount never counts", async () => {
    expect((await status(claimToken)).json().status).toBe("initialized");
    paid(reference, { amount: 1 });
    expect((await status(claimToken)).json().status).toBe("initialized");
    paid(reference);
    expect((await status(claimToken)).json()).toMatchObject({ status: "paid", plan: "organization", email: "head@school.test" });
  });

  it("ignores another website's subscription for the same payer", async () => {
    // Same Paystack customer subscribing on another website that shares this Paystack account.
    await hook({ event: "subscription.create", data: { subscription_code: "SUB_elsewhere", email_token: "tok_elsewhere", customer: { customer_code: "CUS_pay1" }, plan: { plan_code: "PLN_other_site", name: "BookBridge — School (monthly)" } } });
    const row = await ownerQuery("SELECT paystack_subscription_code FROM purchases WHERE reference = $1", [reference]);
    expect(row.rows[0].paystack_subscription_code).toBeNull();
  });

  it("keeps Paystack's subscription details from the webhook until the plan is claimed", async () => {
    await hook({ event: "subscription.create", data: { subscription_code: "SUB_pay1", email_token: "tok_pay1", customer: { customer_code: "CUS_pay1" }, plan: { plan_code: "PLN_test_organization" }, next_payment_date: "2026-12-17T10:00:00.000Z" } });
    const row = await ownerQuery("SELECT paystack_subscription_code FROM purchases WHERE reference = $1", [reference]);
    expect(row.rows[0].paystack_subscription_code).toBe("SUB_pay1");
  });

  it("refuses to attach to a workspace of the wrong kind", async () => {
    const family = await signup(t.app, "family@home.test", "family");
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${family.orgId}/billing/claim`, headers: auth(family.token), payload: { claimToken } });
    expect(r.json().error).toBe("purchase_plan_mismatch");
  });

  it("the payer creates their account, then the paid plan activates their workspace — once", async () => {
    const school = await signup(t.app, "head@school.test", "school");
    const before = (await t.app.inject({ method: "GET", url: `/v1/orgs/${school.orgId}/billing`, headers: auth(school.token) })).json();
    expect(before.access).toBe("read_only");
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${school.orgId}/billing/claim`, headers: auth(school.token), payload: { claimToken } });
    expect(r.statusCode).toBe(200);
    const b = (await t.app.inject({ method: "GET", url: `/v1/orgs/${school.orgId}/billing`, headers: auth(school.token) })).json();
    expect(b).toMatchObject({ status: "active", access: "full", hasPaystackSubscription: true });
    expect(new Date(b.currentPeriodEnd).toISOString()).toBe("2026-12-17T10:00:00.000Z");
    const hist = (await t.app.inject({ method: "GET", url: `/v1/orgs/${school.orgId}/billing/history`, headers: auth(school.token) })).json();
    expect(hist.payments[0]).toMatchObject({ reference, status: "success", amount: 2000 });
    // Can't be claimed again (by anyone).
    const other = await signup(t.app, "other@school.test", "school");
    const again = await t.app.inject({ method: "POST", url: `/v1/orgs/${other.orgId}/billing/claim`, headers: auth(other.token), payload: { claimToken } });
    expect(again.json().error).toBe("purchase_already_claimed");
  });

  it("confirms a pay-first payment from Paystack's webhook too, and refuses unpaid claims", async () => {
    const r = (await checkout("individual", "mum@home.test")).json();
    const fam = await signup(t.app, "mum@home.test", "family");
    const early = await t.app.inject({ method: "POST", url: `/v1/orgs/${fam.orgId}/billing/claim`, headers: auth(fam.token), payload: { claimToken: r.claimToken } });
    expect(early.json().error).toBe("purchase_not_paid");
    paid(r.reference, { customer: { customer_code: "CUS_mum" } });
    await hook({ event: "charge.success", data: { reference: r.reference, customer: { customer_code: "CUS_mum" } } });
    expect((await status(r.claimToken)).json().status).toBe("paid");
    const ok = await t.app.inject({ method: "POST", url: `/v1/orgs/${fam.orgId}/billing/claim`, headers: auth(fam.token), payload: { claimToken: r.claimToken } });
    expect(ok.statusCode).toBe(200);
  });

  it("unknown claim tokens are rejected", async () => {
    expect((await status("x".repeat(43))).json().error).toBe("purchase_not_found");
  });
});
