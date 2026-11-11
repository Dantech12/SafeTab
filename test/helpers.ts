import { createHmac } from "node:crypto";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { closePool } from "../src/db/pool.js";
import { FakeMdmProvider } from "../src/mdm/fake.js";
import type { PaystackClient, PaystackTransaction } from "../src/billing/paystack.js";

export const OWNER_URL = process.env.DATABASE_OWNER_URL!;

export async function resetDb() {
  await closePool();
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();
  await migrate(OWNER_URL);
}

export class FakePaystack implements PaystackClient {
  transactions = new Map<string, PaystackTransaction>();
  initialized: any[] = [];
  disabled: string[] = [];
  async initialize(body: any) {
    this.initialized.push(body);
    return { authorization_url: `https://checkout.paystack.test/${body.reference}`, access_code: "ac_test", reference: body.reference };
  }
  async verify(reference: string) {
    const t = this.transactions.get(reference);
    if (!t) throw new Error("not found");
    return t;
  }
  async disableSubscription(code: string) {
    this.disabled.push(code);
  }
}

export interface TestCtx {
  app: FastifyInstance;
  mdm: FakeMdmProvider;
  paystack: FakePaystack;
  clock: { now: Date };
}

export const PUBSUB_TEST_TOKEN = "Bearer test-pubsub-token";

export async function makeApp(): Promise<TestCtx> {
  const mdm = new FakeMdmProvider();
  const paystack = new FakePaystack();
  const clock = { now: new Date() };
  const app = await buildApp({
    mdm,
    paystack,
    verifyPubSubPush: async (h) => h === PUBSUB_TEST_TOKEN,
    now: () => clock.now,
  });
  return { app, mdm, paystack, clock };
}

export async function signup(app: FastifyInstance, email: string, kind: "family" | "school" = "school") {
  const res = await app.inject({
    method: "POST", url: "/v1/auth/signup",
    payload: { email, password: "correct horse battery staple", displayName: email.split("@")[0], account: { kind, name: `${email} org` } },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  const body = res.json();
  return { token: body.token as string, orgId: body.orgId as string, userId: body.userId as string };
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export function paystackSign(raw: string) {
  return createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!).update(raw).digest("hex");
}

/** Activates billing directly as the owner (for tests that are not about billing). */
export async function activateSubscription(orgId: string, until = new Date(Date.now() + 30 * 86400_000)) {
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  await c.query("UPDATE subscriptions SET status = 'active', current_period_end = $2 WHERE org_id = $1", [orgId, until]);
  await c.end();
}

export async function ownerQuery(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

export function pubsubPush(notificationType: string, device: Record<string, unknown>, messageId: string) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(device)).toString("base64"),
      attributes: { notificationType },
      messageId,
    },
    subscription: "projects/test/subscriptions/amapi",
  };
}
