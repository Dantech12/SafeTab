/**
 * Prepares a hosted database (e.g. Neon) for SafeTab. Safe to run on every deploy.
 *
 *   DATABASE_OWNER_URL=... APP_DB_PASSWORD=... npm run deploy:db
 *
 *  1. Creates the restricted runtime role (APP_DB_USER, default safetab_app) if missing,
 *     or updates its password: LOGIN, NOSUPERUSER, NOBYPASSRLS, so row-level security
 *     always applies to the running app.
 *  2. Applies pending migrations as the owner.
 *  3. (Re)applies the runtime role's permissions, including the append-only rules.
 */
import pg from "pg";
import { migrate } from "../src/db/migrate.js";
import { isMain } from "../src/lib/is-main.js";

export async function setupDatabase(ownerUrl: string, appUser: string, appPassword: string, log = console.log) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(appUser)) throw new Error("APP_DB_USER must be a simple lowercase name");
  if (appPassword.length < 16) throw new Error("APP_DB_PASSWORD must be at least 16 characters");
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    const exists = (await c.query("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1", [appUser])).rows[0];
    const stmt = (await c.query(
      exists
        // Hosted owners aren't superusers and may not restate SUPERUSER/BYPASSRLS; the
        // attributes are verified right below instead.
        ? "SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS sql"
        : "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', $1::text, $2::text) AS sql",
      [appUser, appPassword])).rows[0].sql;
    try {
      await c.query(stmt);
    } catch (e) {
      if ((e as { code?: string }).code === "42501") {
        throw new Error(`The database role "${appUser}" already exists and this owner can't change it. Set APP_DB_USER to a new name (e.g. safetab_runtime) and deploy again.`);
      }
      throw e;
    }
    log(exists ? `updated role ${appUser}` : `created role ${appUser}`);
    const role = (await c.query("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1", [appUser])).rows[0];
    if (role.rolbypassrls || role.rolsuper) throw new Error(`${appUser} must not bypass row-level security`);
  } finally {
    await c.end();
  }

  await migrate(ownerUrl);

  const g = new pg.Client({ connectionString: ownerUrl });
  await g.connect();
  try {
    const r = await g.query("SELECT format('%I', $1::text) AS r", [appUser]);
    const R = r.rows[0].r as string;
    await g.query(`GRANT USAGE ON SCHEMA public TO ${R}`);
    await g.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${R}`);
    await g.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${R}`);
    await g.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${R}`);
    // Evidence and records the app may add to but never erase or rewrite.
    await g.query(`REVOKE UPDATE, DELETE ON audit_log FROM ${R}`);
    await g.query(`REVOKE DELETE ON parental_consents, purchases, password_resets FROM ${R}`);
    await g.query(`REVOKE ALL ON schema_migrations FROM ${R}`);
    log(`permissions applied for ${appUser}`);
  } finally {
    await g.end();
  }
}

if (isMain(import.meta.url)) {
  const owner = process.env.DATABASE_OWNER_URL;
  const pw = process.env.APP_DB_PASSWORD ?? "";
  if (!owner) throw new Error("DATABASE_OWNER_URL is required");
  await setupDatabase(owner, process.env.APP_DB_USER || "safetab_app", pw);
}
