import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { activateSubscription, auth, makeApp, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";

let t: TestCtx;
let a: Awaited<ReturnType<typeof signup>>;
let b: Awaited<ReturnType<typeof signup>>;
let studentB: string;

beforeAll(async () => {
  await resetDb();
  t = await makeApp();
  a = await signup(t.app, "admin-a@school-a.test");
  b = await signup(t.app, "admin-b@school-b.test");
  await activateSubscription(a.orgId);
  await activateSubscription(b.orgId);
  const res = await t.app.inject({ method: "POST", url: `/v1/orgs/${b.orgId}/students`, headers: auth(b.token), payload: { displayName: "Kofi", ageBand: "13_15" } });
  studentB = res.json().id;
});

afterAll(async () => {
  await t.app.close();
  await closePool();
});

describe("authentication", () => {
  it("rejects missing and bogus tokens", async () => {
    expect((await t.app.inject({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "GET", url: "/v1/me", headers: auth("nope") })).statusCode).toBe(401);
  });

  it("does not store plaintext passwords or tokens", async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
    const u = await pool.query("SELECT password_hash FROM users LIMIT 1");
    expect(u.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const s = await pool.query("SELECT token_hash FROM sessions WHERE token_hash = $1", [a.token]);
    expect(s.rowCount).toBe(0);
    await pool.end();
  });

  it("locks out after repeated failures with a generic error", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "admin-a@school-a.test", password: "wrong-password-123" } });
      expect(r.json().error).toBe("invalid_credentials");
    }
    const r = await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "admin-a@school-a.test", password: "correct horse battery staple" } });
    expect(r.statusCode).toBe(401);
  });

  it("logout revokes the session", async () => {
    const s = await signup(t.app, "temp@x.test", "family");
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/logout", headers: auth(s.token) })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: "/v1/me", headers: auth(s.token) })).statusCode).toBe(401);
  });
});

describe("tenant isolation", () => {
  it("returns 404 for another org's resources", async () => {
    expect((await t.app.inject({ method: "GET", url: `/v1/orgs/${b.orgId}/students`, headers: auth(a.token) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/v1/orgs/${a.orgId}/students/${studentB}`, headers: auth(a.token) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/v1/orgs/${a.orgId}/students/${studentB}/activity`, headers: auth(a.token) })).statusCode).toBe(404);
  });

  it("RLS hides rows from the app role even without a WHERE clause", async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const c = await pool.connect();
    try {
      expect((await c.query("SELECT * FROM students")).rowCount).toBe(0); // no tenant set
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.org_id', $1, true)", [a.orgId]);
      expect((await c.query("SELECT * FROM students WHERE id = $1", [studentB])).rowCount).toBe(0);
      await expect(c.query("INSERT INTO students (org_id, display_name, age_band) VALUES ($1, 'x', '13_15')", [b.orgId])).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK");
    } finally {
      c.release();
      await pool.end();
    }
  });

  it("cannot assign another org's student to a supervisor", async () => {
    const me = (await t.app.inject({ method: "GET", url: "/v1/me", headers: auth(a.token) })).json();
    const r = await t.app.inject({ method: "PUT", url: `/v1/orgs/${a.orgId}/members/${me.user.id}/assignments`, headers: auth(a.token), payload: { studentIds: [studentB] } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("unknown_student");
  });
});

describe("roles and invitations", () => {
  let supToken: string;
  let supUserId: string;
  let s1: string;
  let s2: string;

  it("invitation is bound to the invited email", async () => {
    const inv = (await t.app.inject({ method: "POST", url: `/v1/orgs/${a.orgId}/invitations`, headers: auth(a.token), payload: { email: "teacher@school-a.test", role: "supervisor" } })).json();
    // A different, signed-in account cannot use the link.
    const other = await signup(t.app, "intruder@else.test", "family");
    const bad = await t.app.inject({ method: "POST", url: "/v1/invitations/accept", headers: auth(other.token), payload: { token: inv.token } });
    expect(bad.statusCode).toBe(403);
    const ok = await t.app.inject({ method: "POST", url: "/v1/invitations/accept", payload: { token: inv.token, password: "a long teacher password", displayName: "Ms T" } });
    expect(ok.statusCode).toBe(200);
    supToken = ok.json().token;
    // Single use.
    const again = await t.app.inject({ method: "POST", url: "/v1/invitations/accept", payload: { token: inv.token, password: "a long teacher password", displayName: "Ms T" } });
    expect(again.statusCode).toBe(400);
    supUserId = (await t.app.inject({ method: "GET", url: "/v1/me", headers: auth(supToken) })).json().user.id;
  });

  it("supervisors see only assigned students and cannot manage the org", async () => {
    s1 = (await t.app.inject({ method: "POST", url: `/v1/orgs/${a.orgId}/students`, headers: auth(a.token), payload: { displayName: "Ama", ageBand: "under_13" } })).json().id;
    s2 = (await t.app.inject({ method: "POST", url: `/v1/orgs/${a.orgId}/students`, headers: auth(a.token), payload: { displayName: "Yaw", ageBand: "16_17" } })).json().id;
    await t.app.inject({ method: "PUT", url: `/v1/orgs/${a.orgId}/members/${supUserId}/assignments`, headers: auth(a.token), payload: { studentIds: [s1] } });

    const list = (await t.app.inject({ method: "GET", url: `/v1/orgs/${a.orgId}/students`, headers: auth(supToken) })).json();
    expect(list.students.map((s: any) => s.id)).toEqual([s1]);
    expect((await t.app.inject({ method: "GET", url: `/v1/orgs/${a.orgId}/students/${s2}/activity`, headers: auth(supToken) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/v1/orgs/${a.orgId}/students/${s1}/activity`, headers: auth(supToken) })).statusCode).toBe(200);

    expect((await t.app.inject({ method: "GET", url: `/v1/orgs/${a.orgId}/members`, headers: auth(supToken) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "GET", url: `/v1/orgs/${a.orgId}/audit`, headers: auth(supToken) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "POST", url: `/v1/orgs/${a.orgId}/billing/checkout`, headers: auth(supToken) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/orgs/${a.orgId}/students/${s1}`, headers: auth(supToken) })).statusCode).toBe(403);
  });

  it("audits activity views, with the viewer recorded", async () => {
    const log = (await t.app.inject({ method: "GET", url: `/v1/orgs/${a.orgId}/audit`, headers: auth(a.token) })).json();
    const view = log.entries.find((e: any) => e.action === "activity.viewed" && e.actor_id === supUserId);
    expect(view?.target_id).toBe(s1);
  });

  it("cannot remove the last org admin", async () => {
    const me = (await t.app.inject({ method: "GET", url: "/v1/me", headers: auth(a.token) })).json();
    expect((await t.app.inject({ method: "DELETE", url: `/v1/orgs/${a.orgId}/members/${me.user.id}`, headers: auth(a.token) })).statusCode).toBe(409);
  });
});
