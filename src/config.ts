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
  // Keep false until the companion app is published in managed Google Play: a
  // force-installed app that does not exist leaves the device non-compliant.
  COMPANION_APP_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // "poll": the worker asks AMAPI for device status (no Pub/Sub, no billing needed).
  // "pubsub": Google pushes notifications to /webhooks/amapi.
  // Static https page Google redirects to during signup when PUBLIC_BASE_URL is not https.
  // The page content does not matter: the admin copies the address (which carries
  // ?enterpriseToken=...) from the browser bar. Default: Google's AMAPI quickstart page.
  ANDROID_MANUAL_CALLBACK_URL: z.string().url().startsWith("https://")
    .default("https://storage.googleapis.com/android-management-quick-start/enterprise_signup_callback.html"),
  DEVICE_STATUS_MODE: z.enum(["poll", "pubsub"]).default("poll"),
  // Run scheduled jobs inside the API process (local pilot). Set false when running
  // `npm run worker` separately (production).
  EMBED_SCHEDULER: z.enum(["true", "false"]).optional().transform((v) => v === undefined ? undefined : v === "true"),
  DEVICE_POLL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
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
    if (parsed.data.MDM_PROVIDER === "amapi" && !parsed.data.GOOGLE_CLOUD_PROJECT_ID) {
      throw new Error("Invalid configuration for: GOOGLE_CLOUD_PROJECT_ID (required when MDM_PROVIDER=amapi)");
    }
    parsed.data.EMBED_SCHEDULER ??= parsed.data.NODE_ENV !== "production";
    cached = parsed.data;
  }
  return cached;
}
