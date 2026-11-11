import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateSubscription, auth, makeApp, ownerQuery, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";
import { pollDeviceStatus } from "../src/jobs/poll-devices.js";
import { compilePolicy } from "../src/policy/compile.js";
import { parsePolicySpec } from "../src/policy/spec.js";

let t: TestCtx;
let admin: Awaited<ReturnType<typeof signup>>;
let other: Awaited<ReturnType<typeof signup>>;
let enterprise: string;

beforeAll(async () => {
  await resetDb();
  t = await makeApp();
  admin = await signup(t.app, "it@pilot.test");
  other = await signup(t.app, "it@other.test");
  await activateSubscription(admin.orgId);
});

afterAll(async () => {
  await t.app.close();
  await closePool();
});

const url = (p: string) => `/v1/orgs/${admin.orgId}${p}`;

describe("Android Enterprise signup", () => {
  let signupName: string;

  it("only org admins can start it", async () => {
    const r = await t.app.inject({ method: "POST", url: url("/android/signup"), headers: auth(other.token) });
    expect(r.statusCode).toBe(404); // not a member of this org
  });

  it("returns a Google signup URL and stores only a hash of the state", async () => {
    const r = await t.app.inject({ method: "POST", url: url("/android/signup"), headers: auth(admin.token) });
    expect(r.statusCode).toBe(200);
    expect(r.json().signupUrl).toMatch(/^https:\/\//);
    signupName = [...t.mdm.signups.keys()].at(-1)!;
    const row = (await ownerQuery("SELECT amapi_signup_state_hash FROM organizations WHERE id = $1", [admin.orgId])).rows[0];
    const callback = t.mdm.signups.get(signupName)!.callbackUrl;
    const state = new URL(callback).searchParams.get("state")!;
    expect(row.amapi_signup_state_hash).not.toContain(state);
  });

  it("rejects a callback with a wrong state", async () => {
    const r = await t.app.inject({ method: "GET", url: "/android/callback?state=wrong-state-wrong-state-123&enterpriseToken=x" });
    expect(r.statusCode).toBe(400);
    expect(r.body).toMatch(/expired/);
  });

  it("creates the enterprise on callback, once", async () => {
    const back = new URL(t.mdm.completeSignup(signupName));
    const path = `${back.pathname}${back.search}`;
    const r = await t.app.inject({ method: "GET", url: path });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/Android connected/);
    const status = (await t.app.inject({ method: "GET", url: url("/android"), headers: auth(admin.token) })).json();
    expect(status.connected).toBe(true);
    enterprise = status.enterpriseName;
    expect((await t.app.inject({ method: "GET", url: path })).statusCode).toBe(400); // single use
    expect((await t.app.inject({ method: "POST", url: url("/android/signup"), headers: auth(admin.token) })).statusCode).toBe(409);
  });
});

describe("status polling (no Pub/Sub)", () => {
  it("activates an enrolled device and confirms its policy", async () => {
    const studentId = (await t.app.inject({ method: "POST", url: url("/students"), headers: auth(admin.token), payload: { displayName: "P", ageBand: "13_15" } })).json().id;
    const dev = (await t.app.inject({ method: "POST", url: url(`/students/${studentId}/devices`), headers: auth(admin.token), payload: { ownership: "school_owned" } })).json();
    const tokenName = (await ownerQuery("SELECT enrollment_token_name FROM devices WHERE id = $1", [dev.deviceId])).rows[0].enrollment_token_name;
    const version = t.mdm.policies.get(`${enterprise}/policies/device-${dev.deviceId}`)!.version;

    // Nothing enrolled yet.
    expect(await pollDeviceStatus(t.mdm, new Date())).toEqual({ seen: 0, matched: 0, errors: 0 });

    // The tablet scans the QR and reports in.
    t.mdm.devices.set(`${enterprise}/devices/abc`, { name: `${enterprise}/devices/abc`, enrollmentTokenName: tokenName, state: "ACTIVE", appliedPolicyVersion: version, policyCompliant: true });
    // A device from someone else's enrollment in the same enterprise is ignored.
    t.mdm.devices.set(`${enterprise}/devices/zzz`, { name: `${enterprise}/devices/zzz`, enrollmentTokenName: `${enterprise}/enrollmentTokens/unknown`, state: "ACTIVE" });

    expect(await pollDeviceStatus(t.mdm, new Date())).toEqual({ seen: 2, matched: 1, errors: 0 });
    const pol = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/policy`), headers: auth(admin.token) })).json();
    expect(pol.rollout[0].deviceState).toBe("active");
    expect(pol.rollout[0].status).toBe("applied");
    const log = (await t.app.inject({ method: "GET", url: url("/audit"), headers: auth(admin.token) })).json();
    expect(log.entries.filter((e: any) => e.action === "device.enrolled")).toHaveLength(1);

    // Re-polling is harmless.
    await pollDeviceStatus(t.mdm, new Date());
    const log2 = (await t.app.inject({ method: "GET", url: url("/audit"), headers: auth(admin.token) })).json();
    expect(log2.entries.filter((e: any) => e.action === "device.enrolled")).toHaveLength(1);
  });
});

describe("companion app not yet published", () => {
  const base = { ownership: "school_owned" as const, inDowntime: false, companionPackage: "org.example.safetab.student", companionEnabled: false, apiBaseUrl: "https://api.test" };

  it("omits the companion app and reports downtime/usage as unsupported instead of pretending", () => {
    const spec = parsePolicySpec({
      downtime: { enabled: true, timezone: "UTC", windows: [{ days: [1], start: "21:00", end: "07:00" }] },
      usageSummaries: { enabled: true },
      apps: { mode: "blocklist", packages: ["com.example.game"] },
    });
    const { policy, controls } = compilePolicy({ ...base, spec, registrationCode: "should-not-appear" });
    const apps = policy.applications as any[];
    expect(apps.map((a) => a.packageName)).toEqual(["com.example.game"]);
    expect(controls.find((c) => c.control === "downtime")).toMatchObject({ supported: false });
    expect(controls.find((c) => c.control === "usageSummaries")).toMatchObject({ supported: false });
    expect(controls.find((c) => c.control === "apps")).toMatchObject({ supported: true });
  });
});
