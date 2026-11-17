import type { FastifyInstance, FastifyReply } from "fastify";
import { config } from "../config.js";

/**
 * Public site pages: legal (Terms, Privacy, Refunds), Contact, icon and a friendly 404.
 * Business details come from .env (BUSINESS_NAME, SUPPORT_EMAIL, BUSINESS_ADDRESS,
 * BUSINESS_COUNTRY). The legal text is a starting template: have it reviewed by a
 * lawyer before taking live payments.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const UPDATED = "17 November 2026";

export const FAVICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1d4ed8"/>` +
  `<path d="M32 12c5 4 10 6 16 6v13c0 11-7 17-16 21-9-4-16-10-16-21V18c6 0 11-2 16-6z" fill="#fff"/>` +
  `<path d="m25 32 5 5 9-10" fill="none" stroke="#1d4ed8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function money(subunits: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: subunits % 100 ? 2 : 0 }).format(subunits / 100);
  } catch {
    return `${currency} ${(subunits / 100).toFixed(2)}`;
  }
}

function details() {
  const c = config();
  const name = esc(c.BUSINESS_NAME || "SafeTab");
  const email = c.SUPPORT_EMAIL ? esc(c.SUPPORT_EMAIL) : "";
  return {
    name,
    email,
    emailLink: email ? `<a href="mailto:${email}">${email}</a>` : "our support team (contact details coming soon)",
    address: c.BUSINESS_ADDRESS ? esc(c.BUSINESS_ADDRESS) : "",
    country: esc(c.BUSINESS_COUNTRY || ""),
    individual: money(c.PLAN_INDIVIDUAL_AMOUNT, c.BILLING_CURRENCY),
    organization: money(c.PLAN_ORGANIZATION_AMOUNT, c.BILLING_CURRENCY),
    graceDays: c.BILLING_GRACE_DAYS,
  };
}

function page(title: string, body: string) {
  const d = details();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${d.name}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/landing.css"></head>
<body>
<header class="nav"><div class="wrap nav-inner"><a class="logo" href="/"><span class="logo-mark">${shield}</span>${d.name}</a>
<nav class="legal-nav"><a href="/#pricing">Pricing</a><a class="btn btn-sm" href="/app#/login">Sign in</a></nav></div></header>
<main class="section"><article class="wrap legal">${body}</article></main>
<footer class="footer"><div class="wrap footer-inner"><a class="logo" href="/"><span class="logo-mark">${shield}</span>${d.name}</a>
<nav><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/refunds">Refunds</a><a href="/contact">Contact</a></nav>
<small>© ${new Date().getFullYear()} ${d.name}. Payments processed by Paystack.</small></div></footer>
</body></html>`;
}
const shield = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`;

function terms() {
  const d = details();
  return page("Terms of Service", `
<h1>Terms of Service</h1><p class="muted">Last updated ${UPDATED}</p>
<p>These terms apply to your use of ${d.name} ("we", "us"), a service that helps schools and families manage Android tablets transparently. By creating an account you agree to them.</p>
<h2>1. The service</h2>
<p>${d.name} lets authorised adults set rules for enrolled tablets, such as switching off chosen apps during school hours, and see whether those rules are applied. It uses Google's official Android Enterprise features. Some features depend on Google and on the device, and may not be available on every tablet. ${d.name} is currently offered as <strong>early access</strong>; features may change.</p>
<h2>2. Who may use it</h2>
<ul><li>You must be an adult and either own the device, be the parent or legal guardian of the child using it, or act for a school or organisation that owns it or has the parent's consent.</li>
<li>You must not use ${d.name} to monitor anyone secretly, or on a device you are not authorised to manage.</li>
<li>You are responsible for keeping your login secure and for the people you invite to your workspace.</li></ul>
<h2>3. Plans and payment</h2>
<ul><li><strong>Individual:</strong> ${d.individual} per month. <strong>Organization:</strong> ${d.organization} per month. Limits for each plan are shown on our pricing page.</li>
<li>Payments are processed by Paystack. We never see or store your full card details.</li>
<li>Subscriptions renew automatically every month until cancelled. You can cancel at any time in your workspace (Billing); you keep access until the end of the month you paid for.</li>
<li>If a renewal fails we give you a ${d.graceDays}-day grace period. After that your workspace becomes read-only until payment resumes. We do not delete your data because a payment failed.</li>
<li>Prices may change; we will tell you at least 30 days before a change affects you.</li></ul>
<h2>4. Your data</h2>
<p>How we handle personal data is explained in our <a href="/privacy">Privacy Policy</a>. You can export or delete your data from your workspace at any time.</p>
<h2>5. Acceptable use</h2>
<p>Do not misuse the service, attempt to access other workspaces, interfere with its security, or use it in breach of any law.</p>
<h2>6. Availability and liability</h2>
<p>We work to keep ${d.name} available and secure, but it is provided "as is" during early access. To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability is limited to the amount you paid us in the 3 months before the claim. Nothing in these terms limits rights you have under consumer protection law.</p>
<h2>7. Ending your account</h2>
<p>You may close your account at any time. We may suspend accounts that break these terms, after notice where reasonable.</p>
<h2>8. Law</h2>
<p>These terms are governed by the laws of ${d.country || "the country where we are established"}.</p>
<h2>9. Contact</h2>
<p>Questions: ${d.emailLink}.</p>`);
}

function privacy() {
  const d = details();
  return page("Privacy Policy", `
<h1>Privacy Policy</h1><p class="muted">Last updated ${UPDATED}</p>
<p>${d.name} is built to manage tablets <strong>without watching what children do</strong>. This policy explains what we collect, why, and your choices.</p>
<h2>What we collect</h2>
<ul><li><strong>Account details:</strong> name, email address, and a securely hashed password (or your Google/Microsoft sign-in ID).</li>
<li><strong>Student profiles:</strong> a display name or nickname and an age group. No date of birth or photo is required.</li>
<li><strong>Device status:</strong> whether a tablet is enrolled, when it last reported, and whether rules are applied.</li>
<li><strong>Consent records:</strong> for family-owned tablets, the parent's typed name, the rules agreed to and the date.</li>
<li><strong>Activity log:</strong> which staff member did what in the workspace, including who viewed a student's information.</li>
<li><strong>Billing:</strong> plan, payment status and payment references from Paystack. We never receive full card details.</li></ul>
<h2>What we never collect</h2>
<p>Messages or chats, keystrokes, passwords typed on tablets, screenshots, camera or microphone, location, browsing history or searches, photos, contacts or files.</p>
<h2>Why we use it</h2>
<p>To provide the service you signed up for, to keep it secure, to process payments, and to meet legal obligations. We do not sell personal data or use it for advertising.</p>
<h2>Who we share it with</h2>
<ul><li><strong>Paystack</strong>, to process payments.</li><li><strong>Google</strong>, to manage enrolled Android devices (Android Enterprise) and, if you choose it, to sign you in.</li>
<li><strong>Microsoft</strong>, only if you choose to sign in with Microsoft.</li><li>Our hosting provider, to run the service.</li></ul>
<h2>How long we keep it</h2>
<p>Workspace data is kept while your account is active. Activity logs are kept for the period set by your workspace (by default one year). You can export or delete student data at any time, and ask us to close your account.</p>
<h2>Children</h2>
<p>Children do not create accounts. Their information is added by a parent, guardian or school, and for family-owned tablets a parent's consent is recorded before school rules apply.</p>
<h2>Your rights</h2>
<p>You can ask to access, correct, export or delete your personal data, or object to how it is used, under applicable data protection law${d.country === "Ghana" ? ", including Ghana's Data Protection Act, 2012 (Act 843)" : ""}. Contact ${d.emailLink}.</p>
<h2>Security</h2>
<p>Passwords are hashed, access is limited by role, each workspace's data is isolated, and sensitive actions are logged.</p>
<h2>Contact</h2>
<p>${d.name}${d.address ? `, ${d.address}` : ""}. Email: ${d.emailLink}.</p>`);
}

function refunds() {
  const d = details();
  return page("Refund Policy", `
<h1>Refund Policy</h1><p class="muted">Last updated ${UPDATED}</p>
<ul><li><strong>Cancel any time.</strong> Cancelling stops future payments. You keep access until the end of the month you already paid for.</li>
<li><strong>First payment.</strong> If ${d.name} doesn't work for you, ask for a refund within <strong>7 days of your first payment</strong> and we will refund it in full.</li>
<li><strong>Service problems.</strong> If a fault on our side stopped the service from working for a significant part of a month, contact us and we will refund or credit that month.</li>
<li><strong>Duplicate or mistaken charges</strong> are always refunded.</li>
<li>Refunds are returned through Paystack to the original payment method. Timing depends on your bank or mobile money provider (usually 5–10 working days).</li></ul>
<p>To ask for a refund, email ${d.emailLink} with your account email and the payment date.</p>`);
}

function contact() {
  const d = details();
  return page("Contact", `
<h1>Contact us</h1>
<p>We're happy to help with setup, billing or privacy questions.</p>
<div class="contact-grid">
<div class="contact-card"><h3>Email</h3><p>${d.emailLink}</p><p class="muted">We aim to reply within 1 working day.</p></div>
${d.address ? `<div class="contact-card"><h3>Address</h3><p>${d.address}</p></div>` : ""}
<div class="contact-card"><h3>Pricing</h3><p>Individual ${d.individual}/month · Organization ${d.organization}/month</p><p><a href="/#pricing">See plans</a></p></div>
</div>`);
}

function notFound() {
  return page("Page not found", `
<div style="text-align:center;padding:40px 0">
<p class="eyebrow">404</p><h1>We can't find that page</h1>
<p class="muted" style="margin:12px 0 24px">The link may be old, or the page may have moved.</p>
<p><a class="btn" href="/">Go to the home page</a></p></div>`);
}

export async function siteRoutes(app: FastifyInstance) {
  const html = (reply: FastifyReply, body: string, status = 200) =>
    reply.status(status).type("text/html; charset=utf-8").header("cache-control", "no-store").send(body);
  app.get("/terms", async (_r, reply) => html(reply, terms()));
  app.get("/privacy", async (_r, reply) => html(reply, privacy()));
  app.get("/refunds", async (_r, reply) => html(reply, refunds()));
  app.get("/contact", async (_r, reply) => html(reply, contact()));
  app.get("/favicon.svg", async (_r, reply) => reply.type("image/svg+xml").header("cache-control", "public, max-age=86400").send(FAVICON_SVG));
  app.get("/favicon.ico", async (_r, reply) => reply.redirect("/favicon.svg"));

  app.setNotFoundHandler((req, reply) => {
    const api = /^\/(v1|device|webhooks)\//.test(req.url);
    if (api || req.method !== "GET") return reply.status(404).send({ error: "not_found" });
    return html(reply, notFound(), 404);
  });
}
