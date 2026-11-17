/* SafeTab supervisor portal. Plain JS, no build step, same-origin API only.
 * All user-supplied text is HTML-escaped with h() before rendering. */
"use strict";

const state = { token: null, orgId: null, org: null, me: null };
const app = document.getElementById("app");
const flashEl = document.getElementById("flash");

// ---------- icons (inline SVG line icons, 24px grid) ----------
const ICONS = {
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  chevdown: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  tablet: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 18h.01"/>',
  android: '<path d="M5 16V9a7 7 0 0 1 14 0v7"/><path d="M5 12h14"/><path d="M9 6.5h.01"/><path d="M15 6.5h.01"/><path d="M8 2 9.5 4"/><path d="M16 2l-1.5 2"/><path d="M5 16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  sparkles: '<path d="M9.94 14.06 8 20l-1.94-5.94L0 12l6.06-1.94L8 4l1.94 6.06L16 12z" transform="translate(2 -1) scale(.9)"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  eyeoff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/>',
};
const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon)));

// ---------- helpers ----------
const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (v) => (v ? new Date(v).toLocaleString() : "—");
const fmtDay = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const money = (subunits, currency) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: subunits % 100 ? 2 : 0 }).format(subunits / 100); }
  catch { return `${currency} ${(subunits / 100).toFixed(2)}`; }
};
const isAdmin = () => state.org?.myRole === "org_admin";
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "?";
const AVATAR_GRADS = ["#1d4ed8", "#2563eb", "#1e40af", "#3b82f6", "#1e3a8a", "#0369a1"];
const avatar = (name, id, cls = "") => {
  const n = [...String(id || name)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return `<span class="avatar ${cls}" style="background:${AVATAR_GRADS[n % AVATAR_GRADS.length]}">${h(initials(name))}</span>`;
};
const lstore = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};

const ERRORS = {
  invalid_credentials: "Wrong email or password.",
  signup_failed: "An account with that email already exists. Sign in instead.",
  subscription_inactive_read_only: "Your plan is not active, so changes are paused. Activate it on the Home page.",
  android_enterprise_not_configured: "Connect Android first (Home page, step 2).",
  student_limit_reached: "You have reached the student limit for your plan.",
  device_limit_reached: "You have reached the device limit for your plan.",
  policy_version_conflict: "Someone else changed these rules just now. Reload the page and try again.",
  google_rejected_token_start_again: "Google did not accept that code (it may have expired). Click “Get a new Google link” and try again.",
  no_pending_signup_start_again: "Start the Google signup first (click “Open Google signup”).",
  mdm_policy_push_failed: "Google could not receive the device settings. Check the server window for details.",
  retire_devices_first: "Retire this student's tablets first.",
  invalid_or_expired_invitation: "This invitation link is invalid, already used, or expired. Ask the school for a new one.",
  parent_consent_required: "This is a parent-owned tablet. A parent must first agree to the school-hours rules in SafeTab (see “Parents & consent”).",
  invitation_email_mismatch: "You're signed in with a different email from the one that was invited. Sign out and use the invited email.",
  sign_in_to_accept: "You already have a SafeTab account with this email. Use “I already have an account” below.",
  staff_account_cannot_be_guardian_use_another_email: "This email belongs to a staff account. Use a different email for the parent account.",
  no_school_hours_rules_to_consent_to: "The school hasn't set school-hours rules yet, so there is nothing to agree to.",
  no_active_consent: "There is no active consent to withdraw.",
  member_limit_reached: "This organization has reached its staff limit.",
  payments_not_configured: "Paystack isn't set up yet: add your Paystack secret key and plan codes to the .env file, then restart SafeTab.",
  paystack_unavailable: "Couldn't reach Paystack. Check your internet connection and try again.",
  already_active: "Your plan is already active.",
  use_provider_sign_in: "This account signs in with Google or Microsoft. Use the button above.",
  oauth_code_expired: "That sign-in link has expired. Please sign in again.",
  workspace_limit_reached: "You've reached the maximum number of workspaces.",
  no_paystack_subscription: "There's no Paystack subscription on this workspace yet.",
  purchase_plan_mismatch: "This payment is for a different kind of workspace.",
  purchase_not_paid: "Paystack hasn't confirmed this payment yet.",
  purchase_already_claimed: "This payment has already been added to a workspace.",
  purchase_not_found: "We couldn't find that payment.",
};

let flashTimer;
function flash(msg, kind = "error") {
  flashEl.className = kind;
  flashEl.innerHTML = `${icon(kind === "success" ? "check" : kind === "info" ? "info" : "alert")} ${h(msg)}`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flashEl.innerHTML = ""), kind === "error" ? 9000 : 5000);
}

/** Turns Paystack's refusal reason into a plain next step for the admin. */
function paystackHelp(reason) {
  const r = reason.toLowerCase();
  let fix = "Check the Paystack settings in your .env file, then restart SafeTab.";
  if (r.includes("key")) fix = "Your Paystack secret key in .env looks wrong. Copy the TEST secret key (sk_test_…) again, with no spaces, then restart SafeTab.";
  else if (r.includes("currency")) fix = "Your Paystack account can't charge in this currency. Set BILLING_CURRENCY in .env to a currency your account supports, and create the plans in that currency.";
  else if (r.includes("plan")) fix = "A plan code in .env is wrong, or it was created in a different mode (test vs live) from your secret key. Copy both PLN_ codes again.";
  else if (r.includes("email")) fix = "Paystack didn't accept your account's email address.";
  return `Paystack said: “${reason}”. ${fix}`;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && state.token && !path.startsWith("/v1/auth/")) {
    signOut(false);
    throw new Error("Your session ended. Please sign in again.");
  }
  if (!res.ok) {
    const issues = (json.issues || []).map((i) => `${i.path || "value"}: ${i.message}`).join("; ");
    if (json.error === "paystack_rejected") throw new Error(paystackHelp(json.detail || ""));
    throw new Error(ERRORS[json.error] || issues || json.error || `Request failed (${res.status})`);
  }
  return json;
}

const orgPath = (p = "") => `/v1/orgs/${state.orgId}${p}`;

async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { flash(e.message || String(e)); } finally { if (btn) btn.disabled = false; }
}

// ---------- session ----------
const sidebar = document.getElementById("sidebar");

function signOut(callApi = true) {
  if (callApi && state.token) fetch("/v1/auth/logout", { method: "POST", headers: { authorization: `Bearer ${state.token}` } }).catch(() => {});
  Object.assign(state, { token: null, orgId: null, org: null, me: null });
  store.set("st_token", null);
  store.set("st_org", null);
  sidebar.hidden = true;
  document.getElementById("appbar").hidden = true;
  location.hash = "#/login";
}

async function loadSession() {
  state.token = store.get("st_token");
  if (!state.token) return false;
  try { state.me = await api("GET", "/v1/me"); } catch { return false; }
  const saved = store.get("st_org");
  const org = state.me.orgs.find((o) => o.org_id === saved) || state.me.orgs.find((o) => o.role === "org_admin") || state.me.orgs[0];
  if (!org) return "noorg";
  state.orgId = org.org_id;
  store.set("st_org", state.orgId);
  state.org = await api("GET", orgPath());
  sidebar.hidden = false;
  document.getElementById("org-name").textContent = state.org.name;
  document.getElementById("org-avatar").textContent = initials(state.org.name);
  document.querySelectorAll("[data-admin-only]").forEach((el) => (el.hidden = !isAdmin()));
  const me = state.me.user;
  document.getElementById("appbar").hidden = false;
  document.getElementById("user-avatar").textContent = initials(me.display_name);
  document.getElementById("user-name").textContent = me.display_name;
  document.getElementById("user-role").textContent = ROLE_LABEL[state.org.myRole] || "";
  document.getElementById("menu-name").textContent = me.display_name;
  document.getElementById("menu-email").textContent = me.email;
  return true;
}

const ROLE_LABEL = { org_admin: "Admin", supervisor: "Teacher / supervisor", guardian: "Parent" };

/** Breadcrumb trail in the top bar: [["Home", "#/"], ["Esi Mensah"]]. */
function setCrumbs(items) {
  const el = document.getElementById("crumbs");
  if (!el) return;
  el.innerHTML = items.map(([label, href], i) =>
    (i ? `<span class="sep" aria-hidden="true">/</span>` : "") +
    (href ? `<a href="${h(href)}">${h(label)}</a>` : `<span aria-current="page">${h(label)}</span>`)).join("");
}

// Profile menu
(() => {
  const btn = document.getElementById("user-btn");
  const menu = document.getElementById("user-menu");
  if (!btn || !menu) return;
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
  menu.querySelector("[data-action=logout]")?.addEventListener("click", () => { close(); signOut(true); });
})();

function setActiveNav(key) {
  sidebar.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === key));
}

// ---------- sign in with Google / Microsoft ----------
const BRAND = {
  google: '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  microsoft: '<svg viewBox="0 0 21 21" width="18" height="18" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>',
};
let providersPromise;
const getProviders = () => (providersPromise ??= fetch("/v1/public/auth-providers").then((r) => r.json()).then((j) => j.providers || []).catch(() => []));

/** Fills <div id="social"> with "Continue with …" buttons for enabled providers. */
async function renderSocial(next) {
  const box = app.querySelector("#social");
  if (!box) return;
  const providers = await getProviders();
  if (!providers.length) return;
  const q = next ? `?next=${encodeURIComponent(next)}` : "";
  box.innerHTML = providers.map((p) =>
    `<a class="social-btn" href="/auth/${h(p.id)}/start${q}">${BRAND[p.id] || ""}<span>Continue with ${h(p.name)}</span></a>`).join("") +
    `<div class="or"><span>or use email</span></div>`;
}

const OAUTH_ERRORS = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long. Please try again.",
  invalid: "We couldn't verify that sign-in. Please try again.",
  not_enabled: "That sign-in option isn't available.",
  provider_unavailable: "The sign-in service didn't respond. Please try again.",
  no_email: "Your account didn't share an email address, which SafeTab needs.",
  email_in_use: "An account with this email already exists. Sign in with your password instead.",
};

async function viewOauthDone(code) {
  app.innerHTML = `<div class="loader" aria-label="Signing you in"></div>`;
  let r;
  try {
    state.token = null;
    r = await api("POST", "/v1/auth/oauth/exchange", { code });
  } catch (e) {
    location.hash = "#/login";
    flash(e.message);
    return;
  }
  store.set("st_token", r.token);
  if (r.orgs.length) store.set("st_org", (r.orgs.find((o) => o.role === "org_admin") || r.orgs[0]).org_id);
  state.org = null;
  const target = r.next || store.get("st_next") || "#/";
  if (!r.orgs.length && !target.startsWith("#/invite/")) {
    const kind = /(school|family)$/.exec(target)?.[1];
    if (kind) store.set("st_want_kind", kind);
    if (target.startsWith("#/subscribe")) store.set("st_next", "#/subscribe");
    location.hash = "#/welcome";
    return;
  }
  store.set("st_next", null);
  flash(`Signed in with ${r.providerName}.`, "success");
  location.hash = target === "#/signup/school" || target === "#/signup/family" ? "#/" : target;
}

function viewWelcome() {
  sidebar.hidden = true;
  const kind = store.get("st_want_kind") || "school";
  app.innerHTML = authScreen(`
      <h2>Set up your workspace</h2>
      <p class="muted small" style="margin:0">One last step. You can invite others and add students next.</p>
      <form id="welcome" style="margin-top:12px">
        <label for="w-kind">Who is it for?</label>
        <select id="w-kind"><option value="school" ${kind === "school" ? "selected" : ""}>A school or organization</option><option value="family" ${kind === "family" ? "selected" : ""}>My family</option></select>
        <label for="w-name">School or family name</label>
        <input id="w-name" type="text" required maxlength="200" placeholder="e.g. Little Angels Academy">
        <div class="row"><button type="submit" class="full">Create workspace</button></div>
      </form>
      <p class="muted small auth-foot"><button type="button" class="link" data-action="logout2">Sign out</button></p>`);
  on("#welcome", "submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      state.token = store.get("st_token");
      const r = await api("POST", "/v1/orgs", { kind: val("#w-kind"), name: val("#w-name") });
      store.set("st_org", r.orgId);
      store.set("st_want_kind", null);
      flash("Workspace created.", "success");
      await afterAuth();
    });
  });
  on("[data-action=logout2]", "click", () => signOut(true));
}

// ---------- views ----------
function authScreen(inner) {
  const bar = document.getElementById("appbar");
  if (bar) bar.hidden = true;
  return `<div class="auth-screen">
    <section class="auth-side">
      <div class="brand"><span class="brand-mark">${icon("shield")}</span><span>SafeTab</span></div>
      <h1>Calm, transparent tablet management for schools and families.</h1>
      <p>Set app rules for school hours, see which tablets are protected, and keep parents in control.</p>
      <ul class="auth-points">
        <li>${icon("check")}<span>Apps switched off during school hours only</span></li>
        <li>${icon("check")}<span>Parents agree before anything applies to their tablet</span></li>
        <li>${icon("check")}<span>No messages, screens, cameras or locations — ever</span></li>
      </ul>
    </section>
    <section class="auth-main"><div class="auth">${inner}</div></section>
  </div>`;
}

function viewLogin(opts = {}) {
  sidebar.hidden = true;
  app.innerHTML = authScreen(`
      <h2>Welcome</h2>
      <p class="muted small" style="margin:0">Sign in to your school or family workspace.</p>
      <div id="social" class="social"></div>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-tab="signin">Sign in</button>
        <button type="button" role="tab" aria-selected="false" data-tab="signup">Create account</button>
      </div>
      <form id="signin">
        <label for="si-email">Email</label><input id="si-email" type="email" autocomplete="username" required>
        <label for="si-pw">Password</label><input id="si-pw" type="password" autocomplete="current-password" required>
        <div class="row"><button type="submit" class="full">Sign in</button></div>
      </form>
      <form id="signup" hidden>
        <label for="su-name">Your name</label><input id="su-name" type="text" autocomplete="name" required maxlength="120">
        <label for="su-email">Email</label><input id="su-email" type="email" autocomplete="username" required>
        <label for="su-pw">Password <span class="muted small">· at least 12 characters</span></label>
        <input id="su-pw" type="password" autocomplete="new-password" minlength="12" required>
        <div class="row" style="margin-top:12px">
          <select id="su-kind" aria-label="Account type" style="flex:1"><option value="school">School</option><option value="family">Family</option></select>
          <input id="su-org" type="text" required maxlength="200" placeholder="School or family name" aria-label="School or family name" style="flex:2;min-width:160px">
        </div>
        <div class="row"><button type="submit" class="full">Create account</button></div>
      </form>
      <p class="muted small auth-foot">Parents: use the invitation link your school sent you.</p>`);
  app.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    app.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    app.querySelector("#signin").hidden = b.dataset.tab !== "signin";
    app.querySelector("#signup").hidden = b.dataset.tab !== "signup";
  }));
  if (opts.claim) {
    const c = opts.claim;
    app.querySelector(".auth h2").outerHTML = c.status === "paid"
      ? `<div class="paid-banner">${icon("check")}<div><strong>Payment received</strong><span>${h(c.plan === "organization" ? "Organization" : "Individual")} plan · ${h(money(c.amount, c.currency))}/month</span></div></div>
         <h2 style="margin-top:14px">Create your account</h2>`
      : `<div class="paid-banner wait">${icon("clock")}<div><strong>Confirming your payment…</strong><span>This usually takes a few seconds.</span></div></div>
         <h2 style="margin-top:14px">Create your account</h2>`;
    const subline = app.querySelector(".auth h2 + p");
    if (subline) subline.textContent = "One last step: this is the login you'll use to manage your plan and tablets.";
    const em = app.querySelector("#su-email");
    if (em && c.email) em.value = c.email;
    const sig = app.querySelector("#si-email");
    if (sig && c.email) sig.value = c.email;
  }
  if (opts.paying) {
    app.querySelector(".auth h2").insertAdjacentHTML("afterend",
      `<div class="notice info" style="margin-top:12px">${icon("card")}<span>Create your account or sign in — the <strong>Paystack</strong> payment window opens right after.</span></div>`);
  }
  void renderSocial(store.get("st_next") || (opts.kind ? `#/signup/${opts.kind}` : ""));
  // Links from the product page: /app#/signup/school or /app#/signup/family
  if (opts.signup) {
    app.querySelector("[data-tab=signup]").click();
    if (opts.kind) app.querySelector("#su-kind").value = opts.kind;
  }
  app.querySelector("#signin").addEventListener("submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", "/v1/auth/login", { email: val("#si-email"), password: val("#si-pw") });
      store.set("st_token", r.token);
      await afterAuth();
    });
  });
  app.querySelector("#signup").addEventListener("submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", "/v1/auth/signup", {
        email: val("#su-email"), password: val("#su-pw"), displayName: val("#su-name"),
        account: { kind: val("#su-kind"), name: val("#su-org") },
      });
      store.set("st_token", r.token);
      store.set("st_org", r.orgId);
      flash("Account created.", "success");
      await afterAuth();
    });
  });
}

const val = (sel) => app.querySelector(sel).value.trim();

const stat = (iconName, tone, value, label) => `
  <div class="stat"><span class="icon-tile ${tone}">${icon(iconName)}</span>
    <div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div></div>`;

async function viewGuardianHome() {
  setCrumbs([["Home"]]);
  const students = (await api("GET", orgPath("/students"))).students;
  const consents = await Promise.all(students.map((s) => api("GET", orgPath(`/students/${s.id}/consent`))));
  const first = (state.me?.user?.display_name || "").split(" ")[0];
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">Parent view · ${h(state.org.name)}</div>
      <h1>${first ? `Hello, ${h(first)}` : "Hello"}</h1>
      <p>See the school-hours rules for your child's tablet, and choose whether to agree. You can change your mind at any time.</p>
    </section>
    <section class="card">
      ${section("users", students.length === 1 ? "Your child" : "Your children")}
      ${students.length ? `<div class="tiles">${students.map((s, i) => `<a class="tile" href="#/student/${h(s.id)}">${avatar(s.display_name, s.id)}
        <div class="grow"><div class="name">${h(s.display_name)}</div><div style="margin-top:4px">${consentBadge(consents[i].status)}</div></div>${icon("chevron")}</a>`).join("")}</div>`
        : `<p class="muted">No child is linked to your account yet.</p>`}
    </section>`;
}

async function viewHome() {
  setActiveNav("home");
  setCrumbs([["Home"]]);
  if (isGuardian()) return viewGuardianHome();
  const [students, android, billing, devices] = await Promise.all([
    api("GET", orgPath("/students")),
    api("GET", orgPath("/android")),
    isAdmin() ? api("GET", orgPath("/billing")) : Promise.resolve(null),
    isAdmin() ? api("GET", orgPath("/devices")) : Promise.resolve(null),
  ]);
  const planOk = !billing || billing.access === "full";
  const hasStudents = students.students.length > 0;
  const liveDevices = devices ? devices.devices.filter((d) => d.state !== "retired") : [];
  const activeDevices = liveDevices.filter((d) => d.state === "active").length;
  const doneSteps = [planOk, android.connected, hasStudents, activeDevices > 0].filter(Boolean).length;
  const first = (state.me?.user?.display_name || "").split(" ")[0];

  const step = (n, done, title, body) => `
    <div class="check ${done ? "done" : ""}"><div class="dot">${done ? icon("check") : n}</div>
      <div class="body"><div class="title">${title}</div>${body ? `<div class="small">${body}</div>` : ""}</div></div>`;

  const billingBody = !billing ? "" : planOk
    ? `<span class="muted">Active until ${h(fmtDay(billing.currentPeriodEnd))}.</span>`
    : `<span class="muted">Needed before adding tablets or changing rules. ${h(billing.plan === "organization" ? "Organization" : "Individual")} plan: <strong>${h(money(billing.price.amount, billing.price.currency))}/month</strong>.</span>
       <div class="row">
         <button type="button" data-action="subscribe">${icon("card")} Subscribe with Paystack</button>
         ${state.org.pilotMode ? `<button type="button" class="secondary" data-action="pilot-activate">${icon("rocket")} Activate pilot · 30 days, no payment</button>` : ""}
       </div>`;

  const androidBody = android.connected
    ? `<span class="muted">Connected to Android Enterprise.</span>`
    : !isAdmin() ? `<span class="muted">Ask your organization admin to connect Android.</span>` : `
      <ol class="steps">
        <li><button type="button" class="secondary" data-action="android-signup">${icon("external")} Open Google signup</button></li>
        <li>Sign in with a Google account. For a personal email, choose <em>Sign up for Android only</em>. Accept the agreement.</li>
        <li>On Google's last page, copy the code it shows (or the whole address) and paste it here:</li>
      </ol>
      <form id="android-complete" class="row">
        <input type="text" id="android-code" class="grow" placeholder="Paste the code or address" autocomplete="off" required>
        <button type="submit">${icon("link")} Connect</button>
      </form>`;

  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">${state.org.kind === "school" ? "School workspace" : "Family workspace"}</div>
      <h1>${first ? `Welcome back, ${h(first)}` : h(state.org.name)}</h1>
      <p>${h(state.org.name)} · Manage tablets transparently — students can always see what's managed and why.</p>
    </section>

    <div class="stats">
      ${stat("users", "", students.students.length, "Students")}
      ${devices ? stat("tablet", activeDevices ? "ok" : "", `${activeDevices}<span class="muted small"> / ${liveDevices.length}</span>`, "Tablets active") : ""}
      ${stat("android", android.connected ? "ok" : "warn", android.connected ? "Connected" : "Not yet", "Android Enterprise")}
      ${billing ? stat("card", planOk ? "ok" : "warn", planOk ? "Active" : "Inactive", billing.plan === "organization" ? "Organization plan" : "Individual plan") : ""}
    </div>

    ${isAdmin() && doneSteps < 4 ? `<section class="card">
      <div class="card-head"><span class="icon-tile">${icon("sparkles")}</span><h2>Get set up</h2><span class="sub muted small">${doneSteps} of 4 done</span></div>
      <div class="progress"><span style="width:${doneSteps * 25}%"></span></div>
      ${step(1, planOk, "Activate your plan", billingBody)}
      ${step(2, android.connected, "Connect Android", androidBody)}
      ${step(3, hasStudents, "Add a student", hasStudents ? "" : `<span class="muted">Use the Students panel below.</span>`)}
      ${step(4, activeDevices > 0, "Enroll a tablet", activeDevices ? "" : `<span class="muted">Open a student and choose “Add a tablet”.</span>`)}
    </section>` : ""}

    <section class="card">
      <div class="card-head"><span class="icon-tile">${icon("users")}</span><h2>Students</h2><span class="sub muted small hide-sm">${students.students.length} total</span>
        ${isAdmin() ? `<button type="button" class="secondary" data-action="toggle-add" style="margin-left:12px">${icon("plus")} Add student</button>` : ""}</div>
      ${isAdmin() ? `<form id="add-student" class="inline-form${hasStudents ? "" : " open"}">
        <div class="row" style="margin-top:0">
          <input type="text" id="st-name" class="grow" placeholder="Name or nickname" required maxlength="80" aria-label="Student name or nickname">
          <select id="st-age" style="width:auto" aria-label="Age group"><option value="under_13">Under 13</option><option value="13_15" selected>13–15</option><option value="16_17">16–17</option></select>
          <button type="submit">${icon("check")} Save student</button>
        </div>
        <p class="muted small" style="margin:8px 0 0">A nickname is fine — SafeTab never needs a full name or date of birth.</p>
      </form>` : ""}
      ${hasStudents ? `
        ${students.students.length > 6 ? `<div class="toolbar" style="margin-top:14px"><label class="searchbox">${icon("search")}<input type="search" id="st-search" placeholder="Search students" aria-label="Search students"></label></div>` : ""}
        <div class="table-wrap"><table class="dtable"><thead><tr><th>Student</th><th>Age group</th><th>Tablets</th>${state.org.kind === "school" ? "<th>Parent consent</th>" : ""}<th></th></tr></thead>
        <tbody id="st-rows">${students.students.map((s) => `<tr data-href="#/student/${h(s.id)}" data-name="${h(s.display_name.toLowerCase())}">
          <td><span class="cell-person">${avatar(s.display_name, s.id)}<a href="#/student/${h(s.id)}">${h(s.display_name)}</a></span></td>
          <td class="muted" data-label="Age group">${h(ageLabel(s.age_band))}</td>
          <td data-label="Tablets">${!s.tablets ? `<span class="muted small">None</span>` : s.tablets_active === s.tablets
            ? `<span class="badge ok">${h(s.tablets)} active</span>`
            : `<span class="badge warn">${h(s.tablets - s.tablets_active)} awaiting setup</span>`}</td>
          ${state.org.kind === "school" ? `<td data-label="Parent consent">${s.has_school_hours ? consentBadge(s.consent) : `<span class="muted small">No school-hours rules</span>`}</td>` : ""}
          <td class="go" style="text-align:right">${icon("chevron")}</td></tr>`).join("")}</tbody></table></div>
        <p class="muted small" id="st-none" hidden>No students match your search.</p>`
      : `<div class="empty"><span class="icon-tile">${icon("users")}</span><h3>No students yet</h3><p>${isAdmin() ? "Add your first student above to get started." : "Your admin hasn't assigned any students to you yet."}</p></div>`}
    </section>`;

  on("[data-action=toggle-add]", "click", () => {
    const f = app.querySelector("#add-student");
    f.classList.toggle("open");
    if (f.classList.contains("open")) app.querySelector("#st-name").focus();
  });
  app.querySelectorAll("#st-rows tr").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.href; }));
  on("#st-search", "input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    app.querySelectorAll("#st-rows tr").forEach((tr) => { const m = tr.dataset.name.includes(q); tr.hidden = !m; if (m) shown++; });
    app.querySelector("#st-none").hidden = shown > 0;
  });
  on("[data-action=subscribe]", "click", (e) => busy(e.currentTarget, () => startCheckout()));
  on("[data-action=pilot-activate]", "click", (e) => busy(e.currentTarget, async () => {
    await api("POST", orgPath("/billing/pilot-activate"));
    flash("Pilot activated for 30 days.", "success");
    await route();
  }));
  on("[data-action=android-signup]", "click", (e) => {
    const btn = e.currentTarget;
    const win = window.open("about:blank", "_blank"); // open synchronously to avoid pop-up blockers
    busy(btn, async () => {
      try {
        const r = await api("POST", orgPath("/android/signup"));
        if (win) { win.opener = null; win.location.href = r.signupUrl; }
        else flash("Your browser blocked the new tab. Allow pop-ups for this page and try again.");
        btn.innerHTML = `${icon("external")} Get a new Google link`;
      } catch (err) { if (win) win.close(); throw err; }
    });
  });
  on("#android-complete", "submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const raw = val("#android-code");
      const fromUrl = /[?&]enterpriseToken=([^&#\s]+)/.exec(raw)?.[1];
      await api("POST", orgPath("/android/complete"), { enterpriseToken: fromUrl ? decodeURIComponent(fromUrl) : raw });
      flash("Android connected.", "success");
      await route();
    });
  });
  on("#add-student", "submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const s = await api("POST", orgPath("/students"), { displayName: val("#st-name"), ageBand: val("#st-age") });
      location.hash = `#/student/${s.id}`;
    });
  });
}

const ageLabel = (b) => ({ under_13: "Under 13", "13_15": "Age 13–15", "16_17": "Age 16–17" }[b] || b);

function deviceBadge(s) {
  const map = { active: ["ok", "Active"], pending_enrollment: ["warn", "Waiting for setup"], lost: ["bad", "Lost · locked"], retired: ["", "Retired"] };
  const [cls, text] = map[s] || ["", s];
  return `<span class="badge ${cls}">${h(text)}</span>`;
}
function rolloutBadge(status) {
  const map = { applied: ["ok", "Rules applied"], pending: ["warn", "Rules pending"], failed: ["bad", "Rules failed"], unsupported: ["warn", "Not supported"] };
  const [cls, text] = map[status] || ["", status];
  return `<span class="badge ${cls}">${h(text)}</span>`;
}

const COMMON_APPS = [
  ["YouTube", "com.google.android.youtube"], ["TikTok", "com.zhiliaoapp.musically"], ["Instagram", "com.instagram.android"],
  ["Facebook", "com.facebook.katana"], ["Snapchat", "com.snapchat.android"], ["Netflix", "com.netflix.mediaclient"],
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const section = (iconName, title, sub = "") => `<div class="card-head"><span class="icon-tile">${icon(iconName)}</span><h2>${title}</h2>${sub ? `<span class="sub muted small">${sub}</span>` : ""}</div>`;

const isGuardian = () => state.org?.myRole === "guardian";
const isSchool = () => state.org?.kind === "school";
const APP_NAMES = Object.fromEntries(COMMON_APPS.map(([n, p]) => [p, n]));
const appName = (pkg) => APP_NAMES[pkg] || pkg;

const CONSENT_BADGE = {
  none: ["warn", "No parent consent yet"],
  active: ["ok", "Parent consent given"],
  needs_reconsent: ["warn", "Rules changed · waiting for parent"],
  withdrawn: ["bad", "Consent withdrawn"],
};
const consentBadge = (s) => { const [cls, t] = CONSENT_BADGE[s] || ["", s]; return `<span class="badge ${cls}">${h(t)}</span>`; };

function scheduleText(sh) {
  if (!sh.windows.length) return "No times set";
  return sh.windows.map((w) => {
    const d = [...w.days].sort();
    const contiguous = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    const days = d.length > 2 && contiguous ? `${DAYS[d[0] - 1]}–${DAYS[d[d.length - 1] - 1]}` : d.map((x) => DAYS[x - 1]).join(", ");
    return `${days} · ${w.start}–${w.end}`;
  }).join("; ");
}

function deviceList(devices, rolloutById, withActions) {
  if (!devices.length) return `<p class="muted">No tablets yet.</p>`;
  return devices.map((d) => {
    const r = rolloutById[d.id];
    return `<div class="device">
      <span class="icon-tile ${d.state === "active" ? "ok" : d.state === "lost" ? "bad" : "warn"}">${icon("tablet")}</span>
      <div class="meta">
        <div style="font-weight:650">${h(d.label || "Tablet")} <span class="muted small">· ${d.ownership === "family_owned" ? "parent-owned" : "school-owned"}</span></div>
        <div class="row" style="margin-top:6px">${deviceBadge(d.state)} ${r ? rolloutBadge(r.status) : ""}</div>
        ${r?.nonCompliance?.length ? `<div class="small muted" style="margin-top:6px">${r.nonCompliance.map((n) => h(`${n.settingName || n.packageName || ""} ${n.nonComplianceReason || ""}`)).join("<br>")}</div>` : ""}
        <div class="small muted" style="margin-top:6px">Last report: ${h(fmtDate(d.last_status_at))}</div>
      </div>
      ${withActions ? `<div class="actions">
        <button type="button" class="secondary icon-only" title="Mark lost (locks the tablet)" aria-label="Mark lost" data-lost="${h(d.id)}">${icon("lock")}</button>
        <button type="button" class="danger icon-only" title="Retire (erases the tablet)" aria-label="Retire" data-retire="${h(d.id)}">${icon("trash")}</button>
      </div>` : ""}
    </div>`;
  }).join("");
}

// ---------- chip inputs for apps and websites ----------
const PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,63}$/;
function parseApp(v) {
  v = v.trim();
  const fromUrl = /[?&]id=([A-Za-z0-9_.]+)/.exec(v); // a Google Play link works too
  if (fromUrl) v = fromUrl[1];
  const byName = COMMON_APPS.find(([n]) => n.toLowerCase() === v.toLowerCase());
  if (byName) v = byName[1];
  return PKG_RE.test(v) ? v : null;
}
function parseDomain(v) {
  v = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return DOMAIN_RE.test(v) ? v : null;
}
function chipsHtml(values, kind) {
  if (!values.length) return `<span class="tag-empty">${kind === "app" ? "No apps added" : "No websites added"}</span>`;
  return values.map((v) => {
    const label = kind === "app" ? appName(v) : v;
    const extra = kind === "app" && APP_NAMES[v] ? "" : kind === "app" ? "" : "";
    return `<span class="tag" data-value="${h(v)}">${h(label)}${extra}<button type="button" aria-label="Remove ${h(label)}">${icon("x")}</button></span>`;
  }).join("");
}
function tagBox(id, values, kind, placeholder, suggestions = []) {
  return `<div class="tagbox" id="${id}" data-kind="${kind}">
      <div class="tag-list">${chipsHtml(values, kind)}</div>
      <div class="tag-add"><input type="text" placeholder="${h(placeholder)}" aria-label="${h(placeholder)}"><button type="button" class="chip">${icon("plus")} Add</button></div>
    </div>
    <div class="field-error" hidden></div>
    ${suggestions.length ? `<div class="suggest" data-for="${id}">Quick add: ${suggestions.map(([n, v]) => `<button type="button" class="chip" data-value="${h(v)}">${icon("plus")} ${h(n)}</button>`).join("")}</div>` : ""}`;
}
const tagValues = (id) => [...app.querySelectorAll(`#${id} .tag`)].map((t) => t.dataset.value);
function wireTagBox(id, onChange) {
  const box = app.querySelector(`#${id}`);
  if (!box) return;
  const kind = box.dataset.kind;
  const input = box.querySelector("input");
  const err = box.nextElementSibling;
  const set = (vals) => { box.querySelector(".tag-list").innerHTML = chipsHtml(vals, kind); onChange(); };
  const add = (raw) => {
    const v = kind === "app" ? parseApp(raw) : parseDomain(raw);
    if (!v) {
      err.textContent = kind === "app" ? "Enter an app name like TikTok, a Google Play link, or an app ID like com.example.app" : "Enter a website like example.com";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    const vals = tagValues(id);
    if (!vals.includes(v)) set([...vals, v]);
    input.value = "";
  };
  box.addEventListener("click", (e) => {
    const rm = e.target.closest(".tag button");
    if (rm) { const v = rm.closest(".tag").dataset.value; set(tagValues(id).filter((x) => x !== v)); return; }
    if (e.target.closest(".tag-add button")) add(input.value);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (input.value.trim()) add(input.value); } });
  app.querySelectorAll(`[data-for="${id}"] [data-value]`).forEach((b) => b.addEventListener("click", () => add(b.dataset.value)));
}

function scheduleSummary(w) {
  if (!w) return "";
  const d = [...w.days].sort();
  const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  return `${run ? `${DAYS[d[0] - 1]}–${DAYS[d[d.length - 1] - 1]}` : d.map((x) => DAYS[x - 1]).join(", ")} · ${w.start}–${w.end}`;
}

async function viewStudent(studentId, tab = "overview") {
  setActiveNav("home");
  const [student, policy, consent] = await Promise.all([
    api("GET", orgPath(`/students/${studentId}`)),
    api("GET", orgPath(`/students/${studentId}/policy`)),
    api("GET", orgPath(`/students/${studentId}/consent`)),
  ]);
  setCrumbs([["Home", "#/"], ["Students", "#/"], [student.display_name]]);
  if (isGuardian()) return renderGuardianStudent(studentId, student, policy, consent);

  const spec = policy.spec;
  const companionOff = !state.org.companionAppEnabled;
  const school = isSchool();
  const devices = student.devices.filter((d) => d.state !== "retired");
  const familyDevices = devices.filter((d) => d.ownership === "family_owned");
  const rolloutById = Object.fromEntries(policy.rollout.map((r) => [r.deviceId, r]));
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const tz = spec.downtime.timezone !== "UTC" ? spec.downtime.timezone : localTz;
  const shTz = spec.schoolHours.timezone !== "UTC" ? spec.schoolHours.timezone : localTz;
  const win = spec.downtime.windows[0] || { days: [1, 2, 3, 4, 5], start: "21:00", end: "06:30" };
  const shWin = spec.schoolHours.windows[0] || { days: [1, 2, 3, 4, 5], start: "07:30", end: "15:00" };
  const schoolOnly = school ? `<span class="badge scope">School-owned tablets only</span>` : "";
  const base = `#/student/${studentId}`;

  const head = `
    <div class="ph"><div class="page-head" style="margin:0">${avatar(student.display_name, student.id, "lg")}
      <div><h1>${h(student.display_name)}</h1><p class="muted">${h(ageLabel(student.age_band))} · ${devices.length} tablet${devices.length === 1 ? "" : "s"}${school && consent.hasRules ? ` · ${consentBadge(consent.status)}` : ""}</p></div></div></div>
    <nav class="tabbar" aria-label="Student sections">
      <a href="${base}" class="${tab === "overview" ? "on" : ""}">${icon("layers")} Overview</a>
      <a href="${base}/rules" class="${tab === "rules" ? "on" : ""}">${icon("shield")} Rules</a>
    </nav>`;

  if (tab === "overview") {
    const active = [];
    if (spec.schoolHours.enabled && spec.schoolHours.blockedApps.length) active.push(["clock", "School hours", `${scheduleSummary(spec.schoolHours.windows[0])} · ${spec.schoolHours.blockedApps.map(appName).join(", ")} off`]);
    if (spec.apps.packages.length) active.push(["ban", spec.apps.mode === "allowlist" ? "Only allowed apps" : "Blocked apps", spec.apps.packages.map(appName).join(", ")]);
    if (spec.web.mode !== "off") active.push(["globe", spec.web.mode === "allowlist" ? "Only allowed websites" : "Blocked websites", spec.web.domains.join(", ") || "None listed"]);
    if (spec.downtime.enabled) active.push(["moon", "Downtime", scheduleSummary(spec.downtime.windows[0])]);
    if (spec.usageSummaries.enabled) active.push(["chart", "Screen-time summary", "Daily minutes per app"]);

    app.innerHTML = head + `
      <section class="card">
        <div class="card-head"><span class="icon-tile">${icon("tablet")}</span><h2>Tablets</h2><span class="sub muted small">Reports every few minutes</span>
          ${isAdmin() ? `<button type="button" class="secondary" data-action="toggle-device" style="margin-left:12px">${icon("plus")} Add a tablet</button>` : ""}</div>
        ${isAdmin() ? `<div id="add-device" class="inline-form${devices.length ? "" : " open"}">
          <div class="row" style="margin-top:0">
            <input type="text" id="dev-label" class="grow" placeholder="Tablet name, e.g. ${h(student.display_name.split(" ")[0])}'s tablet" maxlength="80" aria-label="Tablet name">
            <select id="dev-own" style="width:auto" aria-label="Who owns the tablet">${school
              ? `<option value="family_owned">Parent-owned (needs consent)</option><option value="school_owned">School-owned</option>`
              : `<option value="family_owned">Our family's tablet</option>`}</select>
            <button type="button" data-action="add-device">${icon("qr")} Create QR code</button>
          </div></div>` : ""}
        ${devices.length ? deviceList(devices, rolloutById, isAdmin()) : `<div class="empty"><span class="icon-tile">${icon("tablet")}</span><h3>No tablets yet</h3><p>${isAdmin() ? "Create a QR code above, then scan it during the tablet's setup." : "Your admin adds tablets."}</p></div>`}
        ${devices.some((d) => rolloutById[d.id]?.status === "pending") ? `<div class="notice info">${icon("info")}<span>“Rules pending” means the change was sent and SafeTab is waiting for the tablet to confirm it.</span></div>` : ""}
        ${consent.status === "withdrawn" && familyDevices.length ? `<div class="notice">${icon("alert")}<span>The parent withdrew consent, so school-hours rules have stopped. Retire the parent-owned tablet to release it — this resets it, so let the family back it up first.</span></div>` : ""}
        <div id="qr-panel"></div>
      </section>

      <div class="billing-grid">
        <section class="card">
          <div class="card-head"><span class="icon-tile">${icon("shield")}</span><h2>Active rules</h2><a class="sub small" href="${base}/rules">Edit rules →</a></div>
          ${active.length ? `<ul class="summary-list">${active.map(([ic, t, d]) => `<li><span class="icon-tile">${icon(ic)}</span><div><strong>${h(t)}</strong><span>${h(d)}</span></div></li>`).join("")}</ul>`
            : `<div class="empty"><span class="icon-tile">${icon("shield")}</span><h3>No rules yet</h3><p><a href="${base}/rules">Set up rules</a> for ${h(student.display_name.split(" ")[0])}'s tablet.</p></div>`}
        </section>
        ${school ? `<section class="card">
          <div class="card-head"><span class="icon-tile">${icon("users")}</span><h2>Parents &amp; consent</h2></div>
          <div class="row" style="margin-top:0">${consentBadge(consent.status)}
            ${consent.consent ? `<span class="muted small">${h(consent.consent.signatureName)} · ${consent.status === "withdrawn" ? `withdrawn ${h(fmtDay(consent.consent.withdrawnAt))}` : `agreed ${h(fmtDay(consent.consent.grantedAt))}`}</span>` : ""}</div>
          <p class="muted small">Parent-owned tablets get only the school-hours rules, and only after a parent agrees in their own login.</p>
          ${consent.guardians.length ? `<ul class="summary-list">${consent.guardians.map((g) => `<li>${avatar(g.display_name, g.email)}<div><strong>${h(g.display_name)}</strong><span>${h(g.email)}</span></div></li>`).join("")}</ul>` : `<p class="muted">No parent linked yet.</p>`}
          ${isAdmin() ? `<form id="invite-parent" class="row"><input type="email" id="parent-email" class="grow" placeholder="Parent's email address" required aria-label="Parent's email address"><button type="submit" class="secondary">${icon("plus")} Invite</button></form><div id="invite-result"></div>` : ""}
        </section>` : ""}
      </div>`;
  } else {
    app.innerHTML = head + `
      <form id="policy">
        ${school ? `<section class="card">
          <div class="rule-head"><span class="icon-tile">${icon("clock")}</span><div><h2>School hours</h2><p>Switch apps off during lessons. Apps aren't deleted. The only rules that apply to parent-owned tablets.</p></div></div>
          ${consent.hasRules ? "" : `<div class="notice">${icon("info")}<span>Parents can agree once this is switched on with at least one app, and saved.</span></div>`}
          <label class="switch"><input type="checkbox" id="sh-on" ${spec.schoolHours.enabled ? "checked" : ""}> Switch off apps during school hours</label>
          <div class="days">${DAYS.map((d, i) => `<label><input type="checkbox" data-sday="${i + 1}" ${shWin.days.includes(i + 1) ? "checked" : ""}><span>${d}</span></label>`).join("")}</div>
          <div class="row">
            <label style="margin:0">From <input type="time" id="sh-start" value="${h(shWin.start)}" style="width:auto;margin-left:6px"></label>
            <label style="margin:0">until <input type="time" id="sh-end" value="${h(shWin.end)}" style="width:auto;margin-left:6px"></label>
            <span class="muted small">${h(shTz)}</span>
          </div>
          <label>Apps to switch off</label>
          ${tagBox("sh-apps", spec.schoolHours.blockedApps, "app", "Type an app name or paste a Google Play link", COMMON_APPS)}
          <p class="muted small">Changing these rules asks parents to agree again before they apply to parent-owned tablets.</p>
        </section>` : ""}

        <section class="card">
          <div class="rule-head"><span class="icon-tile">${icon("ban")}</span><div><h2>Apps</h2><p>Always-on app rules.</p></div>${schoolOnly}</div>
          <div class="segmented" role="radiogroup" aria-label="App rule">
            <label><input type="radio" name="apps-mode" value="blocklist" ${spec.apps.mode === "blocklist" ? "checked" : ""}><span>Block these apps</span></label>
            <label><input type="radio" name="apps-mode" value="allowlist" ${spec.apps.mode === "allowlist" ? "checked" : ""}><span>Allow only these apps</span></label>
          </div>
          <div style="margin-top:12px">${tagBox("apps", spec.apps.packages, "app", "Type an app name or paste a Google Play link", COMMON_APPS)}</div>
        </section>

        <section class="card">
          <div class="rule-head"><span class="icon-tile">${icon("globe")}</span><div><h2>Websites</h2><p>Applies in Chrome.</p></div>${schoolOnly}</div>
          <div class="segmented" role="radiogroup" aria-label="Website rule">
            ${[["off", "No rules"], ["blocklist", "Block these sites"], ["allowlist", "Allow only these sites"]].map(([v, t]) =>
              `<label><input type="radio" name="web-mode" value="${v}" ${spec.web.mode === v ? "checked" : ""}><span>${t}</span></label>`).join("")}
          </div>
          <div style="margin-top:12px">${tagBox("domains", spec.web.domains, "domain", "Type a website, e.g. example.com")}</div>
        </section>

        <section class="card">
          <div class="rule-head"><span class="icon-tile">${icon("moon")}</span><div><h2>Downtime</h2><p>Rest hours, e.g. at night.</p></div>${schoolOnly}</div>
          ${companionOff ? `<div class="notice">${icon("info")}<span>Downtime needs the SafeTab student app, which isn't available yet. You can set it now — it takes effect once the app is enabled.</span></div>` : ""}
          <label class="switch"><input type="checkbox" id="dt-on" ${spec.downtime.enabled ? "checked" : ""}> Turn on downtime</label>
          <div class="days">${DAYS.map((d, i) => `<label><input type="checkbox" data-day="${i + 1}" ${win.days.includes(i + 1) ? "checked" : ""}><span>${d}</span></label>`).join("")}</div>
          <div class="row">
            <label style="margin:0">From <input type="time" id="dt-start" value="${h(win.start)}" style="width:auto;margin-left:6px"></label>
            <label style="margin:0">until <input type="time" id="dt-end" value="${h(win.end)}" style="width:auto;margin-left:6px"></label>
            <span class="muted small">${h(tz)}</span>
          </div>
        </section>

        <section class="card">
          <div class="rule-head"><span class="icon-tile">${icon("chart")}</span><div><h2>Screen-time summary</h2><p>Daily minutes per app. Never messages, screens or browsing history.</p></div>${schoolOnly}</div>
          ${companionOff ? `<div class="notice">${icon("info")}<span>Also needs the SafeTab student app. Nothing is collected until then.</span></div>` : ""}
          <label class="switch"><input type="checkbox" id="usage-on" ${spec.usageSummaries.enabled ? "checked" : ""}> Collect daily minutes per app</label>
        </section>

        <div class="savebar" id="savebar">
          <span class="state" id="save-state">${icon("check")} All changes saved</span>
          <button type="button" class="secondary" data-action="discard" hidden>Discard</button>
          <button type="submit">${icon("save")} Save rules</button>
        </div>
      </form>`;
  }

  // ---- Overview actions ----
  on("[data-action=toggle-device]", "click", () => { const f = app.querySelector("#add-device"); f.classList.toggle("open"); });
  on("[data-action=add-device]", "click", (e) => busy(e.currentTarget, async () => {
    const r = await api("POST", orgPath(`/students/${studentId}/devices`), { ownership: val("#dev-own"), label: val("#dev-label") || undefined });
    showQr(r);
  }));
  on("[data-lost]", "click", (e) => { const id = e.currentTarget.dataset.lost; busy(e.currentTarget, async () => {
    if (!confirm("Mark this tablet as lost? It will be locked and disconnected from SafeTab's student app.")) return;
    await api("POST", orgPath(`/devices/${id}/lost`), {});
    flash("Tablet locked and marked lost.", "success");
    await route();
  }); });
  on("[data-retire]", "click", (e) => { const id = e.currentTarget.dataset.retire; busy(e.currentTarget, async () => {
    if (!confirm("Retire this tablet? It will be ERASED (factory reset) and removed from management. This cannot be undone.")) return;
    await api("POST", orgPath(`/devices/${id}/retire`), { confirmWipe: true });
    flash("Tablet retired.", "success");
    await route();
  }); });
  on("#invite-parent", "submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", orgPath("/invitations"), { email: val("#parent-email"), role: "guardian", studentId });
      const box = app.querySelector("#invite-result");
      box.innerHTML = r.acceptUrl
        ? `<div class="notice info">${icon("link")}<span>Send this link to the parent (email or WhatsApp). It works once, for 3 days, and only for that email address:<br>
            <input type="text" readonly value="${h(r.acceptUrl)}" style="margin-top:8px" aria-label="Invitation link"></span></div>`
        : `<div class="notice info">${icon("check")}<span>Invitation created.</span></div>`;
      box.querySelector("input")?.select();
    });
  });

  // ---- Rules form ----
  const form = app.querySelector("#policy");
  if (!form) return;
  let dirty = false;
  const markDirty = () => {
    if (dirty) return;
    dirty = true;
    app.querySelector("#savebar").classList.add("dirty");
    app.querySelector("#save-state").innerHTML = `${icon("edit")} Unsaved changes`;
    app.querySelector("[data-action=discard]").hidden = false;
  };
  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  ["sh-apps", "apps", "domains"].forEach((id) => wireTagBox(id, markDirty));
  on("[data-action=discard]", "click", () => route());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const days = [...app.querySelectorAll("[data-day]")].filter((c) => c.checked).map((c) => Number(c.dataset.day));
      const newSpec = {
        apps: { mode: app.querySelector("input[name=apps-mode]:checked").value, packages: tagValues("apps") },
        web: { mode: app.querySelector("input[name=web-mode]:checked").value, domains: tagValues("domains") },
        downtime: { enabled: app.querySelector("#dt-on").checked, timezone: tz, windows: days.length ? [{ days, start: val("#dt-start"), end: val("#dt-end") }] : [] },
        usageSummaries: { enabled: app.querySelector("#usage-on").checked },
        schoolHours: spec.schoolHours,
      };
      if (app.querySelector("#sh-on")) {
        const sdays = [...app.querySelectorAll("[data-sday]")].filter((c) => c.checked).map((c) => Number(c.dataset.sday));
        newSpec.schoolHours = { enabled: app.querySelector("#sh-on").checked, timezone: shTz,
          windows: sdays.length ? [{ days: sdays, start: val("#sh-start"), end: val("#sh-end") }] : [], blockedApps: tagValues("sh-apps") };
      }
      const r = await api("PUT", orgPath(`/students/${studentId}/policy`), { spec: newSpec, expectedVersion: policy.version });
      dirty = false;
      flash(r.deployments.length ? "Rules saved and sent. Tablets show “Rules pending” until they confirm." : "Rules saved.", "success");
      await route();
    });
  });
}

function renderGuardianStudent(studentId, student, policy, consent) {
  const sh = policy.spec.schoolHours;
  const devices = student.devices.filter((d) => d.state !== "retired");
  const rolloutById = Object.fromEntries(policy.rollout.map((r) => [r.deviceId, r]));
  const canAgree = consent.hasRules && consent.status !== "active";

  app.innerHTML = `
    <p><a href="#/" class="small">${icon("back")} Home</a></p>
    <div class="page-head">${avatar(student.display_name, student.id, "lg")}
      <div><h1>${h(student.display_name)}</h1><p class="muted">${h(state.org.name)}</p></div></div>

    <section class="card">
      ${section("clock", "School-hours rules", consent.hasRules ? h(sh.timezone) : "")}
      ${consent.hasRules ? `
        <p style="margin-top:0"><strong>${h(scheduleText(sh))}</strong></p>
        <p class="muted small">During these hours these apps are switched off (not deleted):</p>
        <div class="row" style="margin-top:6px">${sh.blockedApps.map((p) => `<span class="badge">${h(appName(p))}</span>`).join("")}</div>
        <p class="muted small">Outside these hours the school does not restrict the tablet. The school can't see messages, photos, files, screens, location, browsing history or which apps are used.</p>`
        : `<div class="notice">${icon("info")}<span><strong>Nothing to agree to yet.</strong> The school hasn't saved any school-hours rules for ${h(student.display_name)}. Once it does, refresh this page and the consent form appears here.</span></div>`}
    </section>

    <section class="card">
      ${section("shield", "Your consent")}
      <div class="row" style="margin-top:0">${consentBadge(consent.status)}
        ${consent.consent && consent.status !== "none" ? `<span class="muted small">${h(consent.consent.signatureName)} · ${consent.status === "withdrawn" ? `withdrawn ${h(fmtDate(consent.consent.withdrawnAt))}` : `agreed ${h(fmtDate(consent.consent.grantedAt))}`}</span>` : ""}</div>
      ${consent.status === "needs_reconsent" ? `<div class="notice">${icon("alert")}<span>The school changed the rules. They are <strong>not</strong> applied to the tablet until you agree to the new version below.</span></div>` : ""}
      ${consent.consentText ? `<div class="consent-text">${h(consent.consentText)}</div>` : ""}
      ${canAgree ? `<form id="consent-form">
        <label for="sig">Type your full name to sign</label>
        <input type="text" id="sig" required minlength="2" maxlength="120" autocomplete="name">
        <label class="agree"><input type="checkbox" id="agree" required> <span>I have read this and I agree</span></label>
        <div class="row"><button type="submit">${icon("check")} I agree</button></div>
      </form>` : ""}
      ${consent.status === "active" ? `<div class="row"><button type="button" class="danger" data-action="withdraw">${icon("ban")} Withdraw consent</button>
        <span class="muted small">The school-hours rules stop straight away.</span></div>` : ""}
    </section>

    <section class="card">
      ${section("tablet", "Tablet")}
      ${deviceList(devices, rolloutById, false)}
      <p class="muted small">After you agree, the school enrolls the tablet. This needs a <strong>one-time reset</strong>, so back up photos and files first. While enrolled, the tablet shows that it is managed.</p>
    </section>`;

  on("#consent-form", "submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      if (!app.querySelector("#agree").checked) throw new Error("Please tick “I have read this and I agree”.");
      await api("POST", orgPath(`/students/${studentId}/consent`), { signatureName: val("#sig"), agree: true });
      flash("Thank you — your consent is recorded.", "success");
      await route();
    });
  });
  on("[data-action=withdraw]", "click", (e) => busy(e.currentTarget, async () => {
    if (!confirm("Withdraw consent? The school-hours rules stop straight away. To remove management completely, the school resets the tablet.")) return;
    await api("POST", orgPath(`/students/${studentId}/consent/withdraw`));
    flash("Consent withdrawn. The school-hours rules have stopped.", "success");
    await route();
  }));
}

function showQr(r) {
  const panel = app.querySelector("#qr-panel");
  panel.innerHTML = `
    <div class="card" style="margin:18px 0 0;background:var(--surface-2)">
      ${section("qr", "Set up the tablet", `works once · until ${h(fmtDate(r.expiresAt))}`)}
      <div class="qr-wrap">
        <div class="qr-frame"><img src="${h(r.qrPng)}" alt="Enrollment QR code"></div>
        <div>
          <ol class="steps">
            <li><strong>Factory-reset</strong> the tablet: Settings → System → Reset options → Erase all data. <em>This erases everything on it.</em></li>
            <li>On the very first <strong>Welcome</strong> screen, <strong>tap the same empty spot 6 times</strong>. A QR setup message appears (connect to Wi-Fi if asked).</li>
            <li>Scan <strong>this</strong> code with the tablet's setup scanner — not a normal camera app.</li>
            <li>Follow the steps. The tablet will say it belongs to your organization.</li>
            <li>Come back here: it shows <span class="badge ok">Active</span> within about 5 minutes (reload the page).</li>
          </ol>
          <div class="notice info">${icon("info")}<span>If 6 taps do nothing: continue to Google sign-in and type <code>afw#setup</code> as the email.</span></div>
          <div class="notice">${icon("alert")}<span>Don't share this code — anyone who scans it can add a device to your organization.</span></div>
        </div>
      </div>
    </div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

const ACTION_LABELS = {
  "org.created": "Organization created", "billing.pilot_activated": "Pilot activated", "android.signup_started": "Android signup started",
  "android.connected": "Android connected", "student.created": "Student added", "device.enrollment_created": "Tablet enrollment created",
  "device.enrolled": "Tablet enrolled", "policy.updated": "Rules changed", "activity.viewed": "Activity viewed",
  "device.marked_lost": "Tablet marked lost", "device.retired": "Tablet retired", "student.exported": "Student data exported",
  "student.deleted": "Student deleted", "member.joined": "Member joined", "invitation.created": "Invitation sent",
  "consent.granted": "Parent gave consent", "consent.withdrawn": "Parent withdrew consent", "billing.payment_verified": "Payment confirmed",
  "billing.checkout_started": "Payment started", "billing.cancelled": "Subscription cancelled", "billing.purchase_claimed": "Paid plan activated",
  "org.android_enterprise_set": "Android connected", "auth.signed_in_with_provider": "Signed in with Google/Microsoft", "org.settings_updated": "Settings changed",
};

const ACTION_ICON = { "policy.updated": "shield", "consent.granted": "check", "consent.withdrawn": "ban", "activity.viewed": "eye", "student.created": "users",
  "device.enrollment_created": "qr", "device.enrolled": "tablet", "device.marked_lost": "lock", "device.retired": "trash", "billing.payment_verified": "card",
  "billing.checkout_started": "card", "billing.cancelled": "card", "billing.purchase_claimed": "card", "billing.pilot_activated": "rocket", "member.joined": "users",
  "invitation.created": "link", "android.connected": "android", "org.android_enterprise_set": "android", "auth.signed_in_with_provider": "lock" };
const humanize = (a) => { const t = a.replace(/[._]/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };

async function viewAudit() {
  setActiveNav("audit");
  setCrumbs([["Home", "#/"], ["Activity log"]]);
  const r = await api("GET", orgPath("/audit?limit=200"));
  const byDay = new Map();
  for (const e of r.entries) {
    const d = new Date(e.created_at);
    const key = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }
  const who = (e) => e.actor_type === "user" ? (e.actor_name || "A staff member") : e.actor_type === "device" ? "A tablet" : "SafeTab";
  app.innerHTML = `
    <div class="ph"><div><h1>Activity log</h1><p>Every sensitive action, including who viewed a student's information.</p></div></div>
    <section class="card">
      ${r.entries.length ? [...byDay].map(([day, items]) => `<div class="day">${h(day)}</div>${items.map((e) => `
        <div class="event"><span class="icon-tile">${icon(ACTION_ICON[e.action] || "activity")}</span>
          <div class="what"><strong>${h(ACTION_LABELS[e.action] || humanize(e.action))}</strong>${e.target_name ? ` · ${h(e.target_name)}` : ""}
            <div class="who">${h(who(e))}</div></div>
          <time datetime="${h(e.created_at)}">${h(new Date(e.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }))}</time></div>`).join("")}`).join("")
      : `<div class="empty"><span class="icon-tile">${icon("activity")}</span><h3>Nothing yet</h3><p>Actions like adding students or changing rules will appear here.</p></div>`}
    </section>`;
}

async function viewPrivacy() {
  setActiveNav("privacy");
  setCrumbs([["Home", "#/"], ["What we collect"]]);
  const r = await api("GET", orgPath("/data-inventory"));
  app.innerHTML = `
    <div class="page-head"><span class="icon-tile ok" style="width:48px;height:48px">${icon("shield")}</span>
      <div><h1>What SafeTab collects</h1><p class="muted">The same information students see on their tablet.</p></div></div>
    <section class="card">${section("eye", "Collected")}
      <div class="table-wrap"><table><thead><tr><th>What</th><th>Why</th><th>Who can see it</th><th>Kept for</th></tr></thead><tbody>
      ${r.collected.map((c) => `<tr><td><strong>${h(c.item)}</strong></td><td>${h(c.purpose)}</td><td>${h(c.visibleTo)}</td><td>${h(c.retention)}</td></tr>`).join("")}
      </tbody></table></div></section>
    <section class="card">${section("eyeoff", "Never collected")}
      <ul class="nope">${r.notCollected.map((n) => `<li>${icon("check")}<span>${h(n[0].toUpperCase() + n.slice(1))}</span></li>`).join("")}</ul></section>`;
}

function viewInvite(inviteToken) {
  sidebar.hidden = true;
  const signedIn = !!store.get("st_token");
  app.innerHTML = authScreen(`
      <h2>You've been invited</h2>
      <p class="muted small" style="margin:0">Accept to see your child's school-hours rules and choose whether to agree. Nothing changes on the tablet until you agree.</p>
      ${signedIn ? `<div class="row"><button type="button" class="full" data-action="accept-signed-in">${icon("check")} Accept invitation</button></div>` : `
      <div id="social" class="social"></div>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-tab="new">New account</button>
        <button type="button" role="tab" aria-selected="false" data-tab="existing">I have an account</button>
      </div>
      <form id="inv-new">
        <label for="inv-name">Your full name</label><input id="inv-name" type="text" autocomplete="name" required maxlength="120">
        <label for="inv-pw">Choose a password <span class="muted small">· at least 12 characters</span></label>
        <input id="inv-pw" type="password" autocomplete="new-password" minlength="12" required>
        <p class="muted small" style="margin:8px 0 0">Your account uses the email address the invitation was sent to.</p>
        <div class="row"><button type="submit" class="full">Create account & accept</button></div>
      </form>
      <form id="inv-existing" hidden>
        <label for="inv-email">Email</label><input id="inv-email" type="email" autocomplete="username" required>
        <label for="inv-pw2">Password</label><input id="inv-pw2" type="password" autocomplete="current-password" required>
        <div class="row"><button type="submit" class="full">Sign in & accept</button></div>
      </form>`}`);

  if (!signedIn) void renderSocial(`#/invite/${inviteToken}`);
  const finish = async (r) => {
    if (r.token) store.set("st_token", r.token);
    store.set("st_org", r.orgId);
    state.org = null;
    flash("Invitation accepted.", "success");
    location.hash = "#/";
  };
  const acceptWithSession = async () => {
    state.token = store.get("st_token");
    await finish(await api("POST", "/v1/invitations/accept", { token: inviteToken }));
  };
  app.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    app.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    app.querySelector("#inv-new").hidden = b.dataset.tab !== "new";
    app.querySelector("#inv-existing").hidden = b.dataset.tab !== "existing";
  }));
  on("[data-action=accept-signed-in]", "click", (e) => busy(e.currentTarget, acceptWithSession));
  on("#inv-new", "submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      state.token = null;
      await finish(await api("POST", "/v1/invitations/accept", { token: inviteToken, displayName: val("#inv-name"), password: val("#inv-pw") }));
    });
  });
  on("#inv-existing", "submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", "/v1/auth/login", { email: val("#inv-email"), password: val("#inv-pw2") });
      store.set("st_token", r.token);
      await acceptWithSession();
    });
  });
}

async function afterAuth() {
  const next = store.get("st_next");
  store.set("st_next", null);
  state.org = null;
  const target = next || "#/";
  if (target !== location.hash) location.hash = target; // hashchange re-renders
  else await route();
}

/** Loads Paystack's official pop-up script (InlineJS v2) once. Resolves false on failure. */
let paystackLoading;
function loadPaystack() {
  if (window.PaystackPop) return Promise.resolve(true);
  paystackLoading ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://js.paystack.co/v2/inline.js";
    s.async = true;
    const timer = setTimeout(() => resolve(false), 10000);
    s.onload = () => { clearTimeout(timer); resolve(!!window.PaystackPop); };
    s.onerror = () => { clearTimeout(timer); resolve(false); };
    document.head.appendChild(s);
  }).then((ok) => { if (!ok) paystackLoading = undefined; return ok; });
  return paystackLoading;
}

/**
 * Starts payment: the server creates the Paystack transaction (amount and plan come from
 * server config), then Paystack's pop-up opens over the page. If the pop-up can't load,
 * fall back to Paystack's full-page checkout. Payment is only trusted after the server
 * verifies it with Paystack (billing return screen + webhook).
 */
async function startCheckout() {
  flashEl.innerHTML = "";
  const r = await api("POST", orgPath("/billing/checkout"));
  const ok = await loadPaystack();
  if (!ok) { location.href = r.authorizationUrl; return; }
  try {
    const popup = new window.PaystackPop();
    popup.resumeTransaction(r.accessCode, {
      onSuccess: () => { flashEl.innerHTML = ""; location.hash = `#/billing/return/${r.reference}`; },
      onCancel: () => flash("Payment window closed. No payment was taken — you can try again any time.", "info"),
      onError: () => { location.href = r.authorizationUrl; },
    });
  } catch {
    location.href = r.authorizationUrl;
  }
}

async function viewSubscribe() {
  setActiveNav("billing");
  setCrumbs([["Home", "#/"], ["Billing", "#/billing"], ["Subscribe"]]);
  if (!isAdmin()) {
    app.innerHTML = `<section class="card" style="max-width:520px;margin:40px auto;text-align:center"><h2>Only an admin can manage billing</h2>
      <p class="muted">Ask your organization's admin to subscribe.</p><div class="row" style="justify-content:center"><a class="button" href="#/">Go to Home</a></div></section>`;
    return;
  }
  const billing = await api("GET", orgPath("/billing"));
  const wanted = store.get("st_want_plan");
  store.set("st_want_plan", null);
  const planName = billing.plan === "organization" ? "Organization" : "Individual";
  const active = billing.access === "full" && billing.status === "active";
  const mismatch = wanted && wanted !== billing.plan;
  app.innerHTML = `
    <section class="card" style="max-width:560px;margin:32px auto">
      ${section("card", `${planName} plan`, "billed monthly")}
      <p style="font-size:2.4rem;font-weight:800;margin:4px 0 2px;letter-spacing:-.02em">${h(money(billing.price.amount, billing.price.currency))}<span class="muted" style="font-size:1rem;font-weight:600"> / month</span></p>
      <p class="muted small">Up to ${h(billing.limits.students)} ${billing.plan === "organization" ? "students" : "children"} and ${h(billing.limits.devices)} tablets.</p>
      ${mismatch ? `<div class="notice info">${icon("info")}<span>Your workspace is a ${state.org.kind === "school" ? "school" : "family"} workspace, so the <strong>${planName}</strong> plan applies.</span></div>` : ""}
      ${active
        ? `<div class="notice" style="background:var(--ok-bg);color:var(--ok)">${icon("check")}<span>Your plan is already active until ${h(fmtDay(billing.currentPeriodEnd))}.</span></div>
           <div class="row"><a class="button" href="#/">Go to Home</a></div>`
        : `<div class="row"><button type="button" class="full" data-action="pay">${icon("lock")} Pay ${h(money(billing.price.amount, billing.price.currency))} with Paystack</button></div>
           <p class="muted small" style="text-align:center;margin-top:10px">You pay in Paystack's secure window — SafeTab never sees your card details.</p>`}
    </section>`;
  if (!active) {
    const btn = app.querySelector("[data-action=pay]");
    btn.addEventListener("click", () => busy(btn, () => startCheckout()));
    busy(btn, () => startCheckout()); // open the Paystack window straight away
  }
}

async function viewBilling() {
  setActiveNav("billing");
  setCrumbs([["Home", "#/"], ["Billing"]]);
  if (!isAdmin()) { location.hash = "#/"; return; }
  const [b, hist] = await Promise.all([api("GET", orgPath("/billing")), api("GET", orgPath("/billing/history"))]);
  const planName = b.plan === "organization" ? "Organization" : "Individual";
  const statusView = {
    active: ["ok", "Active", `Renews on ${fmtDay(b.currentPeriodEnd)}`],
    non_renewing: ["warn", "Ends soon", `Access until ${fmtDay(b.currentPeriodEnd)}`],
    cancelled: ["warn", "Cancelled", b.access === "full" ? `Access until ${fmtDay(b.currentPeriodEnd)}` : "Subscribe again to continue"],
    past_due: ["bad", "Payment failed", `Update your card before ${fmtDay(b.graceUntil)} to avoid interruption`],
    lapsed: ["bad", "Inactive", "Changes are paused until you subscribe again. Your data is safe."],
    none: ["warn", "Not subscribed", "Subscribe to add tablets and set rules"],
  }[b.status] || ["", b.status, ""];
  const canPay = b.access !== "full" || b.status === "cancelled" || b.status === "non_renewing";
  const statusLabel = { success: ["ok", "Paid"], failed: ["bad", "Failed"], abandoned: ["", "Not completed"], initialized: ["warn", "Started"] };

  app.innerHTML = `
    <div class="page-head"><span class="icon-tile" style="width:48px;height:48px">${icon("card")}</span>
      <div><h1>Billing</h1><p class="muted">Your plan, payments and card — processed securely by Paystack.</p></div></div>

    <div class="billing-grid">
      <section class="card plan-card">
        <div class="row" style="margin:0;justify-content:space-between">
          <div><div class="eyebrow">Current plan</div><h2 style="font-size:1.4rem;margin-top:4px">${h(planName)}</h2></div>
          <span class="badge ${statusView[0]}">${h(statusView[1])}</span>
        </div>
        <p class="price-line">${h(money(b.price.amount, b.price.currency))}<span class="muted"> / month</span></p>
        <p class="muted small">${h(statusView[2])}</p>
        <ul class="plan-limits">
          <li>${icon("users")} Up to ${h(b.limits.students)} ${b.plan === "organization" ? "students" : "children"}</li>
          <li>${icon("tablet")} Up to ${h(b.limits.devices)} tablets</li>
          <li>${icon("shield")} ${h(b.limits.members)} staff logins${b.plan === "organization" ? " + unlimited parent logins" : ""}</li>
        </ul>
        <div class="row">
          ${canPay ? `<button type="button" data-action="pay">${icon("lock")} ${b.status === "none" ? "Subscribe" : "Pay now"} with Paystack</button>` : ""}
          ${b.hasPaystackSubscription && !canPay ? `<button type="button" class="secondary" data-action="manage">${icon("card")} Update card</button>` : ""}
          ${b.hasPaystackSubscription && b.status === "active" ? `<button type="button" class="danger" data-action="cancel">${icon("ban")} Cancel subscription</button>` : ""}
        </div>
      </section>

      <section class="card">
        ${section("lock", "Secure payments")}
        <p class="muted small" style="margin-top:0">You pay on Paystack's secure checkout. SafeTab never sees or stores your card details, and every payment is confirmed directly with Paystack before your plan changes.</p>
        <ul class="plan-limits">
          <li>${icon("check")} Cancel any time — keep access until the end of the paid month</li>
          <li>${icon("check")} ${h(String(7))}-day grace period if a renewal fails</li>
          <li>${icon("check")} Your data is never deleted because of a missed payment</li>
        </ul>
        <p class="small"><a href="/refunds" target="_blank" rel="noopener">Refund policy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></p>
      </section>
    </div>

    <section class="card">
      ${section("activity", "Payment history")}
      ${hist.payments.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>
        ${hist.payments.map((p) => { const [cls, t] = statusLabel[p.status] || ["", p.status]; return `<tr>
          <td>${h(fmtDay(p.verified_at || p.created_at))}</td><td>${h(p.plan === "organization" ? "Organization" : "Individual")}</td>
          <td>${h(money(p.amount, p.currency))}</td><td><span class="badge ${cls}">${h(t)}</span></td><td class="small muted"><code>${h(p.reference)}</code></td></tr>`; }).join("")}
      </tbody></table></div>` : `<p class="muted">No payments yet.</p>`}
    </section>`;

  on("[data-action=pay]", "click", (e) => busy(e.currentTarget, () => startCheckout()));
  on("[data-action=manage]", "click", (e) => busy(e.currentTarget, async () => {
    const r = await api("POST", orgPath("/billing/manage-link"));
    location.href = r.link; // Paystack-hosted page
  }));
  on("[data-action=cancel]", "click", (e) => busy(e.currentTarget, async () => {
    if (!confirm(`Cancel your subscription? You keep full access until ${fmtDay(b.currentPeriodEnd)}, then your workspace becomes read-only. Your data is kept.`)) return;
    await api("POST", orgPath("/billing/cancel"));
    flash("Subscription cancelled. No further payments will be taken.", "success");
    await route();
  }));
}

async function claimStatus(token) {
  const res = await fetch("/v1/public/checkout/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimToken: token }) });
  return res.ok ? res.json() : null;
}

/** After paying on the product page: create/sign in to an account, then activate the plan. */
async function viewClaim(token) {
  lstore.set("st_claim", token);
  let info = await claimStatus(token);
  if (!info) { lstore.set("st_claim", null); flash("We couldn't find that payment. If you were charged, contact support."); location.hash = "#/"; return; }
  const planName = info.plan === "organization" ? "Organization" : "Individual";
  const kind = info.plan === "organization" ? "school" : "family";
  if (info.status === "claimed") {
    lstore.set("st_claim", null);
    store.set("st_next", null);
    app.innerHTML = doneCard("check", "ok", "Already activated", `This ${planName} plan payment has already been added to a workspace.`);
    return;
  }
  store.set("st_next", `#/claim/${token}`);
  store.set("st_want_kind", kind);

  const session = state.org ? true : await loadSession();
  if (!session) {
    viewLogin({ signup: true, kind, claim: info });
    // Keep checking until Paystack confirms, then update the banner.
    for (let i = 0; i < 20 && info.status === "initialized" && location.hash === `#/claim/${token}`; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      info = (await claimStatus(token)) || info;
    }
    if (info.status === "paid" && location.hash === `#/claim/${token}` && !store.get("st_token")) {
      const b = app.querySelector(".paid-banner.wait");
      if (b) b.outerHTML = `<div class="paid-banner">${icon("check")}<div><strong>Payment received</strong><span>${h(planName)} plan · ${h(money(info.amount, info.currency))}/month</span></div></div>`;
    }
    return;
  }
  if (session === "noorg") return viewWelcome();

  sidebar.hidden = false;
  setActiveNav("billing");
  app.innerHTML = `<section class="card" style="max-width:560px;margin:40px auto;text-align:center"><div class="loader" style="margin:16px auto"></div>
    <h2>Activating your ${h(planName)} plan…</h2><p class="muted">Confirming with Paystack.</p></section>`;
  for (let i = 0; i < 20 && info.status === "initialized"; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    info = (await claimStatus(token)) || info;
  }
  if (info.status !== "paid") {
    app.innerHTML = doneCard("clock", "warn", "Still waiting for Paystack", "Your payment hasn't been confirmed yet. Refresh this page in a minute. If you were charged and this doesn't clear, contact support.");
    return;
  }
  try {
    await api("POST", orgPath("/billing/claim"), { claimToken: token });
  } catch (e) {
    const wrongKind = /plan|kind/i.test(e.message) || e.message === ERRORS.purchase_plan_mismatch;
    const busyOrg = e.message === ERRORS.already_active;
    if (wrongKind || busyOrg) {
      app.innerHTML = `<section class="card" style="max-width:560px;margin:40px auto">
        ${section("card", `Where should your ${h(planName)} plan go?`)}
        <p class="muted" style="margin-top:0">${busyOrg ? `“${h(state.org.name)}” already has an active plan.` : `This payment is for a ${kind === "school" ? "school / organization" : "family"} workspace, and “${h(state.org.name)}” is a ${state.org.kind === "school" ? "school" : "family"} workspace.`} Create a new workspace for it:</p>
        <form id="claim-new"><label for="cn-name">${kind === "school" ? "School or organization name" : "Family name"}</label>
          <input id="cn-name" type="text" required maxlength="200">
          <div class="row"><button type="submit" class="full">Create workspace and activate plan</button></div></form></section>`;
      on("#claim-new", "submit", (ev) => {
        ev.preventDefault();
        busy(ev.submitter, async () => {
          const r = await api("POST", "/v1/orgs", { kind, name: val("#cn-name") });
          store.set("st_org", r.orgId);
          state.org = null;
          await loadSession();
          await viewClaim(token);
        });
      });
      return;
    }
    flash(e.message);
    return;
  }
  lstore.set("st_claim", null);
  store.set("st_next", null);
  store.set("st_want_kind", null);
  state.org = null;
  await loadSession();
  app.innerHTML = doneCard("check", "ok", `Your ${planName} plan is active`, "Thank you! Your workspace is ready. Next: add your students.", true);
}

function doneCard(ic, tone, title, text, home = true) {
  return `<section class="card" style="max-width:520px;margin:40px auto;text-align:center">
    <span class="icon-tile ${tone}" style="width:56px;height:56px;margin:0 auto 12px">${icon(ic)}</span>
    <h2>${h(title)}</h2><p class="muted">${h(text)}</p>
    ${home ? `<div class="row" style="justify-content:center"><a class="button" href="#/">Go to Home</a></div>` : ""}</section>`;
}

async function viewBillingReturn(reference) {
  setActiveNav("home");
  app.innerHTML = `<section class="card" style="max-width:520px;margin:40px auto;text-align:center">
    <div class="loader" style="margin:20px auto"></div><h2>Confirming your payment with Paystack…</h2></section>`;
  // Paystack's redirect proves nothing by itself; the server asks Paystack directly.
  let result;
  try { result = (await api("POST", orgPath("/billing/verify"), { reference })).result; } catch (e) { result = "error"; }
  const view = {
    success: ["ok", "check", "Payment confirmed", "Your plan is active. Thank you!"],
    pending: ["warn", "clock", "Payment still processing", "Paystack hasn't confirmed it yet. Refresh this page in a minute; we also confirm automatically when Paystack notifies us."],
    failed: ["bad", "alert", "Payment not completed", "No money was taken for this attempt. You can try again from the Home page."],
    mismatch: ["bad", "alert", "We couldn't match this payment", "Please contact support with the time of your payment."],
    error: ["bad", "alert", "We couldn't check this payment", "Please try again in a moment."],
  }[result] || ["bad", "alert", "Unknown result", ""];
  app.innerHTML = `<section class="card" style="max-width:520px;margin:40px auto;text-align:center">
    <span class="icon-tile ${view[0]}" style="width:56px;height:56px;margin:0 auto 12px">${icon(view[1])}</span>
    <h2>${h(view[2])}</h2><p class="muted">${h(view[3])}</p>
    <div class="row" style="justify-content:center"><a class="button" href="#/">Go to Home</a></div></section>`;
}

// ---------- router ----------
function on(sel, evt, fn) { app.querySelectorAll(sel).forEach((el) => el.addEventListener(evt, fn)); }

async function route() {
  const hash = location.hash || "#/";
  if (hash === "#/login") return viewLogin();
  const su = /^#\/signup(?:\/(school|family))?$/.exec(hash);
  if (su) return viewLogin({ signup: true, kind: su[1] });
  // Plan buttons on the product page: /app#/subscribe/family or /app#/subscribe/school
  const pick = /^#\/subscribe\/(school|family)$/.exec(hash);
  if (pick) {
    store.set("st_want_plan", pick[1] === "school" ? "organization" : "individual");
    store.set("st_next", "#/subscribe");
    if (state.org || (await loadSession())) { location.hash = "#/subscribe"; return; }
    return viewLogin({ signup: true, kind: pick[1], paying: true });
  }
  const claimM = /^#\/claim\/([A-Za-z0-9_-]{20,200})$/.exec(hash);
  if (claimM) return viewClaim(claimM[1]);
  if (hash === "#/claim-return") { const tk = lstore.get("st_claim"); location.hash = tk ? `#/claim/${tk}` : "#/"; return; }
  const oauth = /^#\/oauth\/([A-Za-z0-9_-]{20,200})$/.exec(hash);
  if (oauth) return viewOauthDone(oauth[1]);
  const oerr = /^#\/oauth-error\/([a-z_]+)$/.exec(hash);
  if (oerr) { viewLogin(); flash(OAUTH_ERRORS[oerr[1]] || "Sign-in failed. Please try again."); return; }
  if (hash === "#/welcome") { if (!store.get("st_token")) return viewLogin(); return viewWelcome(); }
  const invite = /^#\/invite\/([A-Za-z0-9_-]{20,200})$/.exec(hash);
  if (invite) return viewInvite(invite[1]);
  if (!state.org) {
    const s = await loadSession();
    if (s === "noorg") return viewWelcome();
    if (!s) return viewLogin();
  }
  try {
    const m = /^#\/student\/([0-9a-f-]{36})(\/rules)?$/i.exec(hash);
    if (m) return await viewStudent(m[1], m[2] ? "rules" : "overview");
    const br = /^#\/billing\/return\/(st_[0-9a-f]{32})$/.exec(hash);
    if (br) return await viewBillingReturn(br[1]);
    if (hash === "#/subscribe") return await viewSubscribe();
    if (hash === "#/billing") return await viewBilling();
    if (hash === "#/audit") return await viewAudit();
    if (hash === "#/privacy") return await viewPrivacy();
    return await viewHome();
  } catch (e) {
    flash(e.message || String(e));
  }
}

// (Sign out lives in the profile menu.)
window.addEventListener("hashchange", () => { route(); });
route();
