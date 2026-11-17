/**
 * Updates prices in .env without touching anything else (your Paystack key stays as is).
 *
 *   npm run set-pricing                 -> GHS, 60 Individual, 240 Organization
 *   npm run set-pricing -- GHS 60 240   -> currency, Individual price, Organization price
 *
 * Plan codes are cleared so SafeTab finds or creates matching Paystack plans itself.
 * A backup of the old file is written next to it first. Restart SafeTab afterwards.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function updateEnv(text: string, values: Record<string, string>): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (m && m[1]! in values) {
      seen.add(m[1]!);
      return `${m[1]}=${values[m[1]!]}`;
    }
    return line;
  });
  const missing = Object.keys(values).filter((k) => !seen.has(k));
  if (missing.length) {
    if (out.length && out[out.length - 1] === "") out.pop();
    out.push("", "# Pricing (set by `npm run set-pricing`)", ...missing.map((k) => `${k}=${values[k]}`), "");
  }
  return out.join(eol);
}

export function pricingValues(currency: string, individual: number, organization: number): Record<string, string> {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Currency must be a 3-letter code like GHS, got "${currency}"`);
  for (const [name, v] of [["Individual", individual], ["Organization", organization]] as const) {
    if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} price must be a positive number`);
  }
  return {
    BILLING_CURRENCY: currency,
    PLAN_INDIVIDUAL_AMOUNT: String(Math.round(individual * 100)),
    PLAN_ORGANIZATION_AMOUNT: String(Math.round(organization * 100)),
    PAYSTACK_PLAN_INDIVIDUAL: "",
    PAYSTACK_PLAN_ORGANIZATION: "",
  };
}

function main() {
  const [currency = "GHS", ind = "60", org = "240"] = process.argv.slice(2);
  const values = pricingValues(currency.toUpperCase(), Number(ind), Number(org));
  const file = path.resolve(".env");
  if (!existsSync(file)) throw new Error("No .env file found here. Run this inside your SafeTab folder.");
  const before = readFileSync(file, "utf8");
  const backup = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(file, backup);
  writeFileSync(file, updateEnv(before, values));
  console.log(`Prices updated in .env (backup: ${path.basename(backup)}):`);
  console.log(`  Currency:      ${values.BILLING_CURRENCY}`);
  console.log(`  Individual:    ${ind} per month`);
  console.log(`  Organization:  ${org} per month`);
  console.log("  Paystack plans: SafeTab will find or create matching plans automatically.");
  console.log("\nNow restart SafeTab:  npm.cmd run dev   (Windows)  or  npm run dev");
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith("set-pricing")) {
  try {
    main();
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
