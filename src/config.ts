import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  DATABASE_OWNER_URL: z.string().min(1).optional(),
  TOKEN_PEPPER: z.string().min(32, "TOKEN_PEPPER must be >= 32 chars of random data"),

  PAYSTACK_SECRET_KEY: z.string().min(1),
  PAYSTACK_BASE_URL: z.string().url().default("https://api.paystack.co"),
  BILLING_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  PLAN_INDIVIDUAL_AMOUNT: z.coerce.number().int().positive().default(500),
  PLAN_ORGANIZATION_AMOUNT: z.coerce.number().int().positive().default(3000),
  PAYSTACK_PLAN_INDIVIDUAL: z.string().min(1),
  PAYSTACK_PLAN_ORGANIZATION: z.string().min(1),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(7),

  MDM_PROVIDER: z.enum(["fake", "amapi"]).default("fake"),
  GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
  PUBSUB_PUSH_AUDIENCE: z.string().optional(),
  PUBSUB_PUSH_SERVICE_ACCOUNT: z.string().optional(),
  COMPANION_APP_PACKAGE: z.string().default("org.example.safetab.student"),
  DEFAULT_USAGE_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
});

export type Config = z.infer<typeof Env>;

let cached: Config | undefined;
export function config(): Config {
  if (!cached) {
    const parsed = Env.safeParse(process.env);
    if (!parsed.success) {
      // Print variable names only, never values.
      const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid configuration for: ${names}`);
    }
    if (parsed.data.NODE_ENV === "production" && parsed.data.PAYSTACK_SECRET_KEY.startsWith("sk_test_")) {
      console.warn("WARNING: production is running with a Paystack test key");
    }
    cached = parsed.data;
  }
  return cached;
}
