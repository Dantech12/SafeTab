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
const isAdmin = () => state.org?.myRole === "org_admin";
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "?";
const AVATAR_GRADS = [
  "linear-gradient(135deg,#6366f1,#8b5cf6)", "linear-gradient(135deg,#0ea5e9,#22d3ee)", "linear-gradient(135deg,#f97316,#f43f5e)",
  "linear-gradient(135deg,#10b981,#14b8a6)", "linear-gradient(135deg,#ec4899,#a855f7)", "linear-gradient(135deg,#eab308,#f97316)",
];
const avatar = (name, id, cls = "") => {
  const n = [...String(id || name)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return `<span class="avatar ${cls}" style="background:${AVATAR_GRADS[n % AVATAR_GRADS.length]}">${h(initials(name))}</span>`;
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
  invalid_or_expired_invitation: "This invitation link is invalid or expired.",
};

let flashTimer;
function flash(msg, kind = "error") {
  flashEl.className = kind;
  flashEl.innerHTML = `${icon(kind === "success" ? "check" : "alert")} ${h(msg)}`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flashEl.innerHTML = ""), kind === "success" ? 4000 : 9000);
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
  location.hash = "#/login";
}

async function loadSession() {
  state.token = store.get("st_token");
  if (!state.token) return false;
  try { state.me = await api("GET", "/v1/me"); } catch { return false; }
  const saved = store.get("st_org");
  const org = state.me.orgs.find((o) => o.org_id === saved) || state.me.orgs.find((o) => o.role === "org_admin") || state.me.orgs[0];
  if (!org) return false;
  state.orgId = org.org_id;
  store.set("st_org", state.orgId);
  state.org = await api("GET", orgPath());
  sidebar.hidden = false;
  document.getElementById("org-name").textContent = state.org.name;
  document.getElementById("org-avatar").textContent = initials(state.org.name);
  sidebar.querySelectorAll("[data-admin-only]").forEach((el) => (el.hidden = !isAdmin()));
  return true;
}

function setActiveNav(key) {
  sidebar.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === key));
}

// ---------- views ----------
function viewLogin() {
  sidebar.hidden = true;
  app.innerHTML = `
    <div class="auth-wrap"><div class="auth">
      <div class="brand"><span class="brand-mark">${icon("shield")}</span><span>SafeTab</span></div>
      <div class="card">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" aria-selected="true" data-tab="signin">Sign in</button>
          <button type="button" role="tab" aria-selected="false" data-tab="signup">Create account</button>
        </div>
        <form id="signin">
          <label for="si-email">Email</label><input id="si-email" type="email" autocomplete="username" required>
          <label for="si-pw">Password</label><input id="si-pw" type="password" autocomplete="current-password" required>
          <div class="row"><button type="submit" class="full">Sign in ${icon("chevron")}</button></div>
        </form>
        <form id="signup" hidden>
          <label for="su-name">Your name</label><input id="su-name" type="text" autocomplete="name" required maxlength="120">
          <label for="su-email">Email</label><input id="su-email" type="email" autocomplete="username" required>
          <label for="su-pw">Password <span class="muted small">· at least 12 characters</span></label>
          <input id="su-pw" type="password" autocomplete="new-password" minlength="12" required>
          <label for="su-kind">Account type</label>
          <select id="su-kind"><option value="school">School / organization</option><option value="family">Family</option></select>
          <label for="su-org">School or family name</label><input id="su-org" type="text" required maxlength="200">
          <div class="row"><button type="submit" class="full">Create account ${icon("chevron")}</button></div>
        </form>
      </div>
      <p class="muted small" style="text-align:center">${icon("lock")} Transparent device management. No messages, screens, cameras or locations — ever.</p>
    </div></div>`;
  app.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    app.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    app.querySelector("#signin").hidden = b.dataset.tab !== "signin";
    app.querySelector("#signup").hidden = b.dataset.tab !== "signup";
  }));
  app.querySelector("#signin").addEventListener("submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", "/v1/auth/login", { email: val("#si-email"), password: val("#si-pw") });
      store.set("st_token", r.token);
      location.hash = "#/";
      await route();
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
      location.hash = "#/";
      await route();
    });
  });
}

const val = (sel) => app.querySelector(sel).value.trim();

const stat = (iconName, tone, value, label) => `
  <div class="stat"><span class="icon-tile ${tone}">${icon(iconName)}</span>
    <div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div></div>`;

async function viewHome() {
  setActiveNav("home");
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
    : `<span class="muted">Needed before adding tablets or changing rules.</span>
       ${state.org.pilotMode ? `<div class="row"><button type="button" data-action="pilot-activate">${icon("rocket")} Activate pilot · 30 days, no payment</button></div>` : ""}`;

  const androidBody = android.connected
    ? `<span class="muted">Connected · <code>${h(android.enterpriseName)}</code></span>`
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
      <div class="card-head"><span class="icon-tile">${icon("users")}</span><h2>Students</h2><span class="sub muted small">${students.students.length} total</span></div>
      ${hasStudents ? `<div class="tiles">
        ${students.students.map((s) => `<a class="tile" href="#/student/${h(s.id)}">${avatar(s.display_name, s.id)}
          <div class="grow"><div class="name">${h(s.display_name)}</div><div class="muted small">${h(ageLabel(s.age_band))}</div></div>${icon("chevron")}</a>`).join("")}
      </div>` : `<p class="muted">No students yet.</p>`}
      ${isAdmin() ? `<form id="add-student" class="row">
        <input type="text" id="st-name" class="grow" placeholder="Name or nickname" required maxlength="80">
        <select id="st-age" style="width:auto"><option value="under_13">Under 13</option><option value="13_15" selected>13–15</option><option value="16_17">16–17</option></select>
        <button type="submit">${icon("plus")} Add student</button>
      </form><p class="muted small">A nickname is fine — SafeTab never needs a full name or date of birth.</p>` : ""}
    </section>`;

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

async function viewStudent(studentId) {
  setActiveNav("home");
  const [student, policy] = await Promise.all([
    api("GET", orgPath(`/students/${studentId}`)),
    api("GET", orgPath(`/students/${studentId}/policy`)),
  ]);
  const spec = policy.spec;
  const companionOff = !state.org.companionAppEnabled;
  const devices = student.devices.filter((d) => d.state !== "retired");
  const rolloutById = Object.fromEntries(policy.rollout.map((r) => [r.deviceId, r]));
  const tz = spec.downtime.timezone !== "UTC" ? spec.downtime.timezone : (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const win = spec.downtime.windows[0] || { days: [1, 2, 3, 4, 5], start: "21:00", end: "06:30" };

  app.innerHTML = `
    <p><a href="#/" class="small">${icon("back")} All students</a></p>
    <div class="page-head">${avatar(student.display_name, student.id, "lg")}
      <div><h1>${h(student.display_name)}</h1><p class="muted">${h(ageLabel(student.age_band))} · ${devices.length} tablet${devices.length === 1 ? "" : "s"}</p></div></div>

    <section class="card">
      ${section("tablet", "Tablets", "reports every few minutes")}
      ${devices.length ? devices.map((d) => {
        const r = rolloutById[d.id];
        return `<div class="device">
          <span class="icon-tile ${d.state === "active" ? "ok" : d.state === "lost" ? "bad" : "warn"}">${icon("tablet")}</span>
          <div class="meta">
            <div style="font-weight:650">${h(d.label || "Tablet")}</div>
            <div class="row" style="margin-top:6px">${deviceBadge(d.state)} ${r ? rolloutBadge(r.status) : ""}</div>
            ${r?.nonCompliance?.length ? `<div class="small muted" style="margin-top:6px">${r.nonCompliance.map((n) => h(`${n.settingName || n.packageName || ""} ${n.nonComplianceReason || ""}`)).join("<br>")}</div>` : ""}
            <div class="small muted" style="margin-top:6px">Last report: ${h(fmtDate(d.last_status_at))}</div>
          </div>
          ${isAdmin() ? `<div class="actions">
            <button type="button" class="secondary icon-only" title="Mark lost (locks the tablet)" aria-label="Mark lost" data-lost="${h(d.id)}">${icon("lock")}</button>
            <button type="button" class="danger icon-only" title="Retire (erases the tablet)" aria-label="Retire" data-retire="${h(d.id)}">${icon("trash")}</button>
          </div>` : ""}
        </div>`;
      }).join("") : `<p class="muted">No tablets yet.</p>`}
      ${devices.some((d) => rolloutById[d.id]?.status === "pending") ? `<div class="notice info">${icon("info")}<span>“Rules pending” means the change was sent and SafeTab is waiting for the tablet to confirm it.</span></div>` : ""}
      ${isAdmin() ? `<div class="row">
        <input type="text" id="dev-label" class="grow" placeholder="Tablet name, e.g. Tablet 1" maxlength="80">
        <select id="dev-own" style="width:auto"><option value="school_owned">School-owned</option><option value="family_owned">Family-owned</option></select>
        <button type="button" data-action="add-device">${icon("qr")} Add a tablet</button></div>` : ""}
      <div id="qr-panel"></div>
    </section>

    <form id="policy">
      <section class="card">
        ${section("ban", "Apps")}
        <div class="segmented" role="radiogroup" aria-label="App rule">
          <label><input type="radio" name="apps-mode" value="blocklist" ${spec.apps.mode === "blocklist" ? "checked" : ""}><span>Block listed apps</span></label>
          <label><input type="radio" name="apps-mode" value="allowlist" ${spec.apps.mode === "allowlist" ? "checked" : ""}><span>Allow only listed apps</span></label>
        </div>
        <textarea id="apps" style="margin-top:12px" aria-label="App IDs, one per line" placeholder="One app ID per line, e.g. com.google.android.youtube">${h(spec.apps.packages.join("\n"))}</textarea>
        <div class="row" style="margin-top:10px">${COMMON_APPS.map(([n, p]) => `<button type="button" class="chip" data-addapp="${h(p)}">${icon("plus")} ${h(n)}</button>`).join("")}</div>
        <p class="muted small">Tip: the app ID is in the app's Google Play address, after <code>id=</code>.</p>
      </section>

      <section class="card">
        ${section("globe", "Websites", "Chrome only")}
        <div class="segmented" role="radiogroup" aria-label="Website rule">
          ${[["off", "No rules"], ["blocklist", "Block listed sites"], ["allowlist", "Allow only listed sites"]].map(([v, t]) =>
            `<label><input type="radio" name="web-mode" value="${v}" ${spec.web.mode === v ? "checked" : ""}><span>${t}</span></label>`).join("")}
        </div>
        <textarea id="domains" style="margin-top:12px" aria-label="Website domains, one per line" placeholder="One domain per line, e.g. example.com or *.example.com">${h(spec.web.domains.join("\n"))}</textarea>
        <p class="muted small">Applies to Chrome. To stop other browsers being installed, use “Allow only listed apps”.</p>
      </section>

      <section class="card">
        ${section("moon", "Downtime", h(tz))}
        ${companionOff ? `<div class="notice">${icon("info")}<span>Downtime needs the SafeTab student app, which isn't available yet. You can set it now — it takes effect once the app is enabled.</span></div>` : ""}
        <label class="switch"><input type="checkbox" id="dt-on" ${spec.downtime.enabled ? "checked" : ""}> Turn on downtime</label>
        <div class="days">${DAYS.map((d, i) => `<label><input type="checkbox" data-day="${i + 1}" ${win.days.includes(i + 1) ? "checked" : ""}><span>${d}</span></label>`).join("")}</div>
        <div class="row">
          <label style="margin:0">From <input type="time" id="dt-start" value="${h(win.start)}" style="width:auto;margin-left:6px"></label>
          <label style="margin:0">until <input type="time" id="dt-end" value="${h(win.end)}" style="width:auto;margin-left:6px"></label>
        </div>
      </section>

      <section class="card">
        ${section("chart", "Screen-time summary")}
        ${companionOff ? `<div class="notice">${icon("info")}<span>Also needs the SafeTab student app. Nothing is collected until then.</span></div>` : ""}
        <label class="switch"><input type="checkbox" id="usage-on" ${spec.usageSummaries.enabled ? "checked" : ""}>
          <span>Collect daily minutes per app <span class="hint muted small">· never messages, screens or browsing history</span></span></label>
      </section>

      <div class="savebar">
        <span class="muted small">${icon("shield")} Rules version ${h(policy.version)} · changes apply to all of ${h(student.display_name)}'s tablets</span>
        <button type="submit">${icon("save")} Save rules</button>
      </div>
    </form>`;

  on("[data-addapp]", "click", (e) => {
    const ta = app.querySelector("#apps");
    const list = ta.value.split(/\s+/).filter(Boolean);
    const pkg = e.currentTarget.dataset.addapp;
    if (!list.includes(pkg)) list.push(pkg);
    ta.value = list.join("\n");
  });
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
  on("#policy", "submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const lines = (sel) => val(sel).split(/[\s,]+/).filter(Boolean);
      const days = [...app.querySelectorAll("[data-day]")].filter((c) => c.checked).map((c) => Number(c.dataset.day));
      const newSpec = {
        apps: { mode: app.querySelector("input[name=apps-mode]:checked").value, packages: lines("#apps") },
        web: { mode: app.querySelector("input[name=web-mode]:checked").value, domains: lines("#domains") },
        downtime: {
          enabled: app.querySelector("#dt-on").checked, timezone: tz,
          windows: days.length ? [{ days, start: val("#dt-start"), end: val("#dt-end") }] : [],
        },
        usageSummaries: { enabled: app.querySelector("#usage-on").checked },
      };
      const r = await api("PUT", orgPath(`/students/${studentId}/policy`), { spec: newSpec, expectedVersion: policy.version });
      flash(r.deployments.length ? "Saved and sent. Each tablet shows “Rules pending” until it confirms." : "Saved. Rules will be sent when a tablet is added.", "success");
      await route();
    });
  });
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
};

async function viewAudit() {
  setActiveNav("audit");
  const r = await api("GET", orgPath("/audit?limit=200"));
  app.innerHTML = `
    <div class="page-head"><span class="icon-tile" style="width:48px;height:48px">${icon("activity")}</span>
      <div><h1>Activity log</h1><p class="muted">Every sensitive action — including who viewed a student's activity.</p></div></div>
    <section class="card"><div class="table-wrap"><table><thead><tr><th>When</th><th>What</th><th>By</th></tr></thead><tbody>
    ${r.entries.map((e) => `<tr><td class="small muted">${h(fmtDate(e.created_at))}</td>
      <td><strong>${h(ACTION_LABELS[e.action] || e.action)}</strong>${ACTION_LABELS[e.action] ? `<div class="small muted"><code>${h(e.action)}</code></div>` : ""}</td>
      <td class="small">${h(e.actor_type === "user" ? "Staff member" : e.actor_type === "device" ? "Tablet" : "System")}</td></tr>`).join("")
      || `<tr><td colspan="3" class="muted">Nothing yet.</td></tr>`}
    </tbody></table></div></section>`;
}

async function viewPrivacy() {
  setActiveNav("privacy");
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

// ---------- router ----------
function on(sel, evt, fn) { app.querySelectorAll(sel).forEach((el) => el.addEventListener(evt, fn)); }

async function route() {
  const hash = location.hash || "#/";
  if (hash === "#/login") return viewLogin();
  if (!state.org && !(await loadSession())) return viewLogin();
  try {
    const m = /^#\/student\/([0-9a-f-]{36})$/i.exec(hash);
    if (m) return await viewStudent(m[1]);
    if (hash === "#/audit") return await viewAudit();
    if (hash === "#/privacy") return await viewPrivacy();
    return await viewHome();
  } catch (e) {
    flash(e.message || String(e));
  }
}

document.querySelector("[data-action=logout]").addEventListener("click", () => signOut(true));
window.addEventListener("hashchange", () => { route(); });
route();
