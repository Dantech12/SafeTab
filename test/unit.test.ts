import { describe, expect, it } from "vitest";
import { isInDowntime, parsePolicySpec } from "../src/policy/spec.js";
import { compilePolicy } from "../src/policy/compile.js";
import { accessLevel, effectiveStatus } from "../src/billing/entitlements.js";
import { verifyPaystackSignature } from "../src/billing/paystack.js";
import { paystackSign } from "./helpers.js";

describe("policy spec", () => {
  it("applies safe defaults (everything off, usage summaries off)", () => {
    const s = parsePolicySpec({});
    expect(s.usageSummaries.enabled).toBe(false);
    expect(s.web.mode).toBe("off");
    expect(s.downtime.enabled).toBe(false);
  });

  it("rejects paths/URLs in web domains (domain-level only)", () => {
    expect(() => parsePolicySpec({ web: { mode: "blocklist", domains: ["example.com/path"] } })).toThrow();
    expect(parsePolicySpec({ web: { mode: "blocklist", domains: ["*.Example.com"] } }).web.domains).toEqual(["*.example.com"]);
  });

  it("rejects unknown time zones and bad package names", () => {
    expect(() => parsePolicySpec({ downtime: { enabled: true, timezone: "Mars/Base", windows: [] } })).toThrow();
    expect(() => parsePolicySpec({ apps: { mode: "blocklist", packages: ["not a package"] } })).toThrow();
  });

  it("evaluates overnight downtime windows in the configured time zone", () => {
    const spec = parsePolicySpec({
      downtime: { enabled: true, timezone: "Africa/Lagos", windows: [{ days: [1, 2, 3, 4, 5], start: "21:00", end: "06:30" }] },
    });
    // Africa/Lagos is UTC+1, no DST. 2026-11-09 is a Monday.
    expect(isInDowntime(spec, new Date("2026-11-09T20:30:00Z"))).toBe(true); // Mon 21:30
    expect(isInDowntime(spec, new Date("2026-11-10T05:00:00Z"))).toBe(true); // Tue 06:00 (from Mon window)
    expect(isInDowntime(spec, new Date("2026-11-10T06:00:00Z"))).toBe(false); // Tue 07:00
    expect(isInDowntime(spec, new Date("2026-11-08T20:30:00Z"))).toBe(false); // Sun 21:30 (Sun not listed)
    expect(isInDowntime(spec, new Date("2026-11-14T04:00:00Z"))).toBe(true); // Sat 05:00 (from Fri window)
  });
});

describe("policy compiler", () => {
  const base = { ownership: "school_owned" as const, inDowntime: false, companionPackage: "org.example.safetab.student", apiBaseUrl: "https://api.test" };

  it("always force-installs the transparency companion app and never blocks it", () => {
    const spec = parsePolicySpec({ apps: { mode: "blocklist", packages: ["org.example.safetab.student", "com.game.x"] } });
    const { policy } = compilePolicy({ ...base, spec });
    const apps = policy.applications as any[];
    expect(apps.find((a) => a.packageName === base.companionPackage).installType).toBe("FORCE_INSTALLED");
    expect(apps.filter((a) => a.packageName === base.companionPackage)).toHaveLength(1);
    expect(apps.find((a) => a.packageName === "com.game.x").installType).toBe("BLOCKED");
  });

  it("uses kiosk mode with the companion app during downtime", () => {
    const spec = parsePolicySpec({ downtime: { enabled: true, timezone: "UTC", windows: [{ days: [1], start: "20:00", end: "07:00" }] } });
    const { policy } = compilePolicy({ ...base, spec, inDowntime: true });
    expect((policy.applications as any[])[0].installType).toBe("KIOSK");
  });

  it("maps web filtering to Chrome managed configuration and flags the Chrome-only limitation", () => {
    const spec = parsePolicySpec({ web: { mode: "allowlist", domains: ["example.org"] } });
    const { policy, controls } = compilePolicy({ ...base, spec });
    const chrome = (policy.applications as any[]).find((a) => a.packageName === "com.android.chrome");
    expect(chrome.managedConfiguration).toEqual({ URLBlocklist: ["*"], URLAllowlist: ["example.org"] });
    expect(controls.find((c) => c.control === "web")?.note).toMatch(/Chrome only/);
  });

  it("puts the registration code only in managed configuration, and only when provided", () => {
    const spec = parsePolicySpec({});
    const withCode = compilePolicy({ ...base, spec, registrationCode: "abc" }).policy;
    const without = compilePolicy({ ...base, spec }).policy;
    expect((withCode.applications as any[])[0].managedConfiguration.registration_code).toBe("abc");
    expect((without.applications as any[])[0].managedConfiguration.registration_code).toBeUndefined();
  });
});

describe("entitlements", () => {
  const now = new Date("2026-11-11T00:00:00Z");
  const later = new Date("2026-11-20T00:00:00Z");
  const earlier = new Date("2026-11-01T00:00:00Z");

  it("never grants full access without a payment", () => {
    expect(accessLevel({ plan: "individual", status: "none", current_period_end: null, grace_until: null }, now)).toBe("read_only");
  });
  it("honours paid-for time after cancellation, then becomes read-only", () => {
    expect(accessLevel({ plan: "individual", status: "cancelled", current_period_end: later, grace_until: null }, now)).toBe("full");
    expect(accessLevel({ plan: "individual", status: "cancelled", current_period_end: earlier, grace_until: null }, now)).toBe("read_only");
  });
  it("gives a grace period on failed renewal", () => {
    expect(accessLevel({ plan: "organization", status: "past_due", current_period_end: earlier, grace_until: later }, now)).toBe("full");
    const lapsed = { plan: "organization" as const, status: "past_due" as const, current_period_end: earlier, grace_until: earlier };
    expect(accessLevel(lapsed, now)).toBe("read_only");
    expect(effectiveStatus(lapsed, now)).toBe("lapsed");
  });
});

describe("paystack signature", () => {
  const key = process.env.PAYSTACK_SECRET_KEY!;
  it("accepts a correct HMAC-SHA512 and rejects tampering", () => {
    const raw = JSON.stringify({ event: "charge.success", data: { reference: "x" } });
    expect(verifyPaystackSignature(Buffer.from(raw), paystackSign(raw), key)).toBe(true);
    expect(verifyPaystackSignature(Buffer.from(raw + " "), paystackSign(raw), key)).toBe(false);
    expect(verifyPaystackSignature(Buffer.from(raw), undefined, key)).toBe(false);
    expect(verifyPaystackSignature(Buffer.from(raw), "zz", key)).toBe(false);
  });
});
