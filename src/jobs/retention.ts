import pg from "pg";

/**
 * Deletes data past each organization's retention window. Runs daily as the owner role
 * (the app role cannot delete audit rows). Logs counts only.
 */
export async function runRetention(ownerUrl: string): Promise<{ usage: number; audit: number; sessions: number; webhooks: number }> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const usage = await client.query(
      `DELETE FROM app_usage_daily u USING organizations o
       WHERE u.org_id = o.id AND u.day < current_date - o.usage_retention_days`);
    const auditRows = await client.query(
      `DELETE FROM audit_log a USING organizations o
       WHERE a.org_id = o.id AND a.created_at < now() - make_interval(days => o.audit_retention_days)`);
    const sessions = await client.query("DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'");
    const webhooks = await client.query("DELETE FROM webhook_events WHERE received_at < now() - interval '30 days'");
    return { usage: usage.rowCount ?? 0, audit: auditRows.rowCount ?? 0, sessions: sessions.rowCount ?? 0, webhooks: webhooks.rowCount ?? 0 };
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is required");
  console.log(JSON.stringify(await runRetention(url)));
}
