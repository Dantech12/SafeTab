import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, makeApp, ownerQuery, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";

let t: TestCtx;
let user: Awaited<ReturnType<typeof signup>>;

beforeAll(async () => {
  await resetDb();
  t = await makeApp();
  user = await signup(t.app, "ama@school.test");
});
afterAll(async () => {
  await t.app.close();
  await closePool();
});

const forgot = (email: string) => t.app.inject({ method: "POST", url: "/v1/auth/password/forgot", payload: { email } });
const settle = () => new Promise((r) => setTimeout(r, 150)); // email is sent in the background
const linkFrom = (text: string) => /#\/reset\/([A-Za-z0-9_-]+)/.exec(text)?.[1];

describe("forgot password", () => {
  it("answers the same way whether or not the account exists, and only emails real accounts", async () => {
    const a = await forgot("nobody@nowhere.test");
    const b = await forgot("AMA@school.test");
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
    await settle();
    expect(t.mailer.sent.map((m) => m.to)).toEqual(["ama@school.test"]);
    expect(t.mailer.sent[0]!.subject).toBe("Reset your password");
    expect(t.mailer.sent[0]!.html).toContain("Choose a new password");
  });

  it("stores only a hash of the link", async () => {
    const token = linkFrom(t.mailer.sent[0]!.text)!;
    const rows = await ownerQuery("SELECT token_hash FROM password_resets");
    expect(rows.rows.some((r) => r.token_hash === token)).toBe(false);
  });

  it("resets the password once, signs out everywhere, and sends a notice", async () => {
    const token = linkFrom(t.mailer.sent[0]!.text)!;
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/password/check", payload: { token } })).json().email).toBe("ama@school.test");
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/password/reset", payload: { token, password: "short" } })).statusCode).toBe(400);
    const r = await t.app.inject({ method: "POST", url: "/v1/auth/password/reset", payload: { token, password: "a brand new long password" } });
    expect(r.statusCode).toBe(200);
    // Old session no longer works; old password no longer works; new one does.
    expect((await t.app.inject({ method: "GET", url: "/v1/me", headers: auth(user.token) })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "ama@school.test", password: "correct horse battery staple" } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "ama@school.test", password: "a brand new long password" } })).statusCode).toBe(200);
    // Single use.
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/password/reset", payload: { token, password: "another long password" } })).json().error).toBe("reset_link_invalid");
    await settle();
    expect(t.mailer.sent.at(-1)!.subject).toBe("Your password was changed");
  });

  it("expired links don't work", async () => {
    await forgot("ama@school.test");
    await settle();
    const token = linkFrom(t.mailer.sent.at(-1)!.text)!;
    await ownerQuery("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/password/reset", payload: { token, password: "yet another long password" } })).json().error).toBe("reset_link_invalid");
  });

  it("limits how many links one account can request per hour", async () => {
    const before = t.mailer.sent.length;
    for (let i = 0; i < 5; i++) await forgot("ama@school.test");
    await settle();
    // 1 already sent this hour in the previous test (+1 earlier, used) -> at most 3 per hour in total.
    const count = Number((await ownerQuery("SELECT count(*) FROM password_resets WHERE created_at > now() - interval '1 hour'")).rows[0].count);
    expect(count).toBeLessThanOrEqual(3);
    expect(t.mailer.sent.length - before).toBeLessThanOrEqual(1);
  });
});

describe("invitation emails", () => {
  it("emails parents a clear invitation with the link", async () => {
    const admin = await signup(t.app, "it@brightfield.test");
    const s = (await t.app.inject({ method: "POST", url: `/v1/orgs/${admin.orgId}/students`, headers: auth(admin.token), payload: { displayName: "Esi Mensah", ageBand: "13_15" } })).json();
    const r = await t.app.inject({ method: "POST", url: `/v1/orgs/${admin.orgId}/invitations`, headers: auth(admin.token), payload: { email: "abena@family.test", role: "guardian", studentId: s.id } });
    expect(r.json().emailed).toBe(true);
    const mail = t.mailer.sent.at(-1)!;
    expect(mail.to).toBe("abena@family.test");
    expect(mail.subject).toContain("Esi Mensah");
    expect(mail.text).toContain(r.json().acceptUrl);
  });
});
