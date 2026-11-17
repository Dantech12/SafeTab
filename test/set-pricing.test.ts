import { describe, expect, it } from "vitest";
import { pricingValues, updateEnv } from "../scripts/set-pricing.js";

describe("set-pricing", () => {
  const before = [
    "PAYSTACK_SECRET_KEY=sk_test_keepme",
    "BILLING_CURRENCY=USD",
    "PLAN_INDIVIDUAL_AMOUNT=500",
    "PLAN_ORGANIZATION_AMOUNT=3000",
    "PAYSTACK_PLAN_INDIVIDUAL=PLN_old_usd",
    "# a comment",
    "",
  ].join("\r\n");

  it("updates only the pricing lines, keeps the secret key, comments and Windows line endings", () => {
    const after = updateEnv(before, pricingValues("GHS", 60, 240));
    expect(after).toContain("PAYSTACK_SECRET_KEY=sk_test_keepme\r\n");
    expect(after).toContain("BILLING_CURRENCY=GHS\r\n");
    expect(after).toContain("PLAN_INDIVIDUAL_AMOUNT=6000\r\n");
    expect(after).toContain("PLAN_ORGANIZATION_AMOUNT=24000\r\n");
    expect(after).toContain("PAYSTACK_PLAN_INDIVIDUAL=\r\n");
    expect(after).toContain("PAYSTACK_PLAN_ORGANIZATION=\r\n"); // was missing: appended
    expect(after).toContain("# a comment");
    expect(after.match(/BILLING_CURRENCY=/g)).toHaveLength(1);
  });

  it("rejects bad input", () => {
    expect(() => pricingValues("cedis", 60, 240)).toThrow(/3-letter/);
    expect(() => pricingValues("GHS", -1, 240)).toThrow(/positive/);
  });
});
