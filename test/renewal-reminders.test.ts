import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, ownerQuery, resetDb, signup, type TestCtx } from "./helpers.js";
import { closePool } from "../src/db/pool.js";
import { MemoryMailer } from "../src/lib/mailer.js";
import { runRenewalReminders } from "../src/jobs/renewal-reminders.js";

let t: TestCtx;
beforeAll(async () => {
  await resetDb();
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
  await closePool();
});

const DAY = 86400_000;
const setSub = (orgId: string, status: string, endsInDays: number) =>
  ownerQuery("UPDATE subscriptions SET status = $2, current_period_end = $3 WHERE org_id = $1", [orgId, status, new Date(Date.now() + endsInDays * DAY)]);

describe("renewal reminder emails", () => {
  it("emails the admins once, 3 days before a Mobile Money month ends", async () => {
    const fam = await signup(t.app, "mum@remind.test", "family");
    await setSub(fam.orgId, "non_renewing", 2.5);
    const mailer = new MemoryMailer();
    expect(await runRenewalReminders(mailer, new Date(), () => {})).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe("mum@remind.test");
    expect(mailer.sent[0]!.subject).toMatch(/^Your SafeTab plan ends on /);
    expect(mailer.sent[0]!.text).toContain("/app#/billing");
    expect(mailer.sent[0]!.text).toContain("Mobile Money");

    // Not again for the same period...
    expect(await runRenewalReminders(mailer, new Date(), () => {})).toBe(0);
    expect(mailer.sent).toHaveLength(1);

    // ...but again once they've paid for another month and that one is ending.
    await setSub(fam.orgId, "non_renewing", 1);
    expect(await runRenewalReminders(mailer, new Date(), () => {})).toBe(1);
    expect(mailer.sent).toHaveLength(2);
  });

  it("doesn't email too early, after it has ended, or for plans that renew by themselves", async () => {
    const early = await signup(t.app, "early@remind.test", "family");
    const ended = await signup(t.app, "ended@remind.test", "family");
    const card = await signup(t.app, "card@remind.test", "school");
    await setSub(early.orgId, "non_renewing", 10);
    await setSub(ended.orgId, "non_renewing", -1);
    await setSub(card.orgId, "active", 2);
    const mailer = new MemoryMailer();
    await runRenewalReminders(mailer, new Date(), () => {});
    expect(mailer.sent.map((m) => m.to)).not.toEqual(expect.arrayContaining(["early@remind.test"]));
    expect(mailer.sent.map((m) => m.to)).not.toEqual(expect.arrayContaining(["ended@remind.test"]));
    expect(mailer.sent.map((m) => m.to)).not.toEqual(expect.arrayContaining(["card@remind.test"]));
  });

  it("tries again next time if the email couldn't be sent", async () => {
    const fam = await signup(t.app, "retry@remind.test", "family");
    await setSub(fam.orgId, "non_renewing", 2);
    const failing = { configured: true, send: async () => { throw new Error("smtp down"); } };
    await runRenewalReminders(failing, new Date(), () => {});
    const mailer = new MemoryMailer();
    await runRenewalReminders(mailer, new Date(), () => {});
    expect(mailer.sent.map((m) => m.to)).toContain("retry@remind.test");
  });
});
