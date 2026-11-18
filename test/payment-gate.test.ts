import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateSubscription, auth, makeApp, ownerQuery, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";

let t: TestCtx;
beforeAll(async () => {
  await resetDb();
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
  await closePool();
});

describe("nothing works until the workspace has paid", () => {
  it("blocks every feature except billing for a workspace that hasn't paid", async () => {
    const s = await signup(t.app, "head@unpaid.test", "school");
    const go = (method: "GET" | "POST" | "PUT", path: string, payload?: object) =>
      t.app.inject({ method, url: `/v1/orgs/${s.orgId}${path}`, headers: auth(s.token), payload });

    for (const [m, p, body] of [
      ["GET", "/students"], ["POST", "/students", { displayName: "Kofi", ageBand: "under_13" }],
      ["GET", "/devices"], ["GET", "/members"], ["GET", "/audit"],
      ["POST", "/invitations", { email: "x@unpaid.test", role: "supervisor" }], ["POST", "/android/signup"],
    ] as const) {
      const r = await go(m, p, body as object | undefined);
      expect(r.statusCode, `${m} ${p}`).toBe(402);
      expect(r.json().error).toBe("payment_required");
    }

    // Open: the workspace shell (says it isn't paid), billing, and what SafeTab collects.
    const org = (await go("GET", "")).json();
    expect(org).toMatchObject({ paid: false, everPaid: false });
    expect((await go("GET", "/billing")).statusCode).toBe(200);
    expect((await go("POST", "/billing/checkout", { method: "momo" })).statusCode).toBe(200);
    expect((await go("GET", "/data-inventory")).statusCode).toBe(200);

    // Paying unlocks everything.
    await activateSubscription(s.orgId);
    expect((await go("GET", "")).json().paid).toBe(true);
    expect((await go("POST", "/students", { displayName: "Kofi", ageBand: "under_13" })).statusCode).toBe(201);
    expect((await go("GET", "/students")).statusCode).toBe(200);
  });

  it("locks again when the paid time runs out, but parents keep access to their child and consent", async () => {
    const s = await signup(t.app, "head@lapsed.test", "school");
    await activateSubscription(s.orgId);
    const url = (p: string) => `/v1/orgs/${s.orgId}${p}`;
    const studentId = (await t.app.inject({ method: "POST", url: url("/students"), headers: auth(s.token), payload: { displayName: "Esi", ageBand: "13_15" } })).json().id;
    const inv = (await t.app.inject({ method: "POST", url: url("/invitations"), headers: auth(s.token), payload: { email: "mum@lapsed.test", role: "guardian", studentId } })).json();
    const parent = (await t.app.inject({ method: "POST", url: "/v1/invitations/accept", payload: { token: inv.token, password: "a long parent password", displayName: "Abena" } })).json().token;

    await ownerQuery("UPDATE subscriptions SET status = 'lapsed', current_period_end = now() - interval '30 days', grace_until = NULL WHERE org_id = $1", [s.orgId]);

    const org = (await t.app.inject({ method: "GET", url: url(""), headers: auth(s.token) })).json();
    expect(org).toMatchObject({ paid: false, everPaid: true });
    expect((await t.app.inject({ method: "GET", url: url("/students"), headers: auth(s.token) })).statusCode).toBe(402);
    // The school can still take data out.
    expect((await t.app.inject({ method: "GET", url: url(`/students/${studentId}/export`), headers: auth(s.token) })).statusCode).toBe(200);

    // The parent isn't locked out of their own child's page or consent.
    expect((await t.app.inject({ method: "GET", url: url(`/students/${studentId}`), headers: auth(parent) })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: url(`/students/${studentId}/consent`), headers: auth(parent) })).statusCode).toBe(200);
    // ...but can't use the school's lapsed workspace for anything else.
    expect((await t.app.inject({ method: "POST", url: url("/invitations"), headers: auth(parent), payload: { email: "z@lapsed.test", role: "guardian", studentId } })).statusCode).toBe(402);
  });
});
