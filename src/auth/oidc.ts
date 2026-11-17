import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { config } from "../config.js";

/**
 * "Sign in with Google / Microsoft" using OpenID Connect (authorization code + PKCE).
 * The ID token is verified against the provider's published keys (signature, issuer,
 * audience, expiry) and the nonce we sent. Nothing from the browser is trusted.
 */
export type ProviderId = "google" | "microsoft";

interface ProviderDef {
  id: ProviderId;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  clientId: () => string;
  clientSecret: () => string;
  /** Validates the issuer claim (Microsoft's is tenant-specific). */
  issuerOk: (payload: JWTPayload) => boolean;
  /** Whether the provider vouches that the user controls this email address. */
  emailVerified: (payload: JWTPayload) => boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  google: {
    id: "google",
    name: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    clientId: () => config().GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: () => config().GOOGLE_OAUTH_CLIENT_SECRET,
    issuerOk: (p) => p.iss === "https://accounts.google.com" || p.iss === "accounts.google.com",
    emailVerified: (p) => p.email_verified === true || p.email_verified === "true",
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    // "common": personal Microsoft accounts and work/school accounts.
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    jwksUrl: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    clientId: () => config().MICROSOFT_OAUTH_CLIENT_ID,
    clientSecret: () => config().MICROSOFT_OAUTH_CLIENT_SECRET,
    issuerOk: (p) => typeof p.tid === "string" && p.iss === `https://login.microsoftonline.com/${p.tid}/v2.0`,
    // Microsoft's email claim is not guaranteed to be verified; never use it to link
    // to an existing account.
    emailVerified: () => false,
  },
};

export function enabledProviders(): { id: ProviderId; name: string }[] {
  return (Object.values(PROVIDERS) as ProviderDef[])
    .filter((p) => p.clientId() && p.clientSecret())
    .map((p) => ({ id: p.id, name: p.name }));
}

export function isProvider(x: string): x is ProviderId {
  return x === "google" || x === "microsoft";
}

export const redirectUri = (p: ProviderId) => `${config().PUBLIC_BASE_URL}/auth/${p}/callback`;

const b64url = (b: Buffer) => b.toString("base64url");
export const randomToken = (bytes = 32) => b64url(randomBytes(bytes));
export const pkceChallenge = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());

export function authorizeUrl(p: ProviderId, state: string, nonce: string, verifier: string): string {
  const def = PROVIDERS[p];
  const u = new URL(def.authorizeUrl);
  u.search = new URLSearchParams({
    client_id: def.clientId(),
    redirect_uri: redirectUri(p),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return u.toString();
}

export interface OidcDeps {
  fetchImpl?: typeof fetch;
  /** Override key lookup (tests). */
  keys?: Partial<Record<ProviderId, JWTVerifyGetKey>>;
}

const jwksCache = new Map<ProviderId, JWTVerifyGetKey>();
function keysFor(p: ProviderId, deps: OidcDeps): JWTVerifyGetKey {
  const override = deps.keys?.[p];
  if (override) return override;
  let k = jwksCache.get(p);
  if (!k) {
    k = createRemoteJWKSet(new URL(PROVIDERS[p].jwksUrl));
    jwksCache.set(p, k);
  }
  return k;
}

export interface VerifiedIdentity {
  provider: ProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export class OidcError extends Error {}

/** Exchanges the authorization code and returns the verified identity. */
export async function completeSignIn(p: ProviderId, code: string, verifier: string, nonce: string, deps: OidcDeps = {}): Promise<VerifiedIdentity> {
  const def = PROVIDERS[p];
  const res = await (deps.fetchImpl ?? fetch)(def.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(p),
      client_id: def.clientId(),
      client_secret: def.clientSecret(),
      code_verifier: verifier,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !json.id_token) throw new OidcError(`token exchange failed: ${json.error ?? res.status}`);

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(json.id_token, keysFor(p, deps), { audience: def.clientId(), clockTolerance: 60 }));
  } catch (e) {
    // Bad signature, wrong audience, expired, malformed: the token is not acceptable.
    // (Failures to reach the provider's key endpoint are reported as unavailable.)
    if (e instanceof joseErrors.JWKSTimeout) throw e;
    if (e instanceof joseErrors.JOSEError) throw new OidcError(`id token rejected: ${e.code}`);
    throw e;
  }
  if (!def.issuerOk(payload)) throw new OidcError("unexpected issuer");
  if (payload.nonce !== nonce) throw new OidcError("nonce mismatch");
  if (typeof payload.sub !== "string" || !payload.sub) throw new OidcError("missing subject");

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
  return {
    provider: p,
    subject: payload.sub,
    email,
    emailVerified: !!email && def.emailVerified(payload),
    name: typeof payload.name === "string" ? payload.name.slice(0, 120) : null,
  };
}
