import type { Tx } from "../db/pool.js";
import type { PolicySpec } from "./spec.js";
import { schoolHoursScope } from "./spec.js";

export const CONSENT_TEXT_VERSION = "2026-11-v1";

export type ConsentStatus = "none" | "active" | "needs_reconsent" | "withdrawn";

export interface ConsentRow {
  id: string;
  guardian_id: string;
  signature_name: string;
  scope: string;
  granted_at: Date;
  withdrawn_at: Date | null;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Plain-language consent wording generated from the exact rules being agreed to. */
export function consentText(orgName: string, studentName: string, spec: PolicySpec): string {
  const sh = spec.schoolHours;
  const when = sh.windows.length
    ? sh.windows.map((w) => `${w.days.map((d) => DAY_NAMES[d - 1]).join(", ")} ${w.start}–${w.end}`).join("; ")
    : "(no times set)";
  return [
    `I am ${studentName}'s parent or legal guardian and I own (or am responsible for) their tablet.`,
    `I agree that ${orgName} may manage this tablet with SafeTab, limited to the following:`,
    `• During school hours only (${when}, time zone ${sh.timezone}), these apps are switched off: ${sh.blockedApps.join(", ") || "(none)"}. Apps are not deleted; their data is kept.`,
    `• Outside those hours, the school does not restrict the tablet.`,
    `• The school can see whether the tablet is enrolled and whether the rules are applied. It cannot see messages, photos, files, screens, location, browsing history, or which apps are used.`,
    `• The tablet must be reset once to enroll. While enrolled, it shows that it is managed.`,
    `• I can withdraw consent at any time in SafeTab. The school-hours rules then stop. Fully removing management requires resetting the tablet again, so back it up first.`,
    `• If the school changes these rules, they will not apply until I agree to the new rules.`,
  ].join("\n");
}

/** Latest consent for a student and whether it covers the current rules. */
export async function consentStatus(tx: Tx, studentId: string, spec: PolicySpec): Promise<{ status: ConsentStatus; consent: ConsentRow | null }> {
  const r = await tx.query<ConsentRow>(
    `SELECT id, guardian_id, signature_name, scope, granted_at, withdrawn_at FROM parental_consents
     WHERE student_id = $1 ORDER BY granted_at DESC LIMIT 1`, [studentId]);
  const c = r.rows[0] ?? null;
  if (!c) return { status: "none", consent: null };
  if (c.withdrawn_at) return { status: "withdrawn", consent: c };
  return { status: c.scope === schoolHoursScope(spec) ? "active" : "needs_reconsent", consent: c };
}
