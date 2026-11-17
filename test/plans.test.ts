import { beforeEach, describe, expect, it } from "vitest";
import { FakePaystack } from "./helpers.js";
import { clearPlanCache, planName, resolvePlanCode } from "../src/billing/plans.js";

let ps: FakePaystack;
beforeEach(() => {
  ps = new FakePaystack();
  clearPlanCache();
});

describe("Paystack plan resolution", () => {
  it("uses the configured plan when Paystack confirms it matches the price", async () => {
    expect(await resolvePlanCode(ps, { plan: "individual", amount: 500, currency: "USD", configuredCode: "PLN_test_individual" })).toBe("PLN_test_individual");
    expect(ps.plans).toHaveLength(2);
  });

  it("ignores an old plan in another currency and creates a matching GHS plan once", async () => {
    const logs: string[] = [];
    const opts = { plan: "organization" as const, amount: 24000, currency: "GHS", configuredCode: "PLN_test_organization" };
    const [a, b] = await Promise.all([resolvePlanCode(ps, opts, (m) => logs.push(m)), resolvePlanCode(ps, opts)]);
    expect(a).toBe(b);
    const created = ps.plans.find((p) => p.plan_code === a)!;
    expect(created).toMatchObject({ name: "SafeTab Organization (GHS 240)", amount: 24000, currency: "GHS", interval: "monthly" });
    expect(ps.plans).toHaveLength(3); // created exactly once
    expect(logs.join(" ")).toMatch(/expected GHS 240\/monthly/);
  });

  it("reuses a SafeTab plan already in the Paystack account (e.g. after a restart)", async () => {
    ps.plans.push({ plan_code: "PLN_existing", name: planName("individual", 6000, "GHS"), amount: 6000, currency: "GHS", interval: "monthly" });
    expect(await resolvePlanCode(ps, { plan: "individual", amount: 6000, currency: "GHS", configuredCode: "" })).toBe("PLN_existing");
    expect(ps.plans).toHaveLength(3);
  });

  it("treats an unknown or placeholder configured code as empty", async () => {
    const code = await resolvePlanCode(ps, { plan: "individual", amount: 6000, currency: "GHS", configuredCode: "PLN_does_not_exist" });
    expect(code).toMatch(/^PLN_created_/);
    clearPlanCache();
    const again = await resolvePlanCode(ps, { plan: "individual", amount: 6000, currency: "GHS", configuredCode: "PLN_REPLACE_ME" });
    expect(again).toBe(code); // found by name, not created twice
  });
});
