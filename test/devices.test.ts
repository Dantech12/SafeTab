import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateSubscription, auth, makeApp, ownerQuery, PUBSUB_TEST_TOKEN, pubsubPush, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";
import { runDowntimeTick } from "../src/jobs/downtime.js";
import { runRetention } from "../src/jobs/retention.js";

let t: TestCtx;
let admin: Awaited<ReturnType<typeof signup>>;
let studentId: string;
let deviceId: string;
let enrollmentTokenName: string;
let deviceToken: string;
const ENTERPRISE = "enterprises/LCtest123";
const MDM_NAME = `${ENTERPRISE}/devices/dev001`;
const policyName = () => `${ENTERPRISE}/policies/device-${deviceId}`;

beforeAll(async () => {
  await resetDb();
  t = await makeApp();
  admin = await signup(t.app, "it@school.test");
  studentId = (await t.app.inject({ method: "POST", url: `/v1/orgs/${admin.orgId}/students`, headers: auth(admin.token), payload: { displayName: "Esi", ageBand: "under_13" } })).json().id;
});

afterAll(async () => {
  await t.app.close();
  await closePool();
});

const url = (p: string) => `/v1/orgs/${admin.orgId}${p}`;

describe("enrollment", () => {
  it("requires an active subscription and a configured Android enterprise", async () => {
    let r = await t.app.inject({ method: "POST", url: url(`/students/${studentId}/devices`), headers: auth(admin.token), payload: { ownership: "school_owned" } });
    expect(r.statusCode).toBe(402);
    await activateSubscription(admin.orgId);
    r = await t.app.inject({ method: "POST", url: url(`/students/${studentId}/devices`), headers: auth(admin.token), payload: { ownership: "school_owned" } });
    expect(r.json().error).toBe("android_enterprise_not_configured");
    await t.app.inject({ method: "PUT", url: url("/android-enterprise"), headers: auth(admin.token), payload: { enterpriseName: ENTERPRISE } });
  });

  it("creates a one-time enrollment token after pushing the device policy", async () => {
    const r = await t.app.inject({ method: "POST", url: url(`/students/${studentId}/devices`), headers: auth(admin.token), payload: { ownership: "school_owned", label: "Tablet 7" } });
    expect(r.statusCode).toBe(201);
    deviceId = r.json().deviceId;
    expect(r.json().qrCode).toBeTruthy();
    const pol = t.mdm.policies.get(policyName())!;
    expect(pol.version).toBe(1);
    const companion = (pol.policy.applications as any[])[0];
    expect(companion.installType).toBe("FORCE_INSTALLED");
    expect(companion.managedConfiguration.registration_code).toBeTruthy();
    const dev = await ownerQuery("SELECT enrollment_token_name, state FROM devices WHERE id = $1", [deviceId]);
    enrollmentTokenName = dev.rows[0].enrollment_token_name;
    expect(dev.rows[0].state).toBe("pending_enrollment");
  });

  it("rejects unauthenticated Pub/Sub pushes", async () => {
    const r = await t.app.inject({ method: "POST", url: "/webhooks/amapi", payload: pubsubPush("ENROLLMENT", { name: MDM_NAME, enrollmentTokenName }, "m0") });
    expect(r.statusCode).toBe(401);
  });

  it("activates the device on the ENROLLMENT notification and marks policy applied on status report", async () => {
    let r = await t.app.inject({ method: "POST", url: "/webhooks/amapi", headers: { authorization: PUBSUB_TEST_TOKEN },
      payload: pubsubPush("ENROLLMENT", { name: MDM_NAME, enrollmentTokenName, state: "ACTIVE" }, "m1") });
    expect(r.statusCode).toBe(204);
    let pol = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/policy`), headers: auth(admin.token) })).json();
    expect(pol.rollout[0].status).toBe("pending"); // not claimed until the device reports

    r = await t.app.inject({ method: "POST", url: "/webhooks/amapi", headers: { authorization: PUBSUB_TEST_TOKEN },
      payload: pubsubPush("STATUS_REPORT", { name: MDM_NAME, state: "ACTIVE", appliedPolicyVersion: "1", policyCompliant: true }, "m2") });
    pol = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/policy`), headers: auth(admin.token) })).json();
    expect(pol.rollout[0].status).toBe("applied");
    expect(pol.rollout[0].deviceState).toBe("active");
  });

  it("ignores duplicate Pub/Sub deliveries", async () => {
    const r = await t.app.inject({ method: "POST", url: "/webhooks/amapi", headers: { authorization: PUBSUB_TEST_TOKEN },
      payload: pubsubPush("STATUS_REPORT", { name: MDM_NAME, appliedPolicyVersion: "1" }, "m2") });
    expect(r.statusCode).toBe(204);
    const n = await ownerQuery("SELECT count(*) FROM webhook_events WHERE id = 'amapi:m2'");
    expect(Number(n.rows[0].count)).toBe(1);
  });
});

describe("companion app", () => {
  it("registers once with the code from managed configuration", async () => {
    const code = (t.mdm.policies.get(policyName())!.policy.applications as any[])[0].managedConfiguration.registration_code;
    const r = await t.app.inject({ method: "POST", url: "/device/v1/register", payload: { registrationCode: code } });
    expect(r.statusCode).toBe(200);
    deviceToken = r.json().deviceToken;
    expect((await t.app.inject({ method: "POST", url: "/device/v1/register", payload: { registrationCode: code } })).statusCode).toBe(400);
    // Policy re-pushed without the used code.
    const after = (t.mdm.policies.get(policyName())!.policy.applications as any[])[0].managedConfiguration;
    expect(after.registration_code).toBeUndefined();
  });

  it("shows the student an age-appropriate notice of what is managed and collected", async () => {
    const r = await t.app.inject({ method: "GET", url: "/device/v1/notice", headers: auth(deviceToken) });
    expect(r.statusCode).toBe(200);
    const n = r.json();
    expect(n.summary).toMatch(/cannot read your messages/);
    expect(n.usageSummaries.enabled).toBe(false);
    expect(n.dataInventory.notCollected).toContain("keystrokes");
  });

  it("refuses usage uploads unless summaries are enabled by policy", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const r = await t.app.inject({ method: "POST", url: "/device/v1/usage", headers: auth(deviceToken), payload: { day, apps: [{ package: "com.example.reader", minutes: 30 }] } });
    expect(r.statusCode).toBe(409);
    expect(r.json().collect).toBe(false);
  });
});

describe("policy changes", () => {
  it("rejects stale writes (optimistic concurrency)", async () => {
    const r = await t.app.inject({ method: "PUT", url: url(`/students/${studentId}/policy`), headers: auth(admin.token), payload: { expectedVersion: 5, spec: {} } });
    expect(r.statusCode).toBe(409);
  });

  it("deploys as pending, then applied/failed per device report, and audits the change", async () => {
    const spec = { usageSummaries: { enabled: true }, apps: { mode: "blocklist", packages: ["com.example.game"] }, web: { mode: "blocklist", domains: ["example.net"] } };
    const r = await t.app.inject({ method: "PUT", url: url(`/students/${studentId}/policy`), headers: auth(admin.token), payload: { expectedVersion: 0, spec } });
    expect(r.statusCode).toBe(200);
    expect(r.json().deployments[0].status).toBe("pending");
    const v = t.mdm.policies.get(policyName())!.version;

    let pol = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/policy`), headers: auth(admin.token) })).json();
    expect(pol.rollout[0].status).toBe("pending");
    expect(pol.rollout[0].controls.find((c: any) => c.control === "web").note).toMatch(/Chrome only/);

    await t.app.inject({ method: "POST", url: "/webhooks/amapi", headers: { authorization: PUBSUB_TEST_TOKEN },
      payload: pubsubPush("STATUS_REPORT", { name: MDM_NAME, appliedPolicyVersion: String(v), policyCompliant: false,
        nonComplianceDetails: [{ settingName: "applications", packageName: "com.android.chrome", nonComplianceReason: "APP_NOT_INSTALLED" }] }, "m3") });
    pol = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/policy`), headers: auth(admin.token) })).json();
    expect(pol.rollout[0].status).toBe("failed");
    expect(pol.rollout[0].nonCompliance[0].nonComplianceReason).toBe("APP_NOT_INSTALLED");

    const log = (await t.app.inject({ method: "GET", url: url("/audit"), headers: auth(admin.token) })).json();
    expect(log.entries.some((e: any) => e.action === "policy.updated")).toBe(true);
  });

  it("records a failed push when the MDM call fails", async () => {
    t.mdm.failNextUpsert = true;
    const r = await t.app.inject({ method: "PUT", url: url(`/students/${studentId}/policy`), headers: auth(admin.token),
      payload: { expectedVersion: 1, spec: { usageSummaries: { enabled: true } } } });
    expect(r.json().deployments[0].status).toBe("failed");
  });

  it("accepts aggregate usage once enabled and shows it in the activity summary", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const up = await t.app.inject({ method: "POST", url: "/device/v1/usage", headers: auth(deviceToken),
      payload: { day, apps: [{ package: "com.example.reader", minutes: 30 }, { package: "com.example.math", minutes: 15 }] } });
    expect(up.statusCode).toBe(200);
    const act = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/activity`), headers: auth(admin.token) })).json();
    expect(act.daily[0].minutes).toBe(45);
    expect(act.topApps[0]).toEqual({ package: "com.example.reader", minutes: 30 });
  });

  it("rejects usage outside the accepted day window", async () => {
    const r = await t.app.inject({ method: "POST", url: "/device/v1/usage", headers: auth(deviceToken), payload: { day: "2020-01-01", apps: [] } });
    expect(r.statusCode).toBe(400);
  });
});

describe("downtime scheduler", () => {
  it("switches the device into and out of kiosk downtime at window boundaries", async () => {
    const cur = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/policy`), headers: auth(admin.token) })).json();
    const spec = { ...cur.spec, downtime: { enabled: true, timezone: "UTC", windows: [{ days: [1, 2, 3, 4, 5, 6, 7], start: "21:00", end: "07:00" }] } };
    t.clock.now = new Date("2026-11-11T12:00:00Z");
    await t.app.inject({ method: "PUT", url: url(`/students/${studentId}/policy`), headers: auth(admin.token), payload: { expectedVersion: cur.version, spec } });

    expect(await runDowntimeTick(t.mdm, new Date("2026-11-11T12:00:00Z"))).toBe(0);
    expect(await runDowntimeTick(t.mdm, new Date("2026-11-11T22:00:00Z"))).toBe(1);
    expect((t.mdm.policies.get(policyName())!.policy.applications as any[])[0].installType).toBe("KIOSK");
    expect(await runDowntimeTick(t.mdm, new Date("2026-11-11T23:00:00Z"))).toBe(0);
    expect(await runDowntimeTick(t.mdm, new Date("2026-11-12T07:30:00Z"))).toBe(1);
    expect((t.mdm.policies.get(policyName())!.policy.applications as any[])[0].installType).toBe("FORCE_INSTALLED");
  });
});

describe("lost devices, export, deletion and retention", () => {
  it("marking lost locks the device and revokes the companion credential", async () => {
    const r = await t.app.inject({ method: "POST", url: url(`/devices/${deviceId}/lost`), headers: auth(admin.token) });
    expect(r.statusCode).toBe(200);
    expect(t.mdm.commands).toContainEqual({ device: MDM_NAME, type: "LOCK" });
    expect((await t.app.inject({ method: "GET", url: "/device/v1/notice", headers: auth(deviceToken) })).statusCode).toBe(401);
  });

  it("exports the student's data", async () => {
    const r = await t.app.inject({ method: "GET", url: url(`/students/${studentId}/export`), headers: auth(admin.token) });
    expect(r.statusCode).toBe(200);
    expect(r.json().appUsageDaily).toHaveLength(2);
  });

  it("retention removes usage rows older than the org's window", async () => {
    await ownerQuery("UPDATE app_usage_daily SET day = current_date - 40");
    const res = await runRetention(process.env.DATABASE_OWNER_URL!);
    expect(res.usage).toBe(2);
  });

  it("requires devices to be retired (with explicit wipe confirmation) before deleting a student", async () => {
    expect((await t.app.inject({ method: "DELETE", url: url(`/students/${studentId}`), headers: auth(admin.token) })).statusCode).toBe(409);
    expect((await t.app.inject({ method: "POST", url: url(`/devices/${deviceId}/retire`), headers: auth(admin.token), payload: {} })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: url(`/devices/${deviceId}/retire`), headers: auth(admin.token), payload: { confirmWipe: true } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "DELETE", url: url(`/students/${studentId}`), headers: auth(admin.token) })).statusCode).toBe(204);
    const left = await ownerQuery("SELECT (SELECT count(*) FROM devices) d, (SELECT count(*) FROM policies) p, (SELECT count(*) FROM policy_deployments) pd");
    expect(left.rows[0]).toEqual({ d: "0", p: "0", pd: "0" });
  });
});
