import type { Tx } from "../db/pool.js";
import { forbidden, notFound } from "../lib/errors.js";

export type Role = "org_admin" | "supervisor" | "guardian";

export type Permission =
  | "org.manage" // settings, retention, members, invitations
  | "billing.manage"
  | "student.create"
  | "student.read"
  | "device.enroll"
  | "device.manage" // mark lost, retire
  | "policy.write"
  | "activity.read"
  | "audit.read"
  | "data.export"
  | "data.delete"
  | "consent.give"; // only a parent/guardian, for their own child

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  org_admin: new Set<Permission>([
    "org.manage", "billing.manage", "student.create", "student.read", "device.enroll",
    "device.manage", "policy.write", "activity.read", "audit.read", "data.export", "data.delete",
  ]),
  // Supervisors (school staff / a second guardian) act only on students assigned to them.
  supervisor: new Set<Permission>(["student.read", "policy.write", "activity.read"]),
  // Parents/guardians: see their own child (via assignment) and give/withdraw consent.
  // They cannot change the school's rules.
  guardian: new Set<Permission>(["student.read", "consent.give"]),
};

export interface UserCtx {
  userId: string;
  orgId: string;
  role: Role;
  ip?: string;
}

export function can(ctx: UserCtx, p: Permission): boolean {
  return MATRIX[ctx.role].has(p);
}

export function requirePerm(ctx: UserCtx, p: Permission): void {
  if (!can(ctx, p)) throw forbidden(`missing_permission:${p}`);
}

/**
 * Object-level check. Returns 404 (not 403) for students the caller may not see, so the
 * API does not confirm that other students exist. RLS separately enforces the tenant.
 */
export async function requireStudentAccess(tx: Tx, ctx: UserCtx, studentId: string, p: Permission): Promise<void> {
  requirePerm(ctx, p);
  const exists = await tx.query("SELECT 1 FROM students WHERE id = $1", [studentId]);
  if (!exists.rowCount) throw notFound("student_not_found");
  if (ctx.role === "org_admin") return;
  const assigned = await tx.query(
    "SELECT 1 FROM supervisor_assignments WHERE user_id = $1 AND student_id = $2",
    [ctx.userId, studentId],
  );
  if (!assigned.rowCount) throw notFound("student_not_found");
}

/** SQL fragment restricting student lists for supervisors. */
export function visibleStudents(ctx: UserCtx, alias = "s"): { sql: string; params: unknown[] } {
  if (ctx.role === "org_admin") return { sql: "TRUE", params: [] };
  return {
    sql: `${alias}.id IN (SELECT student_id FROM supervisor_assignments WHERE user_id = $1)`,
    params: [ctx.userId],
  };
}
