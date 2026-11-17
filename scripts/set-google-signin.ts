/**
 * Saves your Google sign-in credentials into .env (with a backup), so the
 * "Continue with Google" button appears. Asks for the values instead of taking them as
 * arguments, so the secret doesn't end up in your command history.
 *
 *   npm run set-google-signin
 *
 * Get the values from Google Cloud Console -> APIs & Services -> Credentials -> your
 * OAuth client (Web application). See docs/GOING_LIVE.md, step 2.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { updateEnv } from "./set-pricing.js";

export function validateGoogleClient(id: string, secret: string): string | null {
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id)) {
    return "That Client ID doesn't look right. It ends with .apps.googleusercontent.com";
  }
  if (secret.length < 10 || /\s/.test(secret)) return "That Client secret doesn't look right. Copy it again (it usually starts with GOCSPX-).";
  return null;
}

// Queue input lines so answers pasted quickly (or piped) are never lost.
function prompter() {
  const rl = createInterface({ input: stdin, terminal: false });
  const lines: string[] = [];
  const waiters: ((l: string | null) => void)[] = [];
  let ended = false;
  rl.on("line", (l) => (waiters.length ? waiters.shift()!(l) : lines.push(l)));
  rl.on("close", () => { ended = true; while (waiters.length) waiters.shift()!(null); });
  return {
    close: () => rl.close(),
    async ask(q: string): Promise<string> {
      stdout.write(q);
      const line = lines.length ? lines.shift()! : ended ? null : await new Promise<string | null>((r) => waiters.push(r));
      if (line === null) throw new Error("input ended");
      return line;
    },
  };
}

async function main() {
  const file = path.resolve(".env");
  if (!existsSync(file)) throw new Error("No .env file found here. Run this inside your SafeTab folder.");
  console.log("Paste the values from Google Cloud Console (Credentials → your OAuth client).\n");
  const io = prompter();
  const id = (await io.ask("Client ID: ")).trim();
  const secret = (await io.ask("Client secret: ")).trim();
  io.close();
  const problem = validateGoogleClient(id, secret);
  if (problem) throw new Error(problem);

  const base = (readFileSync(file, "utf8").match(/^PUBLIC_BASE_URL=(.*)$/m)?.[1] ?? "http://localhost:3000").trim();
  const backup = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(file, backup);
  writeFileSync(file, updateEnv(readFileSync(file, "utf8"), { GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret }, "# Sign in with Google (set by `npm run set-google-signin`)"));
  console.log(`\nSaved to .env (backup: ${path.basename(backup)}).`);
  console.log(`Make sure this Authorized redirect URI is on the Google client:\n  ${base}/auth/google/callback`);
  console.log("\nNow restart SafeTab:  npm.cmd run dev   (Windows)  or  npm run dev");
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith("set-google-signin")) {
  main().catch((e) => {
    console.error(`Error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  });
}
