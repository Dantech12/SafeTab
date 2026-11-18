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
    email: string; amount: number; currency: string; reference: string;
    /** Set for card subscriptions. Omitted for one-off (Mobile Money) payments. */
    plan?: string;
    /** Payment methods Paystack offers in its window, e.g. ["mobile_money"]. */
    channels?: string[];
    callback_url: string; metadata: Record<string, unknown>;
  }): Promise<{ authorization_url: string; access_code: string; reference: string }>;
  verify(reference: string): Promise<PaystackTransaction>;
  disableSubscription(code: string, emailToken: string): Promise<void>;
  fetchPlan(code: string): Promise<PaystackPlan>;
  /** Paystack-hosted page where the customer updates their card or cancels. */
  manageLink(subscriptionCode: string): Promise<string>;
  listPlans(): Promise<PaystackPlan[]>;
  createPlan(body: { name: string; amount: number; currency: string; interval: "monthly"; description?: string }): Promise<PaystackPlan>;
}

export interface PaystackPlan {
  plan_code: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
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

/** Paystack answered, but refused the request (bad key, unsupported currency, unknown plan...). */
export class PaystackRejectedError extends Error {
  constructor(public status: number, public paystackMessage: string) {
    super(`paystack rejected request: ${status} ${paystackMessage}`.trim());
  }
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
      throw new PaystackRejectedError(res.status, String(json.message ?? "").slice(0, 200));
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

  async manageLink(subscriptionCode: string) {
    const d = await this.call<{ link: string }>("GET", `/subscription/${encodeURIComponent(subscriptionCode)}/manage/link`);
    return d.link;
  }

  fetchPlan(code: string) {
    return this.call<PaystackPlan>("GET", `/plan/${encodeURIComponent(code)}`);
  }

  async listPlans() {
    const all: PaystackPlan[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await this.fetchImpl(`${this.baseUrl}/plan?perPage=100&page=${page}`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: PaystackPlan[]; meta?: { pageCount?: number } };
      if (!res.ok || json.status !== true) throw new PaystackRejectedError(res.status, String(json.message ?? "").slice(0, 200));
      all.push(...(json.data ?? []));
      if (!json.meta?.pageCount || page >= json.meta.pageCount) break;
    }
    return all;
  }

  createPlan(body: { name: string; amount: number; currency: string; interval: "monthly"; description?: string }) {
    return this.call<PaystackPlan>("POST", "/plan", body);
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
