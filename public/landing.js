/* SafeTab product page: icons, live prices from the server, mobile menu. */
"use strict";

// Old invitation / portal links used "/#/..."; the portal now lives at /app.
if (location.hash.startsWith("#/")) location.replace("/app" + location.hash);

const ICONS = {
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  tablet: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 18h.01"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
};
document.querySelectorAll("[data-icon]").forEach((el) => {
  el.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[el.dataset.icon] || ""}</svg>`;
});

const year = document.querySelector("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());

// Mobile menu
const menuBtn = document.querySelector(".menu-btn");
const links = document.getElementById("nav-links");
menuBtn?.addEventListener("click", () => {
  const open = links.classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", String(open));
});
links?.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
  links.classList.remove("open");
  menuBtn?.setAttribute("aria-expanded", "false");
}));

// Prices and limits come from the server's billing configuration (static fallback in HTML).
function money(subunits, currency) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: subunits % 100 ? 2 : 0 }).format(subunits / 100);
  } catch {
    return `${currency} ${(subunits / 100).toFixed(2)}`;
  }
}
fetch("/v1/public/plans")
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    if (!data) return;
    livePlans = data;
    for (const plan of data.plans) {
      document.querySelectorAll(`[data-price="${plan.id}"]`).forEach((el) => (el.textContent = money(plan.amount, data.currency)));
      for (const [k, v] of Object.entries(plan.limits)) {
        document.querySelectorAll(`[data-limit="${plan.id}.${k}"]`).forEach((el) => (el.textContent = String(v)));
      }
    }
    document.querySelectorAll("[data-currency]").forEach((el) => (el.textContent = data.currency));
  })
  .catch(() => { /* keep the static prices */ });

// ---- Checkout: plan -> email -> Paystack pop-up -> create account ----
const dialog = document.getElementById("checkout");
const coForm = document.getElementById("co-form");
const coErr = document.getElementById("co-error");
const coPay = document.getElementById("co-pay");
let chosenPlan = null;
let livePlans = null;

const CO_ERRORS = {
  payments_not_configured: "Payments aren't set up yet. Please try again later.",
  paystack_unavailable: "We couldn't reach Paystack. Check your connection and try again.",
  validation_failed: "Please enter a valid email address.",
};
const showErr = (m) => { coErr.textContent = m; coErr.hidden = !m; };

function loadPaystack() {
  if (window.PaystackPop) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://js.paystack.co/v2/inline.js";
    const timer = setTimeout(() => resolve(false), 10000);
    s.onload = () => { clearTimeout(timer); resolve(!!window.PaystackPop); };
    s.onerror = () => { clearTimeout(timer); resolve(false); };
    document.head.appendChild(s);
  });
}

document.querySelectorAll("[data-checkout]").forEach((a) => a.addEventListener("click", (e) => {
  if (!dialog?.showModal) return; // very old browser: follow the link instead
  e.preventDefault();
  chosenPlan = a.dataset.checkout;
  const plan = livePlans?.plans.find((p) => p.id === chosenPlan);
  document.getElementById("co-title").textContent = chosenPlan === "organization" ? "Organization plan" : "Individual plan";
  document.getElementById("co-price").textContent = plan ? money(plan.amount, livePlans.currency) : document.querySelector(`[data-price="${chosenPlan}"]`)?.textContent || "";
  showErr("");
  dialog.showModal();
  document.getElementById("co-email").focus();
}));

coForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  showErr("");
  coPay.disabled = true;
  coPay.textContent = "Opening secure payment…";
  try {
    const res = await fetch("/v1/public/checkout", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plan: chosenPlan,
        email: document.getElementById("co-email").value.trim(),
        method: coForm.querySelector("input[name=co-method]:checked")?.value || "momo",
      }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      showErr(r.error === "paystack_rejected" ? `Paystack said: “${r.detail}”.` : CO_ERRORS[r.error] || "Something went wrong. Please try again.");
      return;
    }
    // The claim token proves this browser paid; it's needed to create the account next.
    try { localStorage.setItem("st_claim", r.claimToken); } catch { /* private mode */ }
    const next = `/app#/claim/${r.claimToken}`;
    if (!(await loadPaystack())) { location.href = r.authorizationUrl; return; }
    dialog.close();
    try {
      new window.PaystackPop().resumeTransaction(r.accessCode, {
        onSuccess: () => { location.href = next; },
        onCancel: () => { dialog.showModal(); showErr("Payment window closed. No payment was taken — you can try again."); },
        onError: () => { location.href = r.authorizationUrl; },
      });
    } catch { location.href = r.authorizationUrl; }
  } catch {
    showErr("We couldn't connect. Check your internet connection and try again.");
  } finally {
    coPay.disabled = false;
    coPay.textContent = "Continue to payment";
  }
});
