import { config } from "../config.js";
import { q, withTenant } from "../db/pool.js";
import { layout, type Mailer } from "../lib/mailer.js";
import { planPricing } from "../billing/service.js";
import type { Plan } from "../billing/entitlements.js";

/** How long before the paid month ends the reminder goes out. */
export const REMINDER_DAYS = 3;

const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtMoney = (amount: number, currency: string) => {
  try { return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(amount / 100); }
  catch { return `${currency} ${(amount / 100).toFixed(2)}`; }
};

/**
 * Emails a workspace's admins once, about 3 days before a plan that won't renew by itself
 * (Mobile Money, or a card subscription set not to renew) runs out. Run hourly.
 * Returns how many workspaces were reminded.
 */
export async function runRenewalReminders(mailer: Mailer, now: Date, log: (m: string) => void = console.log): Promise<number> {
  const soon = new Date(now.getTime() + REMINDER_DAYS * 86400_000);
  let reminded = 0;
  const orgs = await q<{ id: string }>("SELECT list_org_ids() AS id");
  for (const { id: orgId } of orgs.rows) {
    const due = await withTenant(orgId, async (tx) => {
      const sub = (await tx.query(
        `SELECT s.plan, s.current_period_end, o.name FROM subscriptions s JOIN organizations o ON o.id = s.org_id
         WHERE s.status = 'non_renewing' AND s.current_period_end > $1 AND s.current_period_end <= $2
           AND s.renewal_reminder_for IS DISTINCT FROM s.current_period_end`, [now, soon])).rows[0];
      if (!sub) return null;
      const admins = (await tx.query(
        "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'org_admin'")).rows.map((r) => r.email as string);
      return { ...sub, admins };
    });
    if (!due || !due.admins.length) continue;

    const end = new Date(due.current_period_end);
    const price = planPricing(due.plan as Plan);
    const planName = due.plan === "organization" ? "Organization" : "Individual";
    const { html, text } = layout({
      title: `Your SafeTab plan ends on ${fmtDay(end)}`,
      intro: `Your ${planName} plan for “${due.name}” is paid until ${fmtDay(end)}. To keep adding tablets and changing rules, pay ${fmtMoney(price.amount, price.currency)} for another month with Mobile Money or card. Any days you have left are kept.`,
      button: { label: "Pay for another month", url: `${config().PUBLIC_BASE_URL}/app#/billing` },
      outro: "If you don't pay, your workspace becomes read-only: rules already on tablets stay as they are, and your data is kept. You can pay again at any time to continue.",
    });
    let sent = 0;
    for (const to of due.admins) {
      try {
        await mailer.send({ to, subject: `Your SafeTab plan ends on ${fmtDay(end)}`, html, text });
        sent++;
      } catch (e) {
        log(`renewal reminder to an admin of ${orgId} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!sent) continue; // nothing delivered: try again next run
    await withTenant(orgId, (tx) => tx.query("UPDATE subscriptions SET renewal_reminder_for = $1", [due.current_period_end]));
    reminded++;
  }
  return reminded;
}
