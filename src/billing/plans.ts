import type { Plan } from "./entitlements.js";
import { PaystackRejectedError, type PaystackClient, type PaystackPlan } from "./paystack.js";

const DISPLAY: Record<Plan, string> = { individual: "Individual", organization: "Organization" };

export function planName(plan: Plan, amount: number, currency: string): string {
  return `SafeTab ${DISPLAY[plan]} (${currency} ${(amount / 100).toFixed(amount % 100 ? 2 : 0)})`;
}

const matches = (p: PaystackPlan, amount: number, currency: string) =>
  Number(p.amount) === amount && String(p.currency).toUpperCase() === currency && String(p.interval).toLowerCase() === "monthly";

const cache = new Map<string, Promise<string>>();

/** For tests only. */
export function clearPlanCache() {
  cache.clear();
}

/**
 * Returns a Paystack plan code that charges exactly `amount` `currency` monthly.
 *  1. The code configured in .env, if Paystack confirms it matches.
 *  2. Otherwise an existing SafeTab plan with the expected name, amount and currency.
 *  3. Otherwise a new plan is created through Paystack's API.
 * Results are cached per process; concurrent callers share one lookup, so plans are
 * never created twice.
 */
export function resolvePlanCode(
  paystack: PaystackClient,
  opts: { plan: Plan; amount: number; currency: string; configuredCode?: string },
  log: (msg: string) => void = () => {},
): Promise<string> {
  const key = `${opts.plan}:${opts.currency}:${opts.amount}:${opts.configuredCode ?? ""}`;
  let p = cache.get(key);
  if (!p) {
    p = lookup(paystack, opts, log);
    cache.set(key, p);
    p.catch(() => cache.delete(key)); // retry next time after a failure
  }
  return p;
}

async function lookup(
  paystack: PaystackClient,
  { plan, amount, currency, configuredCode }: { plan: Plan; amount: number; currency: string; configuredCode?: string },
  log: (msg: string) => void,
): Promise<string> {
  const code = (configuredCode ?? "").trim();
  if (code && !/REPLACE_ME/.test(code)) {
    try {
      const configured = await paystack.fetchPlan(code);
      if (matches(configured, amount, currency)) return configured.plan_code;
      log(`configured Paystack plan ${code} is ${configured.currency} ${configured.amount / 100}/${configured.interval}, expected ${currency} ${amount / 100}/monthly; using a matching plan instead`);
    } catch (e) {
      if (!(e instanceof PaystackRejectedError)) throw e;
      log(`configured Paystack plan ${code} was not found; using a matching plan instead`);
    }
  }
  const name = planName(plan, amount, currency);
  const existing = (await paystack.listPlans()).find((p) => p.name === name && matches(p, amount, currency));
  if (existing) return existing.plan_code;
  const created = await paystack.createPlan({
    name, amount, currency, interval: "monthly",
    description: `SafeTab ${DISPLAY[plan]} plan, billed monthly. Cancel any time.`,
  });
  log(`created Paystack plan ${created.plan_code} (${name})`);
  return created.plan_code;
}
