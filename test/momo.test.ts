import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, makeApp, paystackSign, resetDb, signup, type TestCtx } from "./helpers.js";
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

const DAY = 86400_000;
const paid = (reference: string) => {
  const init = t.paystack.initialized.find((b) => b.reference === reference);
  t.paystack.transactions.set(reference, { status: "success", reference, amount: init.amount, currency: init.currency, metadata: init.metadata, customer: { customer_code: "CUS_momo" } });
};
const billing = async (s: { orgId: string; token: string }) =>
  (await t.app.inject({ method: "GET", url: `/v1/orgs/${s.orgId}/billing`, headers: auth(s.token) })).json();

describe("Mobile Money: one month at a time", () => {
  let fam: Awaited<ReturnType<typeof signup>>;

  it("pay-first checkout offers only Mobile Money and creates no subscription plan", async () => {
    const r = await t.app.inject({ method: "POST", url: "/v1/public/checkout", payload: { plan: "individual", email: "dad@home.test", method: "momo" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ method: "momo", amount: 500 });
    const sent = t.paystack.initialized.at(-1);
    expect(sent.channels).toEqual(["mobile_money"]);
    expect(sent.plan).toBeUndefined();

    paid(r.json().reference);
    fam = await signup(t.app, "dad@home.test", "family");
    const claim = await t.app.inject({ method: "POST", url: `/v1/orgs/${fam.orgId}/billing/claim`, headers: auth(fam.token), payload: { claimToken: r.json().claimToken } });
    expect(claim.statusCode).toBe(200);

    const b = await billing(fam);
    expect(b).toMatchObject({ status: "non_renewing", access: "full", hasPaystackSubscription: false });
    const days = (new Date(b.currentPeriodEnd).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    const hist = (await t.app.inject({ method: "GET", url: `/v1/orgs/${fam.orgId}/billing/history`, headers: auth(fam.token) })).json();
    expect(hist.payments[0]).toMatchObject({ method: "momo", status: "success" });
  });

  it("paying again early adds a month on top of the time already paid for", async () => {
    const before = new Date((await billing(fam)).currentPeriodEnd).getTime();
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${fam.orgId}/billing/checkout`, headers: auth(fam.token), payload: { method: "momo" } });
    expect(r.statusCode).toBe(200);
    expect(t.paystack.initialized.at(-1)).toMatchObject({ channels: ["mobile_money"] });
    paid(r.json().reference);
    const v = await t.app.inject({ method: "POST", url: `/v1/orgs/${fam.orgId}/billing/verify`, headers: auth(fam.token), payload: { reference: r.json().reference } });
    expect(v.json().result).toBe("success");
    const after = await billing(fam);
    expect(after.status).toBe("non_renewing");
    const added = (new Date(after.currentPeriodEnd).getTime() - before) / DAY;
    expect(added).toBeGreaterThan(27);
    expect(added).toBeLessThan(32);
  });

  it("is confirmed by Paystack's webhook too", async () => {
    const school = await signup(t.app, "bursar@momo.test", "school");
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${school.orgId}/billing/checkout`, headers: auth(school.token), payload: { method: "momo" } });
    paid(r.json().reference);
    const raw = JSON.stringify({ event: "charge.success", data: { reference: r.json().reference, customer: { customer_code: "CUS_momo" } } });
    await t.app.inject({ method: "POST", url: "/webhooks/paystack", headers: { "content-type": "application/json", "x-paystack-signature": paystackSign(raw) }, payload: raw });
    expect(await billing(school)).toMatchObject({ status: "non_renewing", access: "full" });
  });

  it("card checkout still starts a subscription, and unknown methods are refused", async () => {
    const other = await signup(t.app, "card@home.test", "family");
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${other.orgId}/billing/checkout`, headers: auth(other.token), payload: { method: "card" } });
    expect(r.statusCode).toBe(200);
    expect(t.paystack.initialized.at(-1)).toMatchObject({ plan: "PLN_test_individual" });
    expect(t.paystack.initialized.at(-1).channels).toBeUndefined();
    const bad = await t.app.inject({ method: "POST", url: `/v1/orgs/${other.orgId}/billing/checkout`, headers: auth(other.token), payload: { method: "bitcoin" } });
    expect(bad.statusCode).toBe(400);
  });
});
