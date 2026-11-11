import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal Paystack REST client. Endpoints used (verify against https://paystack.com/docs/api/):
 *   POST /transaction/initialize      start checkout (with `plan` => subscription created on success)
 *   GET  /transaction/verify/:ref     authoritative server-side verification
 *   POST /subscription/disable        cancel (requires subscription code + email token)
 * The secret key is only ever used server-side.
 */
export interface PaystackClient {
  initialize(body: {
    email: string; amount: number; currency: string; plan: string; reference: string;
    callback_url: string; metadata: Record<string, unknown>;
  }): Promise<{ authorization_url: string; access_code: string; reference: string }>;
  verify(reference: string): Promise<PaystackTransaction>;
  disableSubscription(code: string, emailToken: string): Promise<void>;
}

export interface PaystackTransaction {
  status: string; // "success" | "failed" | "abandoned" | ...
  reference: string;
  amount: number;
  currency: string;
  metadata?: any;
  customer?: { customer_code?: string; email?: string };
  plan?: unknown;
}

export class HttpPaystackClient implements PaystackClient {
  constructor(private secretKey: string, private baseUrl: string, private fetchImpl: typeof fetch = fetch) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
    if (!res.ok || json.status !== true) {
      throw new Error(`paystack ${path} failed: ${res.status} ${json.message ?? ""}`.trim());
    }
    return json.data as T;
  }

  initialize(body: Parameters<PaystackClient["initialize"]>[0]) {
    return this.call<{ authorization_url: string; access_code: string; reference: string }>("POST", "/transaction/initialize", body);
  }

  verify(reference: string) {
    return this.call<PaystackTransaction>("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  }

  async disableSubscription(code: string, emailToken: string) {
    await this.call("POST", "/subscription/disable", { code, token: emailToken });
  }
}

/**
 * Paystack signs webhooks with HMAC-SHA512 of the raw request body using the secret key,
 * sent in the `x-paystack-signature` header. Must be computed over the exact raw bytes.
 */
export function verifyPaystackSignature(rawBody: Buffer, signature: string | undefined, secretKey: string): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
