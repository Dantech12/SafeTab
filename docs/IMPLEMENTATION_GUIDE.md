# SafeTab: Implementation Guide

A transparent parental-control and school device-management service. It uses official platform features only: Android Enterprise through the Android Management API (AMAPI), and Paystack for billing.

> **Status:** this is a pilot backend with automated tests. It is **not production-ready**. Before launch it needs real-device validation, a security review, a privacy/legal review for the deployment jurisdiction, and confirmation of the items in §10.

---

## 1. Assumptions and questions

No question blocks the pilot, so these defaults apply. Each needs confirmation. **Bold** marks the ones that change the architecture.

| # | Default used | Confirm with |
|---|---|---|
| A1 | **Platform: Android tablets only, fully managed (company-owned) through AMAPI.** No iOS. The code keeps the platform layer behind `MdmProvider`, so iOS would be a separate provider with a different feature set. | IT lead |
| A2 | **School pilot devices are school-owned and factory-reset before enrollment.** Family-plan devices are owned by the parent and enrolled by the parent as fully managed. | IT lead / product |
| A3 | Stack: Node.js 22, TypeScript, Fastify 5, PostgreSQL 16 (row-level security), zod. The supervisor portal is a responsive web app (not built in this repo; the API is ready for it). | Engineering |
| A4 | Jurisdiction: placeholder `[deployment jurisdiction]`. Billing currency is configurable (`BILLING_CURRENCY`, default `USD`). | Privacy/legal lead, finance |
| A5 | Retention: app-usage daily totals 30 days (each org can set 1–90), audit log 365 days (90–2555). | School privacy lead |
| A6 | Scale: pilot of up to roughly 10 orgs and 1,000 devices. A single region, managed Postgres, 2 API replicas, 1 worker. | IT / hosting |
| A7 | Plan limits are placeholders. Individual: 5 students, 5 devices, 2 adults. Organization: 300 / 300 / 30. | Product / finance |
| A8 | **Usage summaries are off by default.** Each student's policy turns them on explicitly. | School policy |

**Questions that would change the design (answer before production, not before the pilot):**
1. Does the pilot include personally owned (BYOD) student devices? If it does, they need an Android work profile. In a work profile the school can manage and see only school apps, never personal use. The current code supports only fully managed devices.
2. Which country is the Paystack merchant account registered in? That decides which currencies and recurring billing are available (§7).
3. Is the Individual (family) plan in scope for Android launch? See the AMAPI usage-policy question in §10. It may block consumer use.

---

## 2. Feature feasibility and boundaries

Legend: ✅ supported · 🟡 conditionally supported · ❌ unavailable or excluded · 🔍 needs validation on real devices or current docs

| Feature | Platform support / limitations (Android, AMAPI) | Privacy notes | Decision |
|---|---|---|---|
| Enrollment of school tablets | ✅ QR enrollment token at first-boot setup (fully managed). Requires a factory reset, so it cannot happen silently on a device in use. | Visible to whoever holds the device. Persistent "managed device" notices from the OS. | **Build** (implemented) |
| Family device enrollment | 🟡 Technically the same flow. 🔍 AMAPI terms and permissible-use rules for consumer parental-control apps must be checked. Google Family Link is Google's consumer product and has no public integration API. | Same notices | **Pilot only after the §10 check** |
| BYOD student phones | 🟡 Work profile only: manages school apps inside the profile, with no visibility into personal apps | Must not collect anything outside the work profile | **Exclude from pilot** |
| App allow/block lists | ✅ `applications[].installType` (`BLOCKED`, `AVAILABLE`, `FORCE_INSTALLED`) + `playStoreMode` 🔍 (verify enum names) | Package names only | **Build** (implemented) |
| Downtime / schedules | 🟡 AMAPI has no native schedule. The server switches the device into a **kiosk policy** (only the SafeTab app, showing "Downtime until …") and back. This only takes effect when the device is online. | None beyond policy | **Build** (implemented, with an honest status) |
| Web filtering | 🟡 Applies only to **Chrome**, through its managed configuration (`URLBlocklist`/`URLAllowlist`). Other browsers are not filtered unless the app allowlist mode blocks them. 🔍 Verify current Chrome policy names. | Domain-level rules only | **Build** (implemented, with a "Chrome only" warning shown) |
| Network-level DNS logs (AMAPI `NETWORK_ACTIVITY_LOGS`) | ✅ exists on fully managed devices | ❌ Effectively a full browsing history. Disproportionate for this purpose. | **Excluded** |
| Per-app daily usage minutes | 🟡 The visible companion app reads `UsageStatsManager`. It needs the **Usage access** special permission, granted visibly in Settings (AMAPI cannot grant it silently). 🔍 | Aggregate minutes per app per day only. Off by default. Short retention. | **Build** (server side implemented; app is a sample) |
| Device health / check-in / policy compliance | ✅ AMAPI `Device` resource: `appliedPolicyVersion`, `policyCompliant`, `nonComplianceDetails`, `lastStatusReportTime`, plus Pub/Sub notifications | Operational data | **Build** (implemented) |
| Lost device | ✅ `issueCommand LOCK`; `devices.delete` (wipes a fully managed device) | Lock or wipe only. No location tracking. | **Build** (implemented, wipe needs explicit confirmation) |
| Location tracking | Possible with custom apps, but not needed for this purpose | High sensitivity | **Excluded** |
| Message / search / keystroke / screen / camera / mic capture | Not available through approved management APIs, and not acceptable | Covert surveillance | **Excluded, never build** |
| "Report everything the child does" | Not possible and not appropriate | | **Excluded.** The portal shows a data inventory of exactly what is collected. |
| iOS / iPadOS | Apple School Manager + MDM (supervised devices) and Screen Time APIs (FamilyControls / DeviceActivity / ManagedSettings) for family apps. The feature set and data access are different. | | **Separate future provider**. Same features are not implied. |

---

## 3. Recommended architecture

```
 ┌──────────────────────┐        HTTPS (Bearer session)        ┌───────────────────────────────┐
 │ Supervisor web portal │ ───────────────────────────────────▶ │  SafeTab API (Fastify)         │
 │ (parents / staff)     │                                      │  • auth, RBAC, tenant ctx      │
 └──────────────────────┘                                      │  • policy compiler             │
                                                               │  • billing service             │
 ┌──────────────────────┐   HTTPS (Bearer device token)        │  • audit                       │
 │ SafeTab Student app   │ ───────────────────────────────────▶ │                               │
 │ (visible, force-      │   notice, check-in, usage totals     └──────┬───────────┬─────────────┘
 │  installed by policy) │                                             │           │
 └─────────▲────────────┘                                    SQL (RLS) │           │ REST (service account)
           │ managed configuration                                     ▼           ▼
           │ (api url, one-time registration code)          ┌────────────────┐  ┌────────────────────────┐
 ┌─────────┴────────────┐   policy, commands                │ PostgreSQL 16  │  │ Android Management API │
 │ Android tablet        │ ◀──────────────────────────────── │ RLS per org_id │  │ (enterprises, policies,│
 │ (fully managed,       │                                   └───────▲────────┘  │  enrollmentTokens,     │
 │  Android Device Policy)│ ── status reports ──▶ Google ──▶ Pub/Sub ─┼─(push,     │  devices)              │
 └──────────────────────┘                                    OIDC JWT)│          └────────────────────────┘
                                                                     │
 ┌──────────────────────┐   redirect checkout   ┌──────────┐  signed webhook (HMAC-SHA512)
 │ Payer's browser       │ ────────────────────▶ │ Paystack │ ─────────────────────────────▶ /webhooks/paystack
 └──────────────────────┘                        └──────────┘ ◀── verify / disable (secret key, server only)

 Worker process (1 instance): downtime scheduler (every minute) · retention job (daily, owner DB role)
```

**Data flows**
1. **Policy change:** a supervisor sends `PUT /policy` with `expectedVersion`. The API checks RBAC and assignment, then checks billing is active, then versions the policy. It compiles one AMAPI policy per device, `PATCH`es it to AMAPI, and records a `policy_deployments` row with status `pending`. Later the device sends a status report through Pub/Sub. `appliedPolicyVersion` then moves the deployment to `applied`, or to `failed` with `nonComplianceDetails`. The status is never "applied" before the device confirms.
2. **Enrollment:** an admin creates a device slot. The API pushes the per-device policy (the force-installed companion app carries a one-time registration code in its managed configuration) and then creates a one-time enrollment token (24 h) whose QR is scanned at device setup. The AMAPI `ENROLLMENT` notification matches on `enrollmentTokenName` and activates the device. The companion app exchanges the code for its own device token. The policy is then re-pushed without the code.
3. **Usage:** if the policy enables summaries, the companion app posts *daily per-app minute totals*. The server rejects them unless summaries are enabled **and** billing is active. Retention deletes them after N days.
4. **Billing:** checkout is initialized server-side (amount and plan come from config, never the client). The redirect calls `/billing/verify`, which runs `GET /transaction/verify`. The webhook is HMAC-verified and deduplicated, then re-verified through the API before any state change.

**Hosting (pilot):** a container platform (e.g. Cloud Run, Fly, ECS) behind TLS. Managed Postgres with encryption at rest, PITR backups, and private networking. Secrets live in a secret manager and are injected as environment variables. Google Cloud project for AMAPI + Pub/Sub. Separate staging and production projects, Paystack accounts, and databases.

---

## 4. Roles, workflows and requirements

### Roles

| Role | Who | Can | Cannot |
|---|---|---|---|
| `org_admin` | Parent (Individual) / school IT lead | Everything in their org: members, invitations, billing, students, enrollment, policies, activity, audit log, export/delete, retention | See other orgs |
| `supervisor` | Second guardian / teacher | View assigned students, edit their policies, view their activity summary | Members, billing, enrollment, audit log, deletion, unassigned students |
| Device (companion app) | Enrolled tablet | Read its own notice, check in, upload its own usage totals | Anything else. Has no user account. |
| Student | Child | Sees the notice on the device. No portal login, and never types an adult's password. | |

An Individual subscriber is an org of kind `family`. A school is kind `school`. Both share one code path.

### Journeys

**Individual (family)**
1. The parent signs up (`/v1/auth/signup`, kind `family`). They are now `org_admin`.
2. They subscribe ($5/mo) through Paystack checkout. The account stays read-only until the payment is server-verified.
3. They create a child profile (nickname + age band).
4. They factory-reset the tablet, start setup, and scan the QR from "Add device". The device enrolls and installs the SafeTab app, which shows the notice.
5. They set downtime, app rules, and Chrome web rules. The portal shows each device's status as pending → applied / failed.
6. Optional: they invite a second guardian as `supervisor`.

**Organization (school)**
1. The IT lead signs up (kind `school`), subscribes ($30/mo), and connects the Android Enterprise (AMAPI signup URL flow).
2. They invite staff (an email-bound, single-use, 72 h invite) and assign students to each supervisor.
3. They create student profiles. They enroll devices in bulk (one QR token per device slot) during imaging.
4. They define policies per student. A later milestone could add policy templates per class.
5. They handle lost devices (lock + credential revoke) and end-of-year retirement (wipe with explicit confirmation).

**Student experience**
- The OS shows that the device is managed. The SafeTab app is always installed and cannot be blocked by policy.
- The app shows an age-appropriate notice: who manages the device, active controls, when downtime ends, whether usage summaries are being collected now, what is **not** collected, and the retention periods. It also says who to ask about it (school/parent).
- During downtime the device shows only the SafeTab app, with the end time.

### Requirements checklist (implemented unless marked)
- Secure invitations bound to an email ✅; enrollment via a one-time token ✅; no plaintext passwords (argon2id) ✅; hashed session/device/invite tokens ✅
- Tenant isolation through RLS + object-level checks ✅; 404 for foreign resources ✅
- Policy statuses pending / applied / failed, plus per-control supported/limitation notes ✅
- Audit of sensitive actions, including *viewing* activity ✅
- Data inventory endpoint ✅; export ✅; deletion ✅; configurable retention ✅
- MFA for org admins ⏳ (milestone 9); email delivery and verification ⏳; password reset ⏳

---

## 5. Data model and API design

Full DDL: [`db/migrations/001_init.sql`](../db/migrations/001_init.sql).

| Entity | Key fields | Notes |
|---|---|---|
| `organizations` | kind, name, country, usage/audit retention days, amapi_enterprise | Tenant root |
| `users` | email (citext, unique), password_hash (argon2id), lockout fields | Adults only |
| `sessions` | token_hash, expires_at (12 h), revoked_at | Opaque bearer tokens, stored as HMAC only |
| `memberships` | (org_id, user_id), role | |
| `invitations` | email, role, token_hash, expires_at, accepted_at | Email-bound, single use |
| `students` | display_name, age_band | No DOB, photo, contact details, or location |
| `supervisor_assignments` | (org, user, student) | Composite FKs keep it in the same org |
| `devices` | student, ownership, state, enrollment token, mdm name, applied version, compliance, in_downtime | |
| `device_credentials` | registration_code_hash, token_hash, revoked_at | Companion app identity |
| `policies` | (org, student), version, spec (jsonb, zod-validated) | Optimistic concurrency |
| `policy_deployments` | device, spec_version, policy_version (MDM), reason, status, detail | Status of each push |
| `app_usage_daily` | device, student, day, package, minutes | Aggregates only |
| `audit_log` | actor, action, target, metadata, ip | Append-only for the app role |
| `subscriptions` | plan, status, period end, grace, Paystack codes | One per org |
| `payments` | reference, plan, amount, currency, status | Server-generated references |
| `webhook_events` | id (provider + message id / body hash) | Idempotency |
| `data_requests` | kind export/delete | Accountability for data-subject requests |

**Authorization rules**
1. Every org-scoped request resolves `(user, org)` membership. The org must be the one in the URL; otherwise the response is 404.
2. A role-permission matrix applies (`src/auth/rbac.ts`).
3. Object-level checks: a supervisor may only act on assigned students (404 otherwise).
4. Every query runs inside `withTenant(orgId)`, which sets the transaction-local `app.org_id`. Postgres RLS on every tenant table then rejects cross-tenant reads and writes, even if a query lacks a `WHERE` clause. Cross-tenant lookups that webhooks and login need go through narrow `SECURITY DEFINER` functions that return only an org id.
5. Entitlement gate: enrollment, policy writes, and usage ingestion require `full` access. Reads, export, deletion, retirement, and billing always work.

**Endpoints (implemented)**

| Method & path | Permission | Notes |
|---|---|---|
| `POST /v1/auth/signup` · `POST /v1/auth/login` · `POST /v1/auth/logout` · `GET /v1/me` | none / session | Rate-limited 10/min. Lockout after 5 failures. |
| `POST /v1/invitations/accept` | invite token (+ session if account exists) | Email must match |
| `GET /v1/orgs/:org` · `PATCH /v1/orgs/:org/settings` | member / org.manage | Retention settings |
| `GET /v1/orgs/:org/data-inventory` | member | What is and isn't collected |
| `POST /v1/orgs/:org/invitations` · `GET /members` · `PUT /members/:u/assignments` · `DELETE /members/:u` | org.manage | Last admin protected |
| `GET /v1/orgs/:org/audit` | audit.read | Paginated |
| `POST/GET /v1/orgs/:org/students` · `GET /students/:s` | student.create / student.read | |
| `GET/PUT /v1/orgs/:org/students/:s/policy` | student.read / policy.write | `PUT {spec, expectedVersion}` → 409 on conflict, 402 if read-only |
| `GET /v1/orgs/:org/students/:s/activity?days=7` | activity.read | Audited |
| `GET /v1/orgs/:org/students/:s/export` · `DELETE /students/:s` | data.export / data.delete | Delete requires devices retired first |
| `PUT /v1/orgs/:org/android-enterprise` | org.manage | Set by the AMAPI signup callback in production |
| `POST /v1/orgs/:org/students/:s/devices` | device.enroll | Returns QR payload |
| `GET /v1/orgs/:org/devices` · `POST /devices/:d/lost` · `POST /devices/:d/retire {confirmWipe:true}` | device.manage | |
| `GET /v1/orgs/:org/billing` · `POST /billing/checkout` · `POST /billing/verify` · `POST /billing/cancel` | billing.manage | |
| `POST /device/v1/register` · `GET /device/v1/notice` · `POST /device/v1/checkin` · `POST /device/v1/usage` | device token | |
| `POST /webhooks/paystack` | HMAC signature | |
| `POST /webhooks/amapi` | Pub/Sub OIDC JWT | |

**Policy spec (validated by zod, `src/policy/spec.ts`)**
```json
{
  "downtime": { "enabled": true, "timezone": "Africa/Accra",
                "windows": [{ "days": [1,2,3,4,5], "start": "21:00", "end": "06:30" }] },
  "apps": { "mode": "allowlist", "packages": ["org.example.reader", "org.example.math"] },
  "web": { "mode": "blocklist", "domains": ["example-games.test", "*.example-video.test"] },
  "usageSummaries": { "enabled": false }
}
```
Validation: domains only (no paths or queries), valid Android package names, IANA time zones, list caps (500 apps, 1000 domains, 14 windows).

**Event schemas**
- Device usage upload: `{ "day": "YYYY-MM-DD", "apps": [{ "package": "org.example.reader", "minutes": 30 }] }`. At most 300 apps, minutes between 0 and 1440, day within −1 to +3 days of now.
- AMAPI push (Pub/Sub): `{ message: { data: base64(Device JSON), attributes: { notificationType: "ENROLLMENT" | "STATUS_REPORT" | … }, messageId } }`.
- Paystack: `{ event: "charge.success" | "subscription.create" | "invoice.payment_failed" | "subscription.not_renew" | "subscription.disable" | …, data: {...} }`.

---

## 6. Privacy and security design

### Threat model and mitigations

| Threat | Mitigations (✅ implemented · ⏳ planned) |
|---|---|
| **Account takeover** (supervisor) | ✅ argon2id; ✅ min 12-char passwords; ✅ lockout after 5 failures for 15 min, generic errors, dummy hash for unknown emails; ✅ rate limits; ✅ 12 h sessions, revocable, stored as HMAC. ⏳ TOTP/WebAuthn MFA **required for org_admin**; ⏳ breached-password check; ⏳ email verification and secure reset (single-use, 30 min, hashed token, all sessions revoked on reset); ⏳ new-login email alerts. |
| **Unauthorized enrollment / linking** | ✅ One-time, 24 h AMAPI tokens that only admins can create; ✅ factory-reset QR flow (visible); ✅ the companion registration code is delivered only through managed configuration, is single use, expires in 7 days, and is stored hashed; ✅ invitations are email-bound and single use; ✅ no child-side login. |
| **Cross-tenant access** | ✅ Postgres RLS on every tenant table, app role without BYPASSRLS; ✅ transaction-local tenant setting; ✅ composite FKs (org_id, id); ✅ 404 for foreign IDs; ✅ tests for each layer. |
| **Webhook spoofing / replay** | ✅ Paystack HMAC-SHA512 over the raw body, constant-time compare; ✅ every payment re-verified through the API, with amount, currency, reference, and org checked; ✅ idempotency table; ✅ Pub/Sub OIDC JWT (audience + service account), failing closed. ⏳ Optional Paystack source-IP allowlist at the edge. |
| **Device loss / theft** | ✅ Lock command; ✅ companion credential revoked; ✅ wipe via retire (needs explicit confirmation); ✅ factory reset disabled on school-owned devices; ✅ no sensitive data cached on the device beyond its own notice. |
| **Inappropriate staff access** | ✅ Least privilege (assignment-scoped supervisors); ✅ activity views are audited with viewer and student; ✅ audit log is append-only for the app; ⏳ admin-facing "who viewed what" report; ⏳ periodic access review. |
| **Insider / DB leak** | ✅ No content collected; ✅ tokens hashed with a server pepper; ⏳ encryption at rest (managed DB), TLS to DB, secrets in a secret manager, separate prod access with break-glass auditing. |
| **Abuse for covert monitoring of others (e.g. partner surveillance)** | ✅ Fully managed enrollment needs a factory reset; ✅ persistent OS and app notices; ✅ the companion app cannot be removed by policy; ✅ no content or location features; ⏳ ToS + age gating + abuse reporting route. |

### Retention and deletion
- `app_usage_daily`: org setting, 1–90 days (default 30). The daily job deletes older rows.
- `audit_log`: 90–2555 days (default 365). Only the owner-role job can delete.
- Sessions and webhook dedupe records are purged after 7 / 30 days.
- Student deletion requires retiring their devices first. It then cascades to devices, policies, deployments, and usage. Audit entries keep only IDs.
- **No deletion is triggered by a billing lapse.** The org becomes read-only, collection pauses, and normal retention continues. A formal account-closure policy (for example, notice at 60 days lapsed, deletion at 90 days with export offered) is an open decision (§10).
- Backups: deleted data stays in backups until backup expiry (e.g. 30 days). Disclose this.

### Logging guidance
- Request logs redact `authorization`, cookies, and Paystack signatures. Never log bodies of `/device/v1/usage`, auth routes, or webhooks.
- Audit metadata holds counts and modes (e.g. `appCount`), never package lists, tokens, or passwords.

### Privacy review checklist (for the school's privacy/legal lead)
- [ ] Lawful basis or authority for processing student data in `[deployment jurisdiction]`: education law, child-privacy law (parental consent thresholds by age), and data-protection law.
- [ ] Data Processing Agreement between the school (controller) and the operator (processor). Sub-processors: hosting, Google (AMAPI/Pub/Sub), Paystack.
- [ ] Data-protection impact assessment (children + monitoring = high risk in many regimes).
- [ ] Wording of student/parent notices for each age band, and their languages.
- [ ] Whether usage summaries are necessary at all for the school purpose. Default off.
- [ ] Retention periods, and the backup retention disclosure.
- [ ] Data residency and cross-border transfer (hosting region, Google, Paystack).
- [ ] Process for subject access, export, correction, and deletion requests, with response times.
- [ ] Breach-notification procedure and contacts.
- [ ] School-device scope: management is limited to school devices. Data outside school hours or on personal devices is out of scope.
- [ ] Consumer-protection requirements for subscriptions: clear pricing, renewal disclosure, easy cancellation, refunds.

---

## 7. Subscription and Paystack design

### Plans and entitlements

| Plan | Price (config) | Org kind | Default limits (to confirm) |
|---|---|---|---|
| Individual | `PLAN_INDIVIDUAL_AMOUNT=500` (USD 5.00/month) | family | 5 students, 5 devices, 2 adults |
| Organization | `PLAN_ORGANIZATION_AMOUNT=3000` (USD 30.00/month) | school | 300 students, 300 devices, 30 adults |

Amounts are in currency subunits. They and the Paystack plan codes live in env config. The client cannot choose an amount.

### State machine

```
none ──charge.success (API-verified)──▶ active ──subscription.not_renew──▶ non_renewing ─(period end)─▶ lapsed*
                                         │  ▲                                                      
            invoice.payment_failed       │  │ charge.success (renewal, API-verified)              
                                         ▼  │                                                      
                                       past_due ──(grace_until passes)──▶ lapsed*
 active ──user cancel / subscription.disable──▶ cancelled ──(period end)──▶ read-only
 (*) "lapsed" is computed from status + dates, so a missed webhook cannot extend or cut access early.
```

| Access | When | Behaviour |
|---|---|---|
| `full` | active (period open, or within grace); non_renewing/cancelled before period end; past_due before `grace_until` (default 7 days) | Everything |
| `read_only` | none, lapsed, cancelled after period end | No enrollments or policy changes (402 `subscription_inactive_read_only`). Usage uploads refused, and the device notice says collection is paused. **Devices keep their last applied policy** (protections are not stripped abruptly). View, export, delete, retire, and re-subscribe still work. Nothing is deleted. |

### Payment flow
1. `POST /billing/checkout`: the server creates a `payments` row (`st_<uuid>` reference, the plan's amount and currency) and calls `POST /transaction/initialize` with `plan`, `reference`, `callback_url`, and `metadata.org_id`. The browser is redirected to `authorization_url`.
2. After the redirect, the portal calls `POST /billing/verify {reference}`. The server calls `GET /transaction/verify/:reference` and accepts only `status=success` with matching reference, amount, currency, and org. Any mismatch is audited and does not activate.
3. Webhooks (`/webhooks/paystack`): raw body, `x-paystack-signature` = HMAC-SHA512(secret key). The event is deduplicated by body hash. `charge.success` is re-verified through the API. `subscription.create` stores `subscription_code` and `email_token`. `invoice.payment_failed` sets past_due + grace. `subscription.not_renew` and `subscription.disable` are handled. Unknown events are acknowledged with 200.
4. Cancel: `POST /subscription/disable {code, token}`. Paid time is honoured.

### Configuration and Paystack caveats (verify in current docs)
- Secrets: `PAYSTACK_SECRET_KEY` only in a secret manager or env. Use test keys (`sk_test_…`) in non-production. The server warns if prod runs a test key.
- **Currency:** Paystack settles in the merchant's local currency(ies). USD charging is not available to every merchant country and may need Paystack approval. If USD is unavailable, set `BILLING_CURRENCY` (e.g. NGN, GHS, ZAR, KES) and local-currency amounts, and show the converted price clearly.
- **Recurring billing:** Paystack subscriptions charge a saved card authorization. Check which payment channels support recurring charges in your country (e.g. mobile money or bank transfer may not), and what happens with expiring cards (`subscription.expiring_cards`).
- Check the exact webhook event names and payload fields for subscriptions and invoices, plan intervals, and the `next_payment_date` semantics.
- Check whether Paystack publishes webhook source IPs if you want an edge allowlist.
- Tax/VAT on digital services in the deployment country (finance review).

---

## 8. Implementation milestones

Prerequisites: Node 22+, PostgreSQL 16 (or Docker), and later a Google Cloud project and a Paystack test account.

```bash
cp .env.example .env              # then fill in sample values / test keys
docker compose up -d db           # or use a local Postgres 16
npm install
npm run migrate                   # uses DATABASE_OWNER_URL
npm run dev                       # API on :3000 with MDM_PROVIDER=fake
npm test                          # needs the test DB (see README)
```

| # | Milestone | Files | Done when | Status |
|---|---|---|---|---|
| 1 | Schema, RLS, migration runner | `db/migrations/001_init.sql`, `src/db/*` | RLS tests pass with the non-owner app role | ✅ |
| 2 | Auth, sessions, orgs, invitations, RBAC | `src/auth/*`, `src/routes/auth.ts`, `src/routes/org.ts` | `test/tenancy.test.ts` | ✅ |
| 3 | Students, policy model + compiler, audit | `src/policy/*`, `src/routes/students.ts`, `src/audit.ts` | `test/unit.test.ts` | ✅ |
| 4 | MDM abstraction, enrollment, AMAPI webhook, status reconciliation | `src/mdm/*`, `src/routes/devices.ts`, `src/routes/webhooks.ts`, `src/policy/deploy.ts` | `test/devices.test.ts` | ✅ (fake provider) |
| 5 | Companion device API, usage ingestion, notice | `src/routes/device-api.ts` | `test/devices.test.ts` | ✅ |
| 6 | Billing: checkout, verify, webhooks, entitlements | `src/billing/*`, `src/routes/billing.ts` | `test/billing.test.ts` | ✅ (fake Paystack) |
| 7 | Jobs: downtime scheduler, retention | `src/jobs/*` | `test/devices.test.ts` | ✅ |
| 8 | **Real AMAPI integration**: Cloud project, enterprise signup callback, Pub/Sub topic + authenticated push subscription, `AmapiProvider` against a test enterprise | `src/mdm/amapi.ts`, new `src/routes/android-signup.ts` | Manual checklist §9 on 2+ physical tablets | 🟡 signup flow, status polling (no Pub/Sub) and `npm run pilot` built and tested with fakes; real-device run pending (see `docs/PILOT_SETUP.md`) |
| 9 | Account security: MFA for admins, email verification, password reset, email delivery of invites | new `src/auth/mfa.ts`, mail adapter | Tests + pen-test | ⏳ |
| 10 | Supervisor web portal (responsive) | separate `portal/` app (e.g. React + Vite) | Usability check with 2 schools and 2 families | ⏳ |
| 11 | Student companion app (Kotlin) | separate `android/` project | Real-device test; Play publishing as a private app | ⏳ (sample below) |
| 12 | Hardening: outbox for MDM calls, advisory lock for worker, metrics, alerts, backups | | Load + failure tests | ⏳ |

### Key code excerpts (see `src/` for full code)

Tenant-scoped transaction (`src/db/pool.ts`):
```ts
await client.query("BEGIN");
await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]); // tx-local
```

RLS policy (`db/migrations/001_init.sql`):
```sql
CREATE POLICY tenant_isolation ON students
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
```

Paystack signature (`src/billing/paystack.ts`):
```ts
const expected = createHmac("sha512", secretKey).update(rawBody).digest();
return given.length === expected.length && timingSafeEqual(given, expected);
```

### Milestone 8: AMAPI setup steps (to validate against current Google docs)
1. Create a Google Cloud project and enable the **Android Management API** and **Pub/Sub**.
2. Create a service account with the Android Management User role. Use workload identity or a secret-managed key, never committed.
3. Org onboarding: `signupUrls.create` → the school admin completes the Google flow → the callback receives `enterpriseToken` → `enterprises.create` with `pubsubTopic` and `enabledNotificationTypes: [ENROLLMENT, STATUS_REPORT]` → store `enterprises/…` on the org.
4. Pub/Sub: grant `android-cloud-policy@system.gserviceaccount.com` publish rights on the topic. Create a **push subscription** to `https://<host>/webhooks/amapi` with authentication enabled (service account + audience = `PUBSUB_PUSH_AUDIENCE`).
5. Publish the companion app as a **private app in managed Google Play** for each enterprise (or publicly), so `FORCE_INSTALLED` and `KIOSK` work.
6. Set `MDM_PROVIDER=amapi` in staging only, then enroll test tablets.

### Milestone 11: companion app sample (Kotlin, illustrative, not built here)
```kotlin
// Reads the managed configuration delivered by the policy (official API).
val rm = getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager
val cfg = rm.applicationRestrictions
val apiBase = cfg.getString("api_base_url")
val regCode = cfg.getString("registration_code")      // present until registered

// Usage totals: only if the policy enabled summaries AND the user granted "Usage access"
// in Settings (special app access). Show a persistent in-app indicator while enabled.
fun dailyTotals(context: Context, start: Long, end: Long): Map<String, Int> {
    val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    return usm.queryAndAggregateUsageStats(start, end)
        .mapValues { (_, s) -> (s.totalTimeInForeground / 60_000).toInt() }
        .filterValues { it > 0 }
}
// POST {day, apps:[{package, minutes}]} to /device/v1/usage once per day.
// Store the device token in EncryptedSharedPreferences / Android Keystore.
```
The app must show the notice from `/device/v1/notice` on its home screen, display "Downtime until HH:MM" in kiosk mode, and never request permissions beyond network and usage access.

---

## 9. Testing and deployment checklist

### Automated (this repo, `npm test`, 51 tests)
- **Unit:** policy validation, overnight/time-zone downtime evaluation, compiler (companion app never blocked, kiosk in downtime, Chrome-only web filtering, registration code handling), entitlements (none / grace / cancelled), Paystack HMAC.
- **Authorization:** 401 without a session; 404 across tenants; RLS blocks reads and writes without a `WHERE`; supervisor scoping; admin-only routes return 403; invitation email binding and single use; last-admin protection; lockout; logout revocation; hashed secrets.
- **Enrollment and device policy:** subscription + enterprise prerequisites; policy before token; unauthenticated Pub/Sub rejected; ENROLLMENT activation; pending → applied on status report; non-compliance → failed; failed MDM push recorded; duplicate push ignored; single-use registration, with the code removed from config afterwards; usage gated by policy; downtime switch in and out.
- **Billing webhooks:** server-side amounts; mismatch and pending verification do not activate; bad and missing signatures rejected; idempotent `charge.success`; subscription codes stored; payment failure → grace → lapsed read-only without data loss; cancellation; unknown references ignored.
- **Privacy:** export contents, retention deletion, deletion cascade after retire-with-confirmation.

### Not covered automatically (needs real systems)
- [ ] `AmapiProvider` against a real test enterprise (requests, error handling, quotas).
- [ ] Pub/Sub OIDC verification with real tokens.
- [ ] Paystack test-mode end-to-end: checkout page, card charge, real webhooks, a renewal (use a short plan interval in test mode if available), failed card, cancellation.

### Manual device checklist (2+ physical tablets, ideally different OEMs and Android versions)
- [ ] Factory reset → QR enrollment → SafeTab app auto-installs → notice visible.
- [ ] Blocked app disappears or cannot launch; allowlist mode hides other Play apps.
- [ ] Chrome blocks listed domains; check another browser cannot be installed in allowlist mode.
- [ ] Downtime: kiosk starts within about 1–2 min of the boundary when online; behaviour when offline at the boundary (documented as a limitation); exits correctly.
- [ ] Usage access must be granted visibly; totals roughly match Settings → Digital Wellbeing.
- [ ] Mark lost → device locks; companion token rejected.
- [ ] Retire → device wipes (school device) and leaves management.
- [ ] Factory-reset protection is disabled on school-owned devices; behaviour of family devices.
- [ ] Accessibility: notice readable at large font sizes; under-13 wording reviewed.

### Deployment readiness
- [ ] Separate staging and prod (DB, Google project, Paystack keys). `MDM_PROVIDER=fake` is refused in prod.
- [ ] TLS everywhere; HSTS; DB private network + TLS; encryption at rest; PITR backups tested.
- [ ] Secrets in a secret manager, rotation plan for `TOKEN_PEPPER` (rotating it invalidates sessions and device tokens, so plan re-registration), Paystack key, and the service account.
- [ ] Run migrations with the owner role. The app runs as `safetab_app` (NOBYPASSRLS).
- [ ] Exactly one worker instance (downtime and retention), or an advisory lock.
- [ ] Monitoring: 5xx rate, webhook failures, AMAPI error rate, pending deployments older than 1 h, devices not reporting for over 72 h, retention job success, payment mismatches (audit `billing.payment_mismatch`).
- [ ] Incident and breach-response runbook. On-call contact for schools.
- [ ] Privacy notices, ToS, and DPA published. Privacy checklist (§6) signed off.
- [ ] External security review / pen-test before onboarding real students.

---

## 10. Open decisions and official documentation to verify

**Open decisions (no answers assumed)**
1. **Can AMAPI be used for the Individual (consumer/family) plan?** Review Google's Android Management API terms and permissible-use policy, and whether production use needs enrollment in the Android Enterprise partner program or quota approval. If consumer use is not permitted, the Individual plan on Android needs a different, compliant approach, or it launches for school-managed devices only.
2. Deployment jurisdiction, lawful basis, and consent model (`[deployment jurisdiction]`).
3. Paystack merchant country, currency (USD vs local), VAT, and refund policy.
4. Final plan limits, and whether the Organization plan should be per device or tiered (USD 30 for 300 devices is a placeholder).
5. Retention defaults and the account-closure schedule after a lapse.
6. Whether usage summaries are offered to schools at all, or only to families.
7. BYOD/work-profile support and iOS support (separate scope).
8. Hosting region / data residency.

**Official documentation to verify against current versions**
- Android Management API reference: `enterprises.policies` (`applications.installType`, `playStoreMode` enum names, `kioskCustomization`, `managedConfiguration`), `enterprises.enrollmentTokens` (`duration`, `oneTimeOnly`, `additionalData`, `allowPersonalUsage`), `enterprises.devices` (`appliedPolicyVersion`, `nonComplianceDetails`, `issueCommand`, `delete` behaviour), Pub/Sub notifications (`notificationType` values, payload), signup URL / enterprise creation flow, quotas, terms of service and permissible use.
- Google Cloud Pub/Sub: authenticated push subscriptions and OIDC token claims.
- Chrome Enterprise policies for Android (`URLBlocklist`, `URLAllowlist`) and their managed-configuration keys.
- Android `UsageStatsManager` and the Usage-access special permission. `RestrictionsManager` / managed configurations.
- Paystack: Transaction Initialize / Verify, Plans, Subscriptions (create/disable/manage link), webhook events and signature, supported currencies and channels per country, recurring-charge requirements.
- OWASP Password Storage and Authentication cheat sheets (argon2id parameters, MFA, reset flows).
- Applicable child-privacy, education-records, consumer-protection, and data-protection laws for the jurisdiction (legal review, not engineering).
