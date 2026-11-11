import pg from "pg";
import { config } from "../config.js";

let pool: pg.Pool | undefined;
export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: config().DATABASE_URL, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export type Tx = pg.PoolClient;

/**
 * Runs `fn` in a transaction bound to one tenant. `set_config(..., true)` is
 * transaction-local, so the tenant context can never leak to the next request
 * that reuses this pooled connection.
 */
export async function withTenant<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Queries against non-tenant tables (users, sessions, webhook_events) and definer lookups. */
export async function q<R extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return getPool().query<R>(text, params);
}
