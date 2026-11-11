/* SafeTab supervisor portal. Plain JS, no build step, same-origin API only.
 * All user-supplied text is HTML-escaped with h() before rendering. */
"use strict";

const state = { token: null, orgId: null, org: null, me: null };
const app = document.getElementById("app");
const flashEl = document.getElementById("flash");

// ---------- helpers ----------
const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (v) => (v ? new Date(v).toLocaleString() : "—");
const isAdmin = () => state.org?.myRole === "org_admin";
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

function flash(msg, kind = "error") {
  flashEl.className = kind;
  flashEl.textContent = msg;
  if (kind === "success") setTimeout(() => { if (flashEl.textContent === msg) flashEl.textContent = ""; }, 5000);
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

// Run an async action from a button, disabling it meanwhile and showing errors.
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { flash(e.message || String(e)); } finally { if (btn) btn.disabled = false; }
}

// ---------- session ----------
function signOut(callApi = true) {
  if (callApi && state.token) fetch("/v1/auth/logout", { method: "POST", headers: { authorization: `Bearer ${state.token}` } }).catch(() => {});
  Object.assign(state, { token: null, orgId: null, org: null, me: null });
  store.set("st_token", null);
  store.set("st_org", null);
  document.getElementById("nav").hidden = true;
  location.hash = "#/login";
}

async function loadSession() {
  state.token = store.get("st_token");
  if (!state.token) return false;
  try {
    state.me = await api("GET", "/v1/me");
  } catch {
    return false;
  }
  const saved = store.get("st_org");
  const org = state.me.orgs.find((o) => o.org_id === saved) || state.me.orgs.find((o) => o.role === "org_admin") || state.me.orgs[0];
  if (!org) return false;
  state.orgId = org.org_id;
  store.set("st_org", state.orgId);
  state.org = await api("GET", orgPath());
  const nav = document.getElementById("nav");
  nav.hidden = false;
  document.getElementById("org-name").textContent = state.org.name;
  nav.querySelectorAll("[data-admin-only]").forEach((el) => (el.hidden = !isAdmin()));
  return true;
}

// ---------- views ----------
function viewLogin() {
  document.getElementById("nav").hidden = true;
  app.innerHTML = `
    <div class="auth card">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-tab="signin">Sign in</button>
        <button type="button" role="tab" aria-selected="false" data-tab="signup">Create account</button>
      </div>
      <form id="signin">
        <label for="si-email">Email</label><input id="si-email" type="email" autocomplete="username" required>
        <label for="si-pw">Password</label><input id="si-pw" type="password" autocomplete="current-password" required>
        <div class="row"><button type="submit">Sign in</button></div>
      </form>
      <form id="signup" hidden>
        <label for="su-name">Your name</label><input id="su-name" type="text" autocomplete="name" required maxlength="120">
        <label for="su-email">Email</label><input id="su-email" type="email" autocomplete="username" required>
        <label for="su-pw">Password <span class="muted small">(at least 12 characters)</span></label>
        <input id="su-pw" type="password" autocomplete="new-password" minlength="12" required>
        <label for="su-kind">Account type</label>
        <select id="su-kind"><option value="school">School / organization</option><option value="family">Family</option></select>
        <label for="su-org">School or family name</label><input id="su-org" type="text" required maxlength="200">
        <div class="row"><button type="submit">Create account</button></div>
      </form>
    </div>`;
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
      flashEl.textContent = "";
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

async function viewHome() {
  const [students, android, billing] = await Promise.all([
    api("GET", orgPath("/students")),
    api("GET", orgPath("/android")),
    isAdmin() ? api("GET", orgPath("/billing")) : Promise.resolve(null),
  ]);
  const planOk = !billing || billing.access === "full";
  const hasStudents = students.students.length > 0;

  const step = (n, done, title, body) => `
    <div class="check ${done ? "done" : ""}"><div class="dot">${done ? "✓" : n}</div>
      <div class="body"><strong>${title}</strong>${body ? `<div class="small">${body}</div>` : ""}</div></div>`;

  const billingBody = !billing ? "" : planOk
    ? `<span class="muted">Active until ${h(fmtDate(billing.currentPeriodEnd))}.</span>`
    : `<span class="muted">Needed before adding tablets or changing rules.</span>
       ${state.org.pilotMode ? `<div class="row"><button type="button" data-action="pilot-activate">Activate pilot (30 days, no payment)</button></div>` : ""}`;

  const androidBody = android.connected
    ? `<span class="muted">Connected (${h(android.enterpriseName)}).</span>`
    : !isAdmin() ? `<span class="muted">Ask your organization admin to connect Android.</span>` : `
      <ol class="steps">
        <li><button type="button" class="secondary" data-action="android-signup">Open Google signup</button>
            <span class="muted small">opens in a new tab</span></li>
        <li>Sign in with a Google account. If Google says it's a personal email, choose <em>Sign up for Android only</em>. Accept the agreement.</li>
        <li>On Google's last page, copy the code it shows (or the whole address from the address bar) and paste it here:</li>
      </ol>
      <form id="android-complete" class="row">
        <input type="text" id="android-code" placeholder="Paste the code or address" autocomplete="off" required style="flex:1;min-width:200px">
        <button type="submit">Connect</button>
      </form>`;

  app.innerHTML = `
    <h1>${h(state.org.name)}</h1>
    <p class="muted">${state.org.kind === "school" ? "School workspace" : "Family workspace"} · you are ${isAdmin() ? "an admin" : "a supervisor"}</p>
    ${isAdmin() ? `<section class="card"><h2>Setup</h2>
      ${step(1, planOk, "Plan active", billingBody)}
      ${step(2, android.connected, "Connect Android", androidBody)}
      ${step(3, hasStudents, "Add a student", hasStudents ? "" : `<span class="muted">Use the form below.</span>`)}
      ${step(4, false, "Add a tablet", `<span class="muted">Open a student below and click “Add a tablet”.</span>`)}
    </section>` : ""}
    <section class="card">
      <h2>Students</h2>
      ${hasStudents ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Age group</th><th></th></tr></thead><tbody>
        ${students.students.map((s) => `<tr><td>${h(s.display_name)}</td><td>${h(ageLabel(s.age_band))}</td>
          <td><a href="#/student/${h(s.id)}">Open</a></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">No students yet.</p>`}
      ${isAdmin() ? `<form id="add-student" class="row">
        <input type="text" id="st-name" placeholder="Name or nickname" required maxlength="80" style="flex:1;min-width:160px">
        <select id="st-age" style="width:auto"><option value="under_13">Under 13</option><option value="13_15" selected>13–15</option><option value="16_17">16–17</option></select>
        <button type="submit">Add student</button>
      </form><p class="muted small">A nickname is fine. SafeTab does not need a full name or date of birth.</p>` : ""}
    </section>`;

  on("[data-action=pilot-activate]", "click", (e) => busy(e.target, async () => {
    await api("POST", orgPath("/billing/pilot-activate"));
    flash("Pilot activated for 30 days.", "success");
    await route();
  }));
  on("[data-action=android-signup]", "click", (e) => {
    // Open the tab synchronously (popup blockers), then point it at Google's URL.
    const win = window.open("about:blank", "_blank");
    busy(e.target, async () => {
      try {
        const r = await api("POST", orgPath("/android/signup"));
        if (win) { win.opener = null; win.location.href = r.signupUrl; }
        else flash("Your browser blocked the new tab. Allow pop-ups for this page and try again.");
        e.target.textContent = "Get a new Google link";
      } catch (err) { if (win) win.close(); throw err; }
    });
  });
  on("#android-complete", "submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const raw = val("#android-code");
      const fromUrl = /[?&]enterpriseToken=([^&#\s]+)/.exec(raw)?.[1];
      const code = fromUrl ? decodeURIComponent(fromUrl) : raw;
      await api("POST", orgPath("/android/complete"), { enterpriseToken: code });
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

const ageLabel = (b) => ({ under_13: "Under 13", "13_15": "13–15", "16_17": "16–17" }[b] || b);

function deviceBadge(state) {
  const map = { active: ["ok", "Active"], pending_enrollment: ["warn", "Waiting for setup"], lost: ["bad", "Lost (locked)"], retired: ["", "Retired"] };
  const [cls, text] = map[state] || ["", state];
  return `<span class="badge ${cls}">${h(text)}</span>`;
}
function rolloutBadge(status) {
  const map = { applied: ["ok", "Applied"], pending: ["warn", "Pending — waiting for the tablet"], failed: ["bad", "Failed"], unsupported: ["warn", "Not supported"] };
  const [cls, text] = map[status] || ["", status];
  return `<span class="badge ${cls}">${h(text)}</span>`;
}

const COMMON_APPS = [
  ["YouTube", "com.google.android.youtube"], ["TikTok", "com.zhiliaoapp.musically"], ["Instagram", "com.instagram.android"],
  ["Facebook", "com.facebook.katana"], ["Snapchat", "com.snapchat.android"], ["Netflix", "com.netflix.mediaclient"],
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function viewStudent(studentId) {
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
    <p><a href="#/">← All students</a></p>
    <h1>${h(student.display_name)}</h1>
    <p class="muted">${h(ageLabel(student.age_band))}</p>

    <section class="card">
      <h2>Tablets</h2>
      ${devices.length ? `<div class="table-wrap"><table><thead><tr><th>Tablet</th><th>Status</th><th>Rules on tablet</th><th>Last report</th><th></th></tr></thead><tbody>
        ${devices.map((d) => {
          const r = rolloutById[d.id];
          return `<tr><td>${h(d.label || "Tablet")}</td><td>${deviceBadge(d.state)}</td>
            <td>${r ? rolloutBadge(r.status) : "—"}${r?.nonCompliance?.length ? `<div class="small muted">${r.nonCompliance.map((n) => h(`${n.settingName || n.packageName || ""} ${n.nonComplianceReason || ""}`)).join("<br>")}</div>` : ""}</td>
            <td class="small">${h(fmtDate(d.last_status_at))}</td>
            <td>${isAdmin() ? `<button type="button" class="chip" data-lost="${h(d.id)}">Lost</button> <button type="button" class="chip" data-retire="${h(d.id)}">Retire</button>` : ""}</td></tr>`;
        }).join("")}
      </tbody></table></div>
      <p class="muted small">Tablets report in every few minutes. “Pending” means the change was sent and SafeTab is waiting for the tablet to confirm it.</p>`
      : `<p class="muted">No tablets yet.</p>`}
      ${isAdmin() ? `<div class="row"><input type="text" id="dev-label" placeholder="Tablet name, e.g. Tablet 1" maxlength="80" style="flex:1;min-width:180px">
        <select id="dev-own" style="width:auto"><option value="school_owned">School-owned</option><option value="family_owned">Family-owned</option></select>
        <button type="button" data-action="add-device">Add a tablet</button></div>` : ""}
      <div id="qr-panel"></div>
    </section>

    <form class="card" id="policy">
      <h2>Rules</h2>
      <fieldset style="border:none;padding:0;margin:0">
        <label>Apps</label>
        <label class="inline"><input type="radio" name="apps-mode" value="blocklist" ${spec.apps.mode === "blocklist" ? "checked" : ""}> Block the apps listed below</label>
        <label class="inline"><input type="radio" name="apps-mode" value="allowlist" ${spec.apps.mode === "allowlist" ? "checked" : ""}> Allow only the apps listed below</label>
        <textarea id="apps" aria-label="App package names, one per line" placeholder="One app ID per line, e.g. com.google.android.youtube">${h(spec.apps.packages.join("\n"))}</textarea>
        <div class="row" style="margin-top:6px">${COMMON_APPS.map(([n, p]) => `<button type="button" class="chip" data-addapp="${h(p)}">+ ${h(n)}</button>`).join("")}</div>
        <p class="muted small">The app ID is in the app's Google Play address after <code>id=</code>.</p>
      </fieldset>

      <label for="web-mode">Websites (Chrome only)</label>
      <select id="web-mode" style="width:auto">
        <option value="off" ${spec.web.mode === "off" ? "selected" : ""}>No website rules</option>
        <option value="blocklist" ${spec.web.mode === "blocklist" ? "selected" : ""}>Block these websites</option>
        <option value="allowlist" ${spec.web.mode === "allowlist" ? "selected" : ""}>Allow only these websites</option>
      </select>
      <textarea id="domains" aria-label="Website domains, one per line" placeholder="One domain per line, e.g. example.com or *.example.com">${h(spec.web.domains.join("\n"))}</textarea>
      <p class="muted small">Applies to Chrome only. To stop other browsers being installed, use “Allow only the apps listed”.</p>

      <label>Downtime</label>
      ${companionOff ? `<div class="notice">Downtime needs the SafeTab student app, which isn't available yet. You can set it now; it takes effect once the app is enabled.</div>` : ""}
      <label class="inline"><input type="checkbox" id="dt-on" ${spec.downtime.enabled ? "checked" : ""}> Turn on downtime</label>
      <div class="row" style="margin-top:4px">${DAYS.map((d, i) => `<label class="inline"><input type="checkbox" data-day="${i + 1}" ${win.days.includes(i + 1) ? "checked" : ""}> ${d}</label>`).join("")}</div>
      <div class="row"><label class="inline">From <input type="time" id="dt-start" value="${h(win.start)}" style="width:auto"></label>
        <label class="inline">until <input type="time" id="dt-end" value="${h(win.end)}" style="width:auto"></label>
        <span class="muted small">Time zone: ${h(tz)}</span></div>

      <label>Screen-time summary</label>
      ${companionOff ? `<div class="notice">Also needs the SafeTab student app. Nothing is collected until then.</div>` : ""}
      <label class="inline"><input type="checkbox" id="usage-on" ${spec.usageSummaries.enabled ? "checked" : ""}> Collect daily minutes per app (no messages, screens or browsing history)</label>

      <div class="row"><button type="submit">Save rules</button><span class="muted small">Version ${h(policy.version)}</span></div>
    </form>`;

  on("[data-addapp]", "click", (e) => {
    const ta = app.querySelector("#apps");
    const list = ta.value.split(/\s+/).filter(Boolean);
    if (!list.includes(e.target.dataset.addapp)) list.push(e.target.dataset.addapp);
    ta.value = list.join("\n");
  });
  on("[data-action=add-device]", "click", (e) => busy(e.target, async () => {
    const r = await api("POST", orgPath(`/students/${studentId}/devices`), { ownership: val("#dev-own"), label: val("#dev-label") || undefined });
    showQr(r);
  }));
  on("[data-lost]", "click", (e) => busy(e.target, async () => {
    if (!confirm("Mark this tablet as lost? It will be locked and disconnected from SafeTab's student app.")) return;
    await api("POST", orgPath(`/devices/${e.target.dataset.lost}/lost`), {});
    flash("Tablet locked and marked lost.", "success");
    await route();
  }));
  on("[data-retire]", "click", (e) => busy(e.target, async () => {
    if (!confirm("Retire this tablet? It will be ERASED (factory reset) and removed from management. This cannot be undone.")) return;
    await api("POST", orgPath(`/devices/${e.target.dataset.retire}/retire`), { confirmWipe: true });
    flash("Tablet retired.", "success");
    await route();
  }));
  on("#policy", "submit", (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const lines = (sel) => val(sel).split(/[\s,]+/).filter(Boolean);
      const days = [...app.querySelectorAll("[data-day]")].filter((c) => c.checked).map((c) => Number(c.dataset.day));
      const newSpec = {
        apps: { mode: app.querySelector("input[name=apps-mode]:checked").value, packages: lines("#apps") },
        web: { mode: val("#web-mode"), domains: lines("#domains") },
        downtime: {
          enabled: app.querySelector("#dt-on").checked, timezone: tz,
          windows: days.length ? [{ days, start: val("#dt-start"), end: val("#dt-end") }] : [],
        },
        usageSummaries: { enabled: app.querySelector("#usage-on").checked },
      };
      const r = await api("PUT", orgPath(`/students/${studentId}/policy`), { spec: newSpec, expectedVersion: policy.version });
      flash(r.deployments.length ? "Saved. Sent to the tablet(s); status shows “Pending” until each tablet confirms." : "Saved. Rules will be sent when a tablet is added.", "success");
      await route();
    });
  });
}

function showQr(r) {
  const panel = app.querySelector("#qr-panel");
  panel.innerHTML = `
    <div class="card" style="margin-bottom:0">
      <h2>Set up the tablet</h2>
      <div class="qr-wrap">
        <img src="${h(r.qrPng)}" alt="Enrollment QR code">
        <div>
          <ol class="steps">
            <li><strong>Factory-reset</strong> the tablet: Settings → System → Reset options → Erase all data. <em>This erases everything on it.</em></li>
            <li>On the very first <strong>Welcome</strong> screen, <strong>tap the same empty spot 6 times</strong>. A QR setup message appears (connect to Wi-Fi if asked).</li>
            <li>Scan <strong>this</strong> code with the tablet's setup scanner — not with a normal camera app.</li>
            <li>Follow the steps. The tablet will say it belongs to your organization.</li>
            <li>Come back here: the tablet shows as <span class="badge ok">Active</span> within about 5 minutes (reload the page).</li>
          </ol>
          <p class="muted small">If 6 taps do nothing: continue to the Google sign-in step and type <code>afw#setup</code> as the email.</p>
          <p class="small">Works once, until ${h(fmtDate(r.expiresAt))}. Don't share it — anyone who scans it can add a device to your organization.</p>
        </div>
      </div>
    </div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function viewAudit() {
  const r = await api("GET", orgPath("/audit?limit=200"));
  app.innerHTML = `<h1>Activity log</h1><p class="muted">Every sensitive action, including who viewed a student's activity.</p>
    <section class="card"><div class="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>By</th><th>Target</th></tr></thead><tbody>
    ${r.entries.map((e) => `<tr><td class="small">${h(fmtDate(e.created_at))}</td><td>${h(e.action)}</td><td class="small">${h(e.actor_type)}</td>
      <td class="small">${h(e.target_type || "")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nothing yet.</td></tr>`}
    </tbody></table></div></section>`;
}

async function viewPrivacy() {
  const r = await api("GET", orgPath("/data-inventory"));
  app.innerHTML = `<h1>What SafeTab collects</h1>
    <section class="card"><h2>Collected</h2><div class="table-wrap"><table><thead><tr><th>What</th><th>Why</th><th>Who can see it</th><th>Kept for</th></tr></thead><tbody>
      ${r.collected.map((c) => `<tr><td>${h(c.item)}</td><td>${h(c.purpose)}</td><td>${h(c.visibleTo)}</td><td>${h(c.retention)}</td></tr>`).join("")}
    </tbody></table></div></section>
    <section class="card"><h2>Never collected</h2><ul class="plain">${r.notCollected.map((n) => `<li>${h(n)}</li>`).join("")}</ul></section>`;
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
window.addEventListener("hashchange", () => { flashEl.textContent = ""; route(); });
route();
