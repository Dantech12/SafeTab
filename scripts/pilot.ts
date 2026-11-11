/**
 * Guided pilot setup against a RUNNING SafeTab server on this computer:
 *   1. sign in (or create the admin account + school org)
 *   2. pilot-only billing activation (no payment; refused in production)
 *   3. connect Android Enterprise (opens Google's signup page)
 *   4. create a test student and a device enrollment QR code (pilot-enrollment-qr.png)
 *
 * Usage:  npm run pilot
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pg from "pg";
import QRCode from "qrcode";

const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
if (process.env.NODE_ENV === "production") throw new Error("The pilot script must not be run against production.");

// Queue input lines so answers typed (or piped) ahead of a prompt are not lost.
const rl = createInterface({ input: stdin, terminal: false });
const lines: string[] = [];
const waiters: ((l: string | null) => void)[] = [];
let ended = false;
rl.on("line", (l) => (waiters.length ? waiters.shift()!(l) : lines.push(l)));
rl.on("close", () => { ended = true; while (waiters.length) waiters.shift()!(null); });
async function ask(q: string, def?: string): Promise<string> {
  stdout.write(def ? `${q} [${def}]: ` : `${q}: `);
  const line = lines.length ? lines.shift()! : ended ? null : await new Promise<string | null>((r) => waiters.push(r));
  if (line === null) throw new Error("input ended");
  return line.trim() || def || "";
}

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as any };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const health = await fetch(`${base}/healthz`).catch(() => null);
  if (!health?.ok) throw new Error(`SafeTab server is not running at ${base}. Start it first with: npm run dev`);

  console.log("\n== 1. Admin account ==");
  const email = await ask("Admin email");
  const password = await ask("Password (12+ characters; shown as you type, so make sure no one is watching)");
  let token: string;
  let orgId: string;
  const login = await api("POST", "/v1/auth/login", undefined, { email, password });
  if (login.status === 200) {
    token = login.json.token;
    const org = login.json.orgs.find((o: any) => o.role === "org_admin");
    if (!org) throw new Error("This account is not an admin of any organization.");
    orgId = org.org_id;
    console.log(`Signed in. Using organization "${org.org_name}".`);
  } else if (login.status !== 401) {
    throw new Error(`Sign-in failed with a server error (${login.status}). Check the server window for details; if it says a table does not exist, run: npm run migrate`);
  } else {
    const create = (await ask("No account found (or wrong password). Create a new one? (y/n)", "y")).toLowerCase() === "y";
    if (!create) return;
    const orgName = await ask("School / organization name", "SafeTab Pilot School");
    const s = await api("POST", "/v1/auth/signup", undefined, { email, password, displayName: email.split("@")[0], account: { kind: "school", name: orgName } });
    if (s.status === 400) throw new Error(`Sign-up rejected: ${(s.json.issues ?? []).map((i: any) => `${i.path}: ${i.message}`).join("; ") || s.json.error}`);
    if (s.status === 409) throw new Error("That email already has an account. Run the script again and enter the correct password.");
    if (s.status !== 201) throw new Error(`Sign-up failed with a server error (${s.status}). Check the server window for details.`);
    token = s.json.token;
    orgId = s.json.orgId;
    console.log("Account and organization created.");
  }

  console.log("\n== 2. Billing (pilot) ==");
  const billing = await api("GET", `/v1/orgs/${orgId}/billing`, token);
  if (billing.json.access !== "full") {
    const ownerUrl = process.env.DATABASE_OWNER_URL;
    if (!ownerUrl) throw new Error("DATABASE_OWNER_URL is needed for pilot activation.");
    const db = new pg.Client({ connectionString: ownerUrl });
    await db.connect();
    await db.query("UPDATE subscriptions SET status = 'active', current_period_end = now() + interval '30 days' WHERE org_id = $1", [orgId]);
    await db.end();
    console.log("Activated for 30 days WITHOUT payment (local pilot only; Paystack is not involved).");
  } else {
    console.log("Already active.");
  }

  console.log("\n== 3. Connect Android Enterprise ==");
  let android = await api("GET", `/v1/orgs/${orgId}/android`, token);
  if (!android.json.connected) {
    const su = await api("POST", `/v1/orgs/${orgId}/android/signup`, token);
    if (su.status !== 200) throw new Error(`Could not start Android signup: ${JSON.stringify(su.json)}`);
    console.log("\nOpen this link in your browser, sign in with the Google account that will own the test enterprise,");
    console.log("and finish Google's steps. You will come back to a page saying \"Android connected\".\n");
    console.log(su.json.signupUrl, "\n");
    console.log("Waiting for you to finish (up to 60 minutes)...");
    for (let i = 0; i < 720 && !android.json.connected; i++) {
      await sleep(5000);
      android = await api("GET", `/v1/orgs/${orgId}/android`, token);
    }
    if (!android.json.connected) throw new Error("Timed out waiting for Android signup. Run the script again.");
  }
  console.log(`Connected: ${android.json.enterpriseName}`);

  console.log("\n== 4. Test student and device QR ==");
  const students = await api("GET", `/v1/orgs/${orgId}/students`, token);
  let studentId: string = students.json.students?.[0]?.id;
  if (!studentId) {
    const st = await api("POST", `/v1/orgs/${orgId}/students`, token, { displayName: "Pilot student", ageBand: "13_15" });
    studentId = st.json.id;
    console.log("Created student \"Pilot student\".");
  } else {
    console.log(`Using existing student "${students.json.students[0].display_name}".`);
  }
  const label = await ask("Label for this tablet", "Test tablet 1");
  const dev = await api("POST", `/v1/orgs/${orgId}/students/${studentId}/devices`, token, { ownership: "school_owned", label });
  if (dev.status !== 201) throw new Error(`Could not create enrollment: ${JSON.stringify(dev.json)}`);
  const file = "pilot-enrollment-qr.png";
  await QRCode.toFile(file, dev.json.qrCode, { width: 600, errorCorrectionLevel: "M" });
  console.log(`\nSaved ${file} (valid until ${new Date(dev.json.expiresAt).toLocaleString()}, one use only).`);
  console.log(`
Next, on a tablet you are allowed to WIPE:
  1. Factory-reset it (Settings > System > Reset). This erases everything on it.
  2. On the first "Welcome" screen, tap the same spot 6 times to open the QR scanner.
  3. Connect to Wi-Fi when asked, then scan ${file} from your computer screen.
  4. Follow the setup. The worker will mark the device active within ~${Number(process.env.DEVICE_POLL_SECONDS ?? 300) / 60} minutes.
Do not share the QR image: anyone who scans it before it expires enrolls a device into your organization.`);
}

main()
  .catch((e) => {
    console.error(`\nError: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
