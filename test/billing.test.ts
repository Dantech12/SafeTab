import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, makeApp, ownerQuery, paystackSign, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";

let t: TestCtx;
let fam: Awaited<ReturnType<typeof signup>>;
let school: Awaited<ReturnType<typeof signup>>;

beforeAll(async () => {
  await resetDb();
  t = await makeApp();
  fam = await signup(t.app, "parent@family.test", "family");
  school = await signup(t.app, "bursar@school.test", "school");
});

afterAll(async () => {
  await t.app.close();
  await closePool();
});

const hook = (body: unknown, sign = true) => {
  const raw = JSON.stringify(body);
  return t.app.inject({
    method: "POST", url: "/webhooks/paystack",
    headers: { "content-type": "application/json", ...(sign ? { "x-paystack-signature": paystackSign(raw) } : {}) },
    payload: raw,
  });
};

const billing = async (s: typeof fam) => (await t.app.inject({ method: "GET", url: `/v1/orgs/${s.orgId}/billing`, headers: auth(s.token) })).json();

describe("plans", () => {
  it("prices come from server config: $5 individual, $20 organization", async () => {
    const f = await billing(fam);
    const s = await billing(school);
    expect(f.plan).toBe("individual");
    expect(f.price).toEqual({ amount: 500, currency: "USD", interval: "monthly" });
    expect(s.plan).toBe("organization");
    expect(s.price.amount).toBe(2000);
    expect(f.status).toBe("none");
    expect(f.access).toBe("read_only");
  });
});

describe("checkout and verification", () => {
  let reference: string;

  it("initializes server-side with the configured plan code and amount", async () => {
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${fam.orgId}/billing/checkout`, headers: auth(fam.token), payload: { amount: 1 } });
    expect(r.statusCode).toBe(200);
    reference = r.json().reference;
    const sent = t.paystack.initialized.at(-1);
    expect(sent).toMatchObject({ amount: 500, currency: "USD", plan: "PLN_test_individual", reference, metadata: { org_id: fam.orgId } });
    // The pop-up is opened with Paystack's access code; the full-page URL is the fallback.
    expect(r.json()).toMatchObject({ accessCode: "ac_test", plan: "individual", amount: 500, currency: "USD" });
    expect(r.json().authorizationUrl).toMatch(/^https:\/\//);
  });

  it("passes Paystack's refusal reason (e.g. unsupported currency) to the admin", async () => {
    t.paystack.rejectNextInit = "Currency not supported by merchant";
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${school.orgId}/billing/checkout`, headers: auth(school.token) });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: "paystack_rejected", detail: "Currency not supported by merchant" });
    // Nothing is recorded for a checkout Paystack refused.
    const rows = await ownerQuery("SELECT count(*) FROM payments WHERE org_id = $1", [school.orgId]);
    expect(Number(rows.rows[0].count)).toBe(0);
  });

  it("does not activate when Paystack reports a different amount", async () => {
    t.paystack.transactions.set(reference, { status: "success", reference, amount: 100, currency: "USD", metadata: { org_id: fam.orgId } });
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${fam.orgId}/billing/verify`, headers: auth(fam.token), payload: { reference } });
    expect(r.json().result).toBe("mismatch");
    expect((await billing(fam)).access).toBe("read_only");
  });

  it("does not activate on a pending transaction", async () => {
    t.paystack.transactions.set(reference, { status: "ongoing", reference, amount: 500, currency: "USD", metadata: { org_id: fam.orgId } });
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${fam.orgId}/billing/verify`, headers: auth(fam.token), payload: { reference } });
    expect(r.json().result).toBe("pending");
  });

  it("rejects webhooks with a missing or wrong signature", async () => {
    expect((await hook({ event: "charge.success", data: { reference } }, false)).statusCode).toBe(401);
    const raw = JSON.stringify({ event: "charge.success", data: { reference } });
    const forged = await t.app.inject({ method: "POST", url: "/webhooks/paystack", headers: { "content-type": "application/json", "x-paystack-signature": "a".repeat(128) }, payload: raw });
    expect(forged.statusCode).toBe(401);
    expect((await billing(fam)).access).toBe("read_only");
  });

  it("activates via signed webhook only after API verification, idempotently", async () => {
    t.paystack.transactions.set(reference, { status: "success", reference, amount: 500, currency: "USD", metadata: { org_id: fam.orgId }, customer: { customer_code: "CUS_test1" } });
    const evt = { event: "charge.success", data: { reference, customer: { customer_code: "CUS_test1" } } };
    expect((await hook(evt)).statusCode).toBe(200);
    expect((await hook(evt)).statusCode).toBe(200); // duplicate delivery
    const b = await billing(fam);
    expect(b.status).toBe("active");
    expect(b.access).toBe("full");
    const audits = await ownerQuery("SELECT count(*) FROM audit_log WHERE action = 'billing.payment_verified'");
    expect(Number(audits.rows[0].count)).toBe(1);
  });

  it("stores subscription codes from subscription.create", async () => {
    await hook({ event: "subscription.create", data: { subscription_code: "SUB_test1", email_token: "tok_test1", customer: { customer_code: "CUS_test1" }, plan: { plan_code: "PLN_test_individual" }, next_payment_date: new Date(Date.now() + 30 * 86400_000).toISOString() } });
    const s = await ownerQuery("SELECT paystack_subscription_code, paystack_email_token FROM subscriptions WHERE org_id = $1", [fam.orgId]);
    expect(s.rows[0]).toEqual({ paystack_subscription_code: "SUB_test1", paystack_email_token: "tok_test1" });
  });
});

describe("renewal failure, grace and read-only", () => {
  it("past_due keeps full access during grace, then becomes read-only without deleting data", async () => {
    await t.app.inject({ method: "POST", url: `/v1/orgs/${fam.orgId}/students`, headers: auth(fam.token), payload: { displayName: "Nana", ageBand: "under_13" } });
    await hook({ event: "invoice.payment_failed", data: { subscription: { subscription_code: "SUB_test1" }, customer: { customer_code: "CUS_test1" } } });
    let b = await billing(fam);
    expect(b.status).toBe("past_due");
    expect(b.access).toBe("full");

    // Move past both the period end and the grace window.
    await ownerQuery("UPDATE subscriptions SET current_period_end = now() - interval '10 days', grace_until = now() - interval '1 day' WHERE org_id = $1", [fam.orgId]);
    b = await billing(fam);
    expect(b.status).toBe("lapsed");
    expect(b.access).toBe("read_only");

    const students = (await t.app.inject({ method: "GET", url: `/v1/orgs/${fam.orgId}/students`, headers: auth(fam.token) })).json().students;
    expect(students).toHaveLength(1); // data still there and readable
    const put = await t.app.inject({ method: "PUT", url: `/v1/orgs/${fam.orgId}/students/${students[0].id}/policy`, headers: auth(fam.token), payload: { expectedVersion: 0, spec: {} } });
    expect(put.statusCode).toBe(402);
    expect(put.json().error).toBe("subscription_inactive_read_only");
    const exp = await t.app.inject({ method: "GET", url: `/v1/orgs/${fam.orgId}/students/${students[0].id}/export`, headers: auth(fam.token) });
    expect(exp.statusCode).toBe(200);
  });

  it("cancellation disables the Paystack subscription and honours paid time", async () => {
    await ownerQuery("UPDATE subscriptions SET status = 'active', current_period_end = now() + interval '5 days', grace_until = NULL WHERE org_id = $1", [fam.orgId]);
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${fam.orgId}/billing/cancel`, headers: auth(fam.token) });
    expect(r.statusCode).toBe(200);
    expect(t.paystack.disabled).toContain("SUB_test1");
    const b = await billing(fam);
    expect(b.status).toBe("cancelled");
    expect(b.access).toBe("full");
  });

  it("ignores webhooks for unknown references without affecting other tenants", async () => {
    const r = await hook({ event: "charge.success", data: { reference: "st_unknown" } });
    expect(r.statusCode).toBe(200);
    expect((await billing(school)).status).toBe("none");
  });
});

describe("Paystack account shared with another website", () => {
  // The same payer (same Paystack customer) also subscribes on another website that uses
  // this Paystack account. Those events reach this webhook too and must change nothing here.
  const other = { plan: { plan_code: "PLN_other_site" }, customer: { customer_code: "CUS_test1" } };
  const sub = async () => (await ownerQuery(
    "SELECT status, paystack_subscription_code, paystack_email_token, current_period_end FROM subscriptions WHERE org_id = $1", [fam.orgId])).rows[0];
  let before: any;

  beforeAll(async () => {
    await ownerQuery("UPDATE subscriptions SET status = 'active', current_period_end = now() + interval '5 days', grace_until = NULL WHERE org_id = $1", [fam.orgId]);
    before = await sub();
  });

  it("does not take over the other website's subscription or its failures and cancellations", async () => {
    for (const evt of [
      { event: "subscription.create", data: { ...other, subscription_code: "SUB_other", email_token: "tok_other" } },
      { event: "invoice.payment_failed", data: { ...other, subscription: { subscription_code: "SUB_other", plan: other.plan } } },
      { event: "subscription.not_renew", data: { ...other, subscription_code: "SUB_other" } },
      { event: "subscription.disable", data: { ...other, subscription_code: "SUB_other" } },
    ]) {
      expect((await hook(evt)).statusCode).toBe(200);
    }
    expect(await sub()).toEqual(before);
  });

  it("does not count the other website's payments, even when the event names no plan", async () => {
    t.paystack.transactions.set("elib_abc", { status: "success", reference: "elib_abc", amount: 500, currency: "USD", plan: { plan_code: "PLN_other_site" }, customer: { customer_code: "CUS_test1" } });
    t.paystack.transactions.set("other_once", { status: "success", reference: "other_once", amount: 500, currency: "USD", plan: {}, customer: { customer_code: "CUS_test1" } });
    expect((await hook({ event: "charge.success", data: { reference: "elib_abc", customer: { customer_code: "CUS_test1" } } })).statusCode).toBe(200);
    expect((await hook({ event: "charge.success", data: { reference: "other_once", customer: { customer_code: "CUS_test1" }, plan: {} } })).statusCode).toBe(200);
    expect(await sub()).toEqual(before);
  });

  it("still records its own renewals and failures", async () => {
    t.paystack.transactions.set("renew_1", { status: "success", reference: "renew_1", amount: 500, currency: "USD", plan: { plan_code: "PLN_test_individual" }, customer: { customer_code: "CUS_test1" } });
    await hook({ event: "charge.success", data: { reference: "renew_1", customer: { customer_code: "CUS_test1" } } }); // plan looked up via the API
    const renewed = await sub();
    expect(renewed.current_period_end.getTime()).toBeGreaterThan(before.current_period_end.getTime());

    await hook({ event: "invoice.payment_failed", data: { subscription: { subscription_code: "SUB_test1" }, customer: { customer_code: "CUS_test1" } } });
    expect((await sub()).status).toBe("past_due");
  });
});
