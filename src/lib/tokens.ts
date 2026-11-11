import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/** High-entropy opaque token for sessions, invitations and device credentials. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Short human-typeable code (e.g. for support), 10 chars from an unambiguous alphabet
 * (~50 bits). Always paired with expiry + rate limiting.
 */
export function newShortCode(len = 10): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = randomBytes(len);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

/** Only the HMAC of a token is stored, so a DB leak does not leak usable tokens. */
export function hashToken(token: string): string {
  return createHmac("sha256", config().TOKEN_PEPPER).update(token).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
