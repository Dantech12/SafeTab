/**
 * `npm run dev`: runs SafeTab and keeps this copy automatically up to date.
 *
 *  - Applies any new database migrations, then starts the server (tsx watch reloads on
 *    code changes; portal/product-page files are read fresh on every request).
 *  - Every AUTO_UPDATE_SECONDS (default 60) it fetches AUTO_UPDATE_BRANCH and
 *    fast-forwards to it when safe. If packages changed it reinstalls them; if database
 *    migrations changed it applies them; then it restarts the server.
 *  - Set AUTO_UPDATE=false in .env to turn this off.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { migrate } from "../src/db/migrate.js";
import { checkForUpdates } from "./auto-update.js";

const cwd = process.cwd();
const enabled = (process.env.AUTO_UPDATE ?? "true") !== "false";
const remote = process.env.AUTO_UPDATE_REMOTE ?? "origin";
const branch = process.env.AUTO_UPDATE_BRANCH ?? "claude/vibrant-pasteur-oiptqy";
const everyMs = Math.max(30, Number(process.env.AUTO_UPDATE_SECONDS ?? 60)) * 1000;
const isWindows = process.platform === "win32";

const log = (msg: string) => console.log(`[safetab] ${msg}`);

// Run npm and tsx through the current Node binary: no shell, so nothing is concatenated
// into a command line (and no DEP0190 warning on Windows).
const npmCli = process.env.npm_execpath; // set by `npm run`
const tsxCli = path.join(cwd, "node_modules", "tsx", "dist", "cli.mjs");

function npm(args: string[]): Promise<void> {
  if (!npmCli) return Promise.reject(new Error("npm not found; run SafeTab with `npm run dev`"));
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [npmCli, ...args], { cwd, stdio: "inherit", windowsHide: true });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npm ${args.join(" ")} exited with ${code}`))));
    p.on("error", reject);
  });
}

async function applyMigrations() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) { log("DATABASE_OWNER_URL is not set; skipping migrations"); return; }
  await migrate(url);
}

let server: ChildProcess | undefined;
function startServer() {
  // Environment (from --env-file=.env) is inherited by the child.
  // Own process group (non-Windows) so a restart stops npx, tsx watch and the server together.
  server = spawn(process.execPath, [tsxCli, "watch", "src/server.ts"], { cwd, stdio: "inherit", windowsHide: true, detached: !isWindows });
  server.on("exit", (code, signal) => { if (!stopping && !restarting) log(`server stopped (${signal ?? code})`); });
}

/** Stops the server and everything it started (tsx watch -> node). */
function stopTree(p: ChildProcess) {
  if (!p.pid) return;
  if (isWindows) spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true });
  else {
    try { process.kill(-p.pid, "SIGTERM"); } catch { p.kill("SIGTERM"); }
  }
}

let restarting = false;
let stopping = false;
async function restartServer() {
  restarting = true;
  await new Promise<void>((resolve) => {
    if (!server || server.exitCode !== null) return resolve();
    server.once("exit", () => resolve());
    stopTree(server);
  });
  restarting = false;
  startServer();
}

let checking = false;
async function tick() {
  if (checking) return;
  checking = true;
  try {
    const r = await checkForUpdates(cwd, remote, branch);
    if (!r.updated) {
      if (r.reason !== "already up to date") log(`auto-update: ${r.reason}`);
      return;
    }
    log(`auto-update: ${r.reason} (${r.changedFiles.length} file${r.changedFiles.length === 1 ? "" : "s"})`);
    const needsInstall = r.restoredFiles.includes("package-lock.json") || r.changedFiles.some((f) => f === "package.json" || f === "package-lock.json");
    const needsMigrate = r.changedFiles.some((f) => f.startsWith("db/migrations/"));
    const needsRestart = needsInstall || needsMigrate || r.changedFiles.some((f) => f.startsWith("scripts/") || f === ".env.example");
    if (needsInstall) { log("installing updated packages…"); await npm(["install", "--no-audit", "--no-fund"]); }
    if (needsMigrate) { log("updating the database…"); await applyMigrations(); }
    if (r.changedFiles.some((f) => f === ".env.example")) log("note: .env.example changed — check README for any new settings");
    if (needsRestart) { log("restarting SafeTab…"); await restartServer(); }
    // Other code changes are picked up by tsx watch; portal files are served fresh.
  } catch (e) {
    log(`auto-update failed (will retry): ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  } finally {
    checking = false;
  }
}

async function main() {
  await applyMigrations();
  startServer();
  if (enabled) {
    log(`auto-update is ON: following ${remote}/${branch}, checking every ${everyMs / 1000}s (set AUTO_UPDATE=false in .env to turn off)`);
    setTimeout(tick, 5000);
    setInterval(tick, everyMs);
  } else {
    log("auto-update is OFF");
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    if (server) stopTree(server);
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
