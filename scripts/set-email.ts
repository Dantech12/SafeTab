/**
 * Saves your email-sending settings into .env (with a backup), so SafeTab can send
 * password-reset and invitation emails.
 *
 *   npm run set-email
 *
 * Choose Gmail (needs a Gmail "app password") or Brevo (free plan, SMTP key), or enter
 * any other SMTP service. The password/key is asked for, not taken as an argument, so it
 * stays out of your command history.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { updateEnv } from "./set-pricing.js";

export const PRESETS: Record<string, { host: string; port: number; secure: boolean; userHint: string; passHint: string }> = {
  gmail: { host: "smtp.gmail.com", port: 465, secure: true, userHint: "Your Gmail address", passHint: "Gmail app password (16 letters)" },
  brevo: { host: "smtp-relay.brevo.com", port: 587, secure: false, userHint: "Brevo SMTP login (shown under SMTP & API)", passHint: "Brevo SMTP key" },
};

export function emailValues(o: { host: string; port: number; secure: boolean; user: string; pass: string; from: string }): Record<string, string> {
  if (!/^[a-z0-9.-]+$/i.test(o.host)) throw new Error("That server name doesn't look right");
  if (!o.user || !o.pass) throw new Error("Username and password are required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.from.replace(/^.*<|>$/g, ""))) throw new Error("The sender address doesn't look like an email address");
  return {
    SMTP_HOST: o.host,
    SMTP_PORT: String(o.port),
    SMTP_SECURE: String(o.secure),
    SMTP_USER: o.user,
    SMTP_PASS: o.pass.replace(/\s+/g, ""), // Gmail shows app passwords with spaces
    MAIL_FROM: o.from,
  };
}

function prompter() {
  const rl = createInterface({ input: stdin, terminal: false });
  const lines: string[] = [];
  const waiters: ((l: string | null) => void)[] = [];
  let ended = false;
  rl.on("line", (l) => (waiters.length ? waiters.shift()!(l) : lines.push(l)));
  rl.on("close", () => { ended = true; while (waiters.length) waiters.shift()!(null); });
  return {
    close: () => rl.close(),
    async ask(q: string, def = ""): Promise<string> {
      stdout.write(def ? `${q} [${def}]: ` : `${q}: `);
      const line = lines.length ? lines.shift()! : ended ? null : await new Promise<string | null>((r) => waiters.push(r));
      if (line === null) throw new Error("input ended");
      return line.trim() || def;
    },
  };
}

async function main() {
  const file = path.resolve(".env");
  if (!existsSync(file)) throw new Error("No .env file found here. Run this inside your SafeTab folder.");
  const io = prompter();
  console.log("Set up email sending for SafeTab.\n  1) Gmail   2) Brevo   3) Other SMTP service\n");
  const choice = await io.ask("Choose 1, 2 or 3", "1");
  let host: string, port: number, secure: boolean, userHint: string, passHint: string;
  if (choice === "1" || choice === "2") {
    ({ host, port, secure, userHint, passHint } = PRESETS[choice === "1" ? "gmail" : "brevo"]!);
  } else {
    host = await io.ask("SMTP server (host)");
    port = Number(await io.ask("Port", "587"));
    secure = (await io.ask("Use SSL from the start? (yes for port 465)", port === 465 ? "yes" : "no")).toLowerCase().startsWith("y");
    userHint = "SMTP username";
    passHint = "SMTP password";
  }
  const user = await io.ask(userHint);
  const pass = await io.ask(passHint);
  const fromDefault = choice === "1" ? user : "";
  const fromEmail = await io.ask("Send emails from (address people will see)", fromDefault);
  const name = (readFileSync(file, "utf8").match(/^BUSINESS_NAME=(.*)$/m)?.[1] ?? "SafeTab").trim() || "SafeTab";
  io.close();

  const values = emailValues({ host, port, secure, user, pass, from: `${name} <${fromEmail}>` });
  const backup = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(file, backup);
  writeFileSync(file, updateEnv(readFileSync(file, "utf8"), values, "# Email sending (set by `npm run set-email`)"));
  console.log(`\nSaved to .env (backup: ${path.basename(backup)}).`);
  console.log("Now restart SafeTab:  npm.cmd run dev   (Windows)  or  npm run dev");
  console.log("Then test it: open the sign-in page, click \"Forgot password?\" and enter your own email.");
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith("set-email")) {
  main().catch((e) => {
    console.error(`Error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  });
}
