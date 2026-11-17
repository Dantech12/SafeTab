import nodemailer from "nodemailer";
import { config } from "../config.js";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** True when real email delivery is configured. */
  readonly configured: boolean;
  send(email: Email): Promise<void>;
}

/** SMTP delivery (Gmail app password, Brevo, Mailgun, ... all speak SMTP). */
class SmtpMailer implements Mailer {
  readonly configured = true;
  private transport;
  constructor(private from: string) {
    const c = config();
    this.transport = nodemailer.createTransport({
      host: c.SMTP_HOST,
      port: c.SMTP_PORT,
      secure: c.SMTP_SECURE,
      auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASS } : undefined,
    });
  }
  async send(e: Email) {
    await this.transport.sendMail({ from: this.from, to: e.to, subject: e.subject, text: e.text, html: e.html });
  }
}

/**
 * No email service configured: print the email in the server window so the flow can be
 * tested locally. Refuses to "send" in production, so nothing silently goes missing.
 */
class ConsoleMailer implements Mailer {
  readonly configured = false;
  async send(e: Email) {
    if (config().NODE_ENV === "production") throw new Error("Email is not configured (SMTP_HOST is empty)");
    console.log(`\n[safetab] EMAIL (not sent — no email service configured)\n  To: ${e.to}\n  Subject: ${e.subject}\n\n${e.text.replace(/^/gm, "  ")}\n`);
  }
}

export function makeMailer(): Mailer {
  const c = config();
  if (!c.SMTP_HOST) return new ConsoleMailer();
  const from = c.MAIL_FROM || (c.SMTP_USER ? `${c.BUSINESS_NAME || "SafeTab"} <${c.SMTP_USER}>` : "");
  if (!from) throw new Error("Invalid configuration for: MAIL_FROM (needed when SMTP_HOST is set)");
  return new SmtpMailer(from);
}

/** Collects emails in memory (tests). */
export class MemoryMailer implements Mailer {
  readonly configured = true;
  sent: Email[] = [];
  async send(e: Email) {
    this.sent.push(e);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** A simple, mobile-friendly branded email with one button. */
export function layout(opts: { title: string; intro: string; button?: { label: string; url: string }; outro?: string }) {
  const brand = esc(config().BUSINESS_NAME || "SafeTab");
  const support = config().SUPPORT_EMAIL;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7fd;font-family:Segoe UI,Arial,sans-serif;color:#0f1b3d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e1e8f5">
<tr><td style="padding:22px 28px;border-bottom:1px solid #e1e8f5;font-weight:800;font-size:18px;color:#1d4ed8">${brand}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:22px">${esc(opts.title)}</h1>
<p style="margin:0 0 20px;line-height:1.6;color:#33415c">${esc(opts.intro)}</p>
${opts.button ? `<p style="margin:0 0 20px"><a href="${esc(opts.button.url)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(opts.button.label)}</a></p>
<p style="margin:0 0 20px;font-size:13px;color:#5b6b8c;line-height:1.5">Or copy this link into your browser:<br><span style="word-break:break-all">${esc(opts.button.url)}</span></p>` : ""}
${opts.outro ? `<p style="margin:0;font-size:14px;line-height:1.6;color:#5b6b8c">${esc(opts.outro)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e1e8f5;font-size:12px;color:#5b6b8c">${brand}${support ? ` · ${esc(support)}` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [opts.title, "", opts.intro, ...(opts.button ? ["", `${opts.button.label}: ${opts.button.url}`] : []), ...(opts.outro ? ["", opts.outro] : []), "", `— ${config().BUSINESS_NAME || "SafeTab"}`].join("\n");
  return { html, text };
}
