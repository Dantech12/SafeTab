import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, makeApp, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";

let t: TestCtx;
let admin: Awaited<ReturnType<typeof signup>>;

beforeAll(async () => {
  await resetDb();
  t = await makeApp();
  admin = await signup(t.app, "portal@school.test");
});

afterAll(async () => {
  await t.app.close();
  await closePool();
});

describe("portal", () => {
  it("serves the portal files with a strict same-origin script policy", async () => {
    const page = await t.app.inject({ method: "GET", url: "/" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.body).toContain('<script src="/app.js">');
    expect(String(page.headers["content-security-policy"])).toMatch(/script-src 'self'/);
    expect((await t.app.inject({ method: "GET", url: "/app.js" })).headers["content-type"]).toMatch(/javascript/);
    expect((await t.app.inject({ method: "GET", url: "/app.css" })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/../package.json" })).statusCode).toBe(404);
  });

  it("exposes pilot mode and companion status on the org", async () => {
    const org = (await t.app.inject({ method: "GET", url: `/v1/orgs/${admin.orgId}`, headers: auth(admin.token) })).json();
    expect(org.pilotMode).toBe(true);
    expect(typeof org.companionAppEnabled).toBe("boolean");
  });

  it("pilot activation (non-production) needs billing permission and is audited", async () => {
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${admin.orgId}/billing/pilot-activate`, headers: auth(admin.token) });
    expect(r.statusCode).toBe(200);
    const b = (await t.app.inject({ method: "GET", url: `/v1/orgs/${admin.orgId}/billing`, headers: auth(admin.token) })).json();
    expect(b.access).toBe("full");
    const log = (await t.app.inject({ method: "GET", url: `/v1/orgs/${admin.orgId}/audit`, headers: auth(admin.token) })).json();
    expect(log.entries.some((e: any) => e.action === "billing.pilot_activated")).toBe(true);
    const outsider = await signup(t.app, "outsider@else.test");
    expect((await t.app.inject({ method: "POST", url: `/v1/orgs/${admin.orgId}/billing/pilot-activate`, headers: auth(outsider.token) })).statusCode).toBe(404);
  });

  it("returns a QR image for a new tablet", async () => {
    await t.app.inject({ method: "PUT", url: `/v1/orgs/${admin.orgId}/android-enterprise`, headers: auth(admin.token), payload: { enterpriseName: "enterprises/LCportal" } });
    const s = (await t.app.inject({ method: "POST", url: `/v1/orgs/${admin.orgId}/students`, headers: auth(admin.token), payload: { displayName: "Kwame", ageBand: "13_15" } })).json();
    const d = await t.app.inject({ method: "POST", url: `/v1/orgs/${admin.orgId}/students/${s.id}/devices`, headers: auth(admin.token), payload: { ownership: "school_owned", label: "Tab 1" } });
    expect(d.statusCode).toBe(201);
    expect(d.json().qrPng).toMatch(/^data:image\/png;base64,/);
  });
});
