import type { Tx } from "./db/pool.js";

export interface AuditEntry {
  actorType: "user" | "device" | "system";
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/**
 * Writes inside the caller's tenant transaction, so the audit record and the change it
 * describes commit or roll back together. Never put tokens, passwords or activity
 * contents in metadata.
 */
export async function audit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (org_id, actor_type, actor_id, action, target_type, target_id, metadata, ip)
     VALUES (app_current_org(), $1, $2, $3, $4, $5, $6, $7)`,
    [e.actorType, e.actorId ?? null, e.action, e.targetType ?? null, e.targetId ?? null,
      JSON.stringify(e.metadata ?? {}), e.ip ?? null],
  );
}
