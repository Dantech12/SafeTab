import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateSubscription, auth, makeApp, ownerQuery, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";
import { runDowntimeTick } from "../src/jobs/downtime.js";
import { compilePolicy } from "../src/policy/compile.js";
import { parsePolicySpec } from "../src/policy/spec.js";

let t: TestCtx;
let school: Awaited<ReturnType<typeof signup>>;
let parentToken: string;
let studentId: string;
let otherStudentId: string;
let deviceId: string;
const ENT = "enterprises/LCconsent";
const TIKTOK = "com.zhiliaoapp.musically";
const policyOf = () => t.mdm.policies.get(`${ENT}/policies/device-${deviceId}`)!;
const tiktokEntry = () => (policyOf().policy.applications as any[]).find((a) => a.packageName === TIKTOK);

// Monday 2026-11-09. School hours below are 07:30–15:00 UTC, Mon–Fri.
const IN_SCHOOL = new Date("2026-11-09T10:00:00Z");
const AFTER_SCHOOL = new Date("2026-11-09T17:00:00Z");
const RULES = {
  schoolHours: { enabled: true, timezone: "UTC", windows: [{ days: [1, 2, 3, 4, 5], start: "07:30", end: "15:00" }], blockedApps: [TIKTOK] },
  apps: { mode: "blocklist", packages: ["com.example.alwaysblocked"] },
  web: { mode: "blocklist", domains: ["example-games.test"] },
};

beforeAll(async () => {
  await resetDb();
  t = await makeApp();
  school = await signup(t.app, "it@consent-school.test");
  await activateSubscription(school.orgId);
  await t.app.inject({ method: "PUT", url: `/v1/orgs/${school.orgId}/android-enterprise`, headers: auth(school.token), payload: { enterpriseName: ENT } });
  studentId = (await t.app.inject({ method: "POST", url: `/v1/orgs/${school.orgId}/students`, headers: auth(school.token), payload: { displayName: "Esi", ageBand: "13_15" } })).json().id;
  otherStudentId = (await t.app.inject({ method: "POST", url: `/v1/orgs/${school.orgId}/students`, headers: auth(school.token), payload: { displayName: "Yaw", ageBand: "13_15" } })).json().id;
});

afterAll(async () => {
  await t.app.close();
  await closePool();
});

const url = (p: string) => `/v1/orgs/${school.orgId}${p}`;

describe("parent invitation", () => {
  it("guardian invitations must name a student of this org", async () => {
    expect((await t.app.inject({ method: "POST", url: url("/invitations"), headers: auth(school.token), payload: { email: "p@x.test", role: "guardian" } })).statusCode).toBe(400);
    const foreign = "00000000-0000-4000-8000-000000000000";
    expect((await t.app.inject({ method: "POST", url: url("/invitations"), headers: auth(school.token), payload: { email: "p@x.test", role: "guardian", studentId: foreign } })).json().error).toBe("unknown_student");
  });

  it("a parent joins and sees only their own child, read-only", async () => {
    const inv = (await t.app.inject({ method: "POST", url: url("/invitations"), headers: auth(school.token), payload: { email: "mum@family.test", role: "guardian", studentId } })).json();
    expect(inv.acceptUrl).toContain("/#/invite/");
    const ok = await t.app.inject({ method: "POST", url: "/v1/invitations/accept", payload: { token: inv.token, password: "a long parent password", displayName: "Abena Mensah" } });
    expect(ok.statusCode).toBe(200);
    parentToken = ok.json().token;

    const list = (await t.app.inject({ method: "GET", url: url("/students"), headers: auth(parentToken) })).json();
    expect(list.students.map((s: any) => s.id)).toEqual([studentId]);
    expect((await t.app.inject({ method: "GET", url: url(`/students/${otherStudentId}`), headers: auth(parentToken) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "PUT", url: url(`/students/${studentId}/policy`), headers: auth(parentToken), payload: { expectedVersion: 0, spec: {} } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "GET", url: url("/members"), headers: auth(parentToken) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "GET", url: url("/audit"), headers: auth(parentToken) })).statusCode).toBe(403);
  });
});

describe("consent", () => {
  it("there is nothing to consent to until the school sets school-hours rules", async () => {
    const r = await t.app.inject({ method: "POST", url: url(`/students/${studentId}/consent`), headers: auth(parentToken), payload: { signatureName: "Abena Mensah", agree: true } });
    expect(r.json().error).toBe("no_school_hours_rules_to_consent_to");
    const put = await t.app.inject({ method: "PUT", url: url(`/students/${studentId}/policy`), headers: auth(school.token), payload: { expectedVersion: 0, spec: RULES } });
    expect(put.statusCode).toBe(200);
  });

  it("a parent-owned tablet cannot be enrolled without consent", async () => {
    const r = await t.app.inject({ method: "POST", url: url(`/students/${studentId}/devices`), headers: auth(school.token), payload: { ownership: "family_owned" } });
    expect(r.json().error).toBe("parent_consent_required");
  });

  it("staff cannot consent on the parent's behalf", async () => {
    const r = await t.app.inject({ method: "POST", url: url(`/students/${studentId}/consent`), headers: auth(school.token), payload: { signatureName: "Someone", agree: true } });
    expect(r.statusCode).toBe(403);
  });

  it("the parent sees the exact rules in the consent text and agrees", async () => {
    const c = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/consent`), headers: auth(parentToken) })).json();
    expect(c.status).toBe("none");
    expect(c.canGive).toBe(true);
    expect(c.consentText).toContain(TIKTOK);
    expect(c.consentText).toContain("07:30–15:00");
    expect(c.consentText).toMatch(/not deleted/);
    const r = await t.app.inject({ method: "POST", url: url(`/students/${studentId}/consent`), headers: auth(parentToken), payload: { signatureName: "Abena Mensah", agree: true } });
    expect(r.statusCode).toBe(200);
    const staffView = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/consent`), headers: auth(school.token) })).json();
    expect(staffView.status).toBe("active");
    expect(staffView.canGive).toBe(false);
    expect(staffView.guardians[0].email).toBe("mum@family.test");
  });

  it("then the tablet can be enrolled, and only school-hours rules apply to it", async () => {
    t.clock.now = IN_SCHOOL;
    const r = await t.app.inject({ method: "POST", url: url(`/students/${studentId}/devices`), headers: auth(school.token), payload: { ownership: "family_owned", label: "Esi's tablet" } });
    expect(r.statusCode).toBe(201);
    deviceId = r.json().deviceId;
    const p = policyOf().policy;
    const pkgs = (p.applications as any[]).map((a) => a.packageName);
    expect(pkgs).not.toContain("com.example.alwaysblocked"); // always-on rules don't apply
    expect(pkgs).not.toContain("com.android.chrome"); // no web rules on family devices
    expect(p.factoryResetDisabled).toBe(false); // the family can always reset their own tablet
    expect(tiktokEntry()).toMatchObject({ disabled: true }); // inside school hours
    expect(tiktokEntry().installType).not.toBe("BLOCKED"); // never uninstalls
    await ownerQuery("UPDATE devices SET state = 'active' WHERE id = $1", [deviceId]);
  });

  it("switches apps back on after school and off again next school day", async () => {
    expect(await runDowntimeTick(t.mdm, AFTER_SCHOOL)).toBe(1);
    expect(tiktokEntry()).toBeUndefined();
    expect(await runDowntimeTick(t.mdm, AFTER_SCHOOL)).toBe(0);
    expect(await runDowntimeTick(t.mdm, new Date("2026-11-10T08:00:00Z"))).toBe(1);
    expect(tiktokEntry()).toMatchObject({ disabled: true });
    expect(await runDowntimeTick(t.mdm, new Date("2026-11-14T10:00:00Z"))).toBe(1); // Saturday
    expect(tiktokEntry()).toBeUndefined();
  });

  it("if the school changes the rules, enforcement pauses until the parent agrees again", async () => {
    t.clock.now = IN_SCHOOL;
    const cur = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/policy`), headers: auth(school.token) })).json();
    const wider = { ...cur.spec, schoolHours: { ...cur.spec.schoolHours, blockedApps: [TIKTOK, "com.instagram.android"] } };
    await t.app.inject({ method: "PUT", url: url(`/students/${studentId}/policy`), headers: auth(school.token), payload: { expectedVersion: cur.version, spec: wider } });
    expect(tiktokEntry()).toBeUndefined();
    const c = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/consent`), headers: auth(parentToken) })).json();
    expect(c.status).toBe("needs_reconsent");
    const pol = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/policy`), headers: auth(school.token) })).json();
    expect(pol.rollout[0].controls.find((x: any) => x.control === "schoolHours")).toMatchObject({ supported: false });

    await t.app.inject({ method: "POST", url: url(`/students/${studentId}/consent`), headers: auth(parentToken), payload: { signatureName: "Abena Mensah", agree: true } });
    expect(tiktokEntry()).toMatchObject({ disabled: true });
  });

  it("withdrawal stops enforcement immediately and is recorded", async () => {
    const r = await t.app.inject({ method: "POST", url: url(`/students/${studentId}/consent/withdraw`), headers: auth(parentToken) });
    expect(r.statusCode).toBe(200);
    expect(tiktokEntry()).toBeUndefined();
    const c = (await t.app.inject({ method: "GET", url: url(`/students/${studentId}/consent`), headers: auth(school.token) })).json();
    expect(c.status).toBe("withdrawn");
    const log = (await t.app.inject({ method: "GET", url: url("/audit"), headers: auth(school.token) })).json();
    const actions = log.entries.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["consent.granted", "consent.withdrawn"]));
    // Consent history is kept as evidence; the app role cannot delete it.
    const history = await ownerQuery("SELECT count(*) FROM parental_consents WHERE student_id = $1", [studentId]);
    expect(Number(history.rows[0].count)).toBe(2);
  });
});

describe("deletion", () => {
  it("deleting the student (after retiring the tablet) removes their consent records too", async () => {
    await t.app.inject({ method: "POST", url: url(`/devices/${deviceId}/retire`), headers: auth(school.token), payload: { confirmWipe: true } });
    const r = await t.app.inject({ method: "DELETE", url: url(`/students/${studentId}`), headers: auth(school.token) });
    expect(r.statusCode).toBe(204);
    const left = await ownerQuery("SELECT count(*) FROM parental_consents WHERE student_id = $1", [studentId]);
    expect(Number(left.rows[0].count)).toBe(0);
  });
});

describe("compiler (family-owned)", () => {
  it("never applies downtime or usage collection on parent-owned tablets", () => {
    const spec = parsePolicySpec({
      downtime: { enabled: true, timezone: "UTC", windows: [{ days: [1], start: "21:00", end: "07:00" }] },
      usageSummaries: { enabled: true },
    });
    const { controls } = compilePolicy({ spec, ownership: "family_owned", inDowntime: false, companionPackage: "org.x.y", companionEnabled: true, apiBaseUrl: "https://a.test" });
    expect(controls.find((c) => c.control === "downtime")).toMatchObject({ supported: false });
    expect(controls.find((c) => c.control === "usageSummaries")).toMatchObject({ supported: false });
  });
});
