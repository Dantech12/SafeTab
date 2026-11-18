import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { auth, makeApp, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";

let t: TestCtx;
let privateKey: CryptoKey;
let jwk: JWK;
// What the fake token endpoint will put in the next ID token (set per test).
let nextClaims: Record<string, unknown> = {};
let tokenEndpointCalls: URLSearchParams[] = [];

async function idToken(claims: Record<string, unknown>) {
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuedAt().setExpirationTime("5m").sign(privateKey);
}

beforeAll(async () => {
  await resetDb();
  const kp = await generateKeyPair("RS256", { extractable: true });
  privateKey = kp.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  t = await makeApp({
    oidc: {
      keys: { google: keys, microsoft: keys },
      fetchImpl: (async (_url: string, init: RequestInit) => {
        tokenEndpointCalls.push(new URLSearchParams(String(init.body)));
        return new Response(JSON.stringify({ id_token: await idToken(nextClaims) }), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    },
  });
});

afterAll(async () => {
  await t.app.close();
  await closePool();
});

/** Runs start -> provider -> callback and returns the callback redirect and the state/nonce used. */
async function signIn(provider: "google" | "microsoft", claims: (nonce: string) => Record<string, unknown>, next?: string) {
  const start = await t.app.inject({ method: "GET", url: `/auth/${provider}/start${next ? `?next=${encodeURIComponent(next)}` : ""}` });
  expect(start.statusCode).toBe(302);
  const authz = new URL(String(start.headers.location));
  const state = authz.searchParams.get("state")!;
  const nonce = authz.searchParams.get("nonce")!;
  nextClaims = claims(nonce);
  const cb = await t.app.inject({ method: "GET", url: `/auth/${provider}/callback?code=provider-code&state=${encodeURIComponent(state)}` });
  return { location: String(cb.headers.location), state, authz };
}
const google = (extra: Record<string, unknown>) => (nonce: string) => ({ iss: "https://accounts.google.com", aud: "test-google-client", nonce, ...extra });
const loginCode = (location: string) => /#\/oauth\/(.+)$/.exec(location)?.[1];

describe("Sign in with Google / Microsoft", () => {
  it("lists only configured providers", async () => {
    const r = (await t.app.inject({ method: "GET", url: "/v1/public/auth-providers" })).json();
    expect(r.providers.map((p: any) => p.id)).toEqual(["google", "microsoft"]);
  });

  it("starts with state, nonce and PKCE, and exchanges the code with the verifier", async () => {
    tokenEndpointCalls = [];
    const { location, authz } = await signIn("google", google({ sub: "g-1", email: "Ama@Example.test", email_verified: true, name: "Ama Owusu" }), "#/subscribe/school");
    expect(authz.origin).toBe("https://accounts.google.com");
    expect(authz.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authz.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/google/callback");
    expect(tokenEndpointCalls[0]!.get("code_verifier")).toBeTruthy();
    const code = loginCode(location)!;
    const ex = await t.app.inject({ method: "POST", url: "/v1/auth/oauth/exchange", payload: { code } });
    expect(ex.statusCode).toBe(200);
    expect(ex.json()).toMatchObject({ next: "#/subscribe/school", orgs: [], providerName: "Google" });
    // New user: no workspace yet -> they create one.
    const token = ex.json().token;
    const org = await t.app.inject({ method: "POST", url: "/v1/orgs", headers: auth(token), payload: { kind: "school", name: "Brightfield Academy" } });
    expect(org.statusCode).toBe(201);
    const me = (await t.app.inject({ method: "GET", url: "/v1/me", headers: auth(token) })).json();
    expect(me.user.email).toBe("ama@example.test");
    expect(me.orgs[0].org_name).toBe("Brightfield Academy");
    // One-time code can't be reused.
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/oauth/exchange", payload: { code } })).json().error).toBe("oauth_code_expired");
  });

  it("the same Google account signs in to the same user, and has no password", async () => {
    const { location } = await signIn("google", google({ sub: "g-1", email: "ama@example.test", email_verified: true }));
    const ex = (await t.app.inject({ method: "POST", url: "/v1/auth/oauth/exchange", payload: { code: loginCode(location) } })).json();
    expect(ex.orgs).toHaveLength(1);
    const pw = await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "ama@example.test", password: "anything at all here" } });
    expect(pw.json().error).toBe("use_provider_sign_in");
  });

  it("rejects a replayed state, a wrong nonce, and a token for another app", async () => {
    const first = await signIn("google", google({ sub: "g-2", email: "x@example.test", email_verified: true }));
    const replay = await t.app.inject({ method: "GET", url: `/auth/google/callback?code=c&state=${encodeURIComponent(first.state)}` });
    expect(replay.headers.location).toBe("/app#/oauth-error/expired");

    const badNonce = await signIn("google", () => ({ iss: "https://accounts.google.com", aud: "test-google-client", nonce: "not-the-one", sub: "g-3", email: "y@example.test", email_verified: true }));
    expect(badNonce.location).toBe("/app#/oauth-error/invalid");

    const badAud = await signIn("google", (nonce) => ({ iss: "https://accounts.google.com", aud: "someone-elses-app", nonce, sub: "g-4", email: "z@example.test", email_verified: true }));
    expect(badAud.location).toBe("/app#/oauth-error/invalid");

    const badIss = await signIn("google", (nonce) => ({ iss: "https://evil.test", aud: "test-google-client", nonce, sub: "g-5", email: "w@example.test", email_verified: true }));
    expect(badIss.location).toBe("/app#/oauth-error/invalid");
  });

  it("links Google to an existing password account only when Google verified the email", async () => {
    const pwUser = await signup(t.app, "kofi@example.test");
    const unverified = await signIn("google", google({ sub: "g-6", email: "kofi@example.test", email_verified: false }));
    expect(unverified.location).toBe("/app#/oauth-error/email_in_use");
    const verified = await signIn("google", google({ sub: "g-6", email: "kofi@example.test", email_verified: true }));
    const ex = (await t.app.inject({ method: "POST", url: "/v1/auth/oauth/exchange", payload: { code: loginCode(verified.location) } })).json();
    expect(ex.orgs[0].org_id).toBe(pwUser.orgId);
  });

  it("never links Microsoft sign-in to an existing account by email (its email isn't verified)", async () => {
    const ms = (tid: string, extra: Record<string, unknown>) => (nonce: string) => ({ iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, aud: "test-ms-client", nonce, ...extra });
    const taken = await signIn("microsoft", ms("t1", { sub: "m-1", email: "kofi@example.test" }));
    expect(taken.location).toBe("/app#/oauth-error/email_in_use");
    const fresh = await signIn("microsoft", ms("t1", { sub: "m-2", email: "esi@school.test" }));
    expect(loginCode(fresh.location)).toBeTruthy();
    const wrongTenantIssuer = await signIn("microsoft", (nonce) => ({ iss: "https://login.microsoftonline.com/other/v2.0", tid: "t1", aud: "test-ms-client", nonce, sub: "m-3", email: "a@b.test" }));
    expect(wrongTenantIssuer.location).toBe("/app#/oauth-error/invalid");
  });

  it("ignores unsafe 'next' values and handles a cancelled sign-in", async () => {
    const { location } = await signIn("google", google({ sub: "g-7", email: "n@example.test", email_verified: true }), "https://evil.test/steal");
    const ex = (await t.app.inject({ method: "POST", url: "/v1/auth/oauth/exchange", payload: { code: loginCode(location) } })).json();
    expect(ex.next).toBeNull();
    const cancelled = await t.app.inject({ method: "GET", url: "/auth/google/callback?error=access_denied&state=x" });
    expect(cancelled.headers.location).toBe("/app#/oauth-error/cancelled");
  });

  it("limits how many workspaces one person can create", async () => {
    const { location } = await signIn("google", google({ sub: "g-8", email: "many@example.test", email_verified: true }));
    const token = (await t.app.inject({ method: "POST", url: "/v1/auth/oauth/exchange", payload: { code: loginCode(location) } })).json().token;
    for (let i = 0; i < 5; i++) expect((await t.app.inject({ method: "POST", url: "/v1/orgs", headers: auth(token), payload: { kind: "family", name: `F${i}` } })).statusCode).toBe(201);
    expect((await t.app.inject({ method: "POST", url: "/v1/orgs", headers: auth(token), payload: { kind: "family", name: "F6" } })).json().error).toBe("workspace_limit_reached");
  });
});
