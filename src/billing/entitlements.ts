export type Plan = "individual" | "organization";
export type SubStatus = "none" | "active" | "non_renewing" | "past_due" | "lapsed" | "cancelled";

/** Default limits — business decisions to confirm before launch. */
export const PLAN_LIMITS: Record<Plan, { students: number; devices: number; members: number }> = {
  individual: { students: 5, devices: 5, members: 2 },
  organization: { students: 300, devices: 300, members: 30 },
};

export interface SubscriptionRow {
  plan: Plan;
  status: SubStatus;
  current_period_end: Date | null;
  grace_until: Date | null;
}

/**
 * full      : all features.
 * read_only : no new enrollments or policy changes, usage collection paused. Devices keep
 *             their last applied policy (no abrupt removal of protections). Viewing,
 *             export, deletion, device retirement and billing always remain available.
 *             Data is never deleted because of a lapse; normal retention rules still apply.
 */
export type AccessLevel = "full" | "read_only";

export function accessLevel(sub: SubscriptionRow, now: Date): AccessLevel {
  const periodOpen = sub.current_period_end != null && sub.current_period_end > now;
  switch (sub.status) {
    case "active":
      // Tolerate a missed renewal webhook for one grace window past period end.
      return periodOpen || (sub.grace_until != null && sub.grace_until > now) || sub.current_period_end == null
        ? "full"
        : "read_only";
    case "non_renewing":
    case "cancelled":
      return periodOpen ? "full" : "read_only"; // paid-for time is honoured
    case "past_due":
      return sub.grace_until != null && sub.grace_until > now ? "full" : "read_only";
    default:
      return "read_only";
  }
}

export function effectiveStatus(sub: SubscriptionRow, now: Date): SubStatus {
  if (sub.status === "none") return "none";
  return accessLevel(sub, now) === "full" ? sub.status : sub.status === "cancelled" ? "cancelled" : "lapsed";
}
