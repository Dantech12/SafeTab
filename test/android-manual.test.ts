import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateSubscription, auth, makeApp, ownerQuery, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";

// PUBLIC_BASE_URL is http://localhost here (see setup-env), as on an admin's laptop.
let t: TestCtx;
let admin: Awaited<ReturnType<typeof signup>>;
let other: Awaited<ReturnType<typeof signup>>;

beforeAll(async () => {
  await resetDb();
  t = await makeApp();
  admin = await signup(t.app, "it@laptop.test");
  other = await signup(t.app, "it@elsewhere.test");
  await activateSubscription(admin.orgId);
});

afterAll(async () => {
  await t.app.close();
  await closePool();
});

const url = (orgId: string, p: string) => `/v1/orgs/${orgId}${p}`;

describe("manual Android signup (no https on this machine)", () => {
  it("refuses completion when no signup was started", async () => {
    const r = await t.app.inject({ method: "POST", url: url(admin.orgId, "/android/complete"), headers: auth(admin.token), payload: { enterpriseToken: "x" } });
    expect(r.json().error).toBe("no_pending_signup_start_again");
  });

  it("uses an https static callback page instead of localhost", async () => {
    const r = await t.app.inject({ method: "POST", url: url(admin.orgId, "/android/signup"), headers: auth(admin.token) });
    expect(r.json().mode).toBe("manual");
    const name = [...t.mdm.signups.keys()].at(-1)!;
    expect(t.mdm.signups.get(name)!.callbackUrl).toMatch(/^https:\/\//);
    expect(t.mdm.signups.get(name)!.callbackUrl).not.toContain("localhost");
  });

  it("rejects a wrong token and lets the admin retry", async () => {
    const r = await t.app.inject({ method: "POST", url: url(admin.orgId, "/android/complete"), headers: auth(admin.token), payload: { enterpriseToken: "wrong" } });
    expect(r.json().error).toBe("google_rejected_token_start_again");
  });

  it("another org cannot complete this org's signup", async () => {
    const name = [...t.mdm.signups.keys()].at(-1)!;
    const tokenValue = new URL(t.mdm.completeSignup(name)).searchParams.get("enterpriseToken")!;
    const r = await t.app.inject({ method: "POST", url: url(other.orgId, "/android/complete"), headers: auth(other.token), payload: { enterpriseToken: tokenValue } });
    expect(r.json().error).toBe("no_pending_signup_start_again");
  });

  it("connects with the token pasted from the address bar, once, even after the local window", async () => {
    // Google's pages can take longer than our redirect window; Google decides token validity.
    await ownerQuery("UPDATE organizations SET amapi_signup_expires_at = now() - interval '1 hour' WHERE id = $1", [admin.orgId]);
    const name = [...t.mdm.signups.keys()].at(-1)!;
    const tokenValue = new URL(t.mdm.completeSignup(name)).searchParams.get("enterpriseToken")!;
    const r = await t.app.inject({ method: "POST", url: url(admin.orgId, "/android/complete"), headers: auth(admin.token), payload: { enterpriseToken: tokenValue } });
    expect(r.statusCode).toBe(200);
    expect(r.json().enterpriseName).toMatch(/^enterprises\//);
    const again = await t.app.inject({ method: "POST", url: url(admin.orgId, "/android/complete"), headers: auth(admin.token), payload: { enterpriseToken: tokenValue } });
    expect(again.statusCode).toBe(409);
  });
});
