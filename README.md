# SafeTab

SafeTab is a transparent, privacy-preserving device-management service for school tablets and family devices. It has two parts:

- **Supervisor API:** parents and authorized school staff manage downtime, app rules, and web rules, and see limited summaries.
- **Device API:** used by the visible SafeTab companion app on enrolled Android devices.

SafeTab uses only official platform features: Android Enterprise via the Android Management API, and Paystack for billing. It **does not** do covert monitoring. It never collects message content, keystrokes, screenshots, camera or microphone input, location, or browsing history.

➡️ **Full design and plan:** [`docs/IMPLEMENTATION_GUIDE.md`](docs/IMPLEMENTATION_GUIDE.md)
➡️ **Enroll a real test tablet from your computer:** [`docs/PILOT_SETUP.md`](docs/PILOT_SETUP.md)

➡️ **Students' own (parent-owned) tablets:** [`docs/PARENT_OWNED_TABLETS.md`](docs/PARENT_OWNED_TABLETS.md)

> Pilot backend, **not production-ready**. It still needs real-device validation, a security review, and a privacy/legal review. The open items are listed in the guide.

## Stack
Node.js 22 · TypeScript · Fastify 5 · PostgreSQL 16 (row-level security per tenant) · zod · argon2id · vitest

## Run locally
```bash
cp .env.example .env            # sample values only; use Paystack *test* keys
docker compose up -d db         # Postgres 16 + non-owner app role (db/dev-init.sql)
npm install
DATABASE_OWNER_URL=postgres://safetab:safetab_dev_only@localhost:5432/safetab npm run migrate
npm run dev                     # then open http://localhost:3000 (portal); MDM_PROVIDER=fake touches no real devices
```

## Tests
Tests use a real PostgreSQL database and **drop and recreate its `public` schema**, so point them only at a disposable database:
```bash
# one-time, as a Postgres superuser
psql -c "CREATE ROLE safetab LOGIN PASSWORD 'safetab_dev_only';" \
     -c "CREATE ROLE safetab_app LOGIN PASSWORD 'safetab_app_dev_only' NOBYPASSRLS;" \
     -c "CREATE DATABASE safetab_test OWNER safetab;"
npm test
npm run typecheck
```

## Layout
```
db/migrations/      schema + RLS policies + narrow SECURITY DEFINER lookups
src/app.ts          Fastify app, auth helpers, error handling
src/auth/           passwords (argon2id), RBAC matrix + object-level checks
src/routes/         auth, org, students/policy/activity, devices, device-api, billing, webhooks
src/policy/         policy spec (zod), AMAPI compiler, deployment + status reconciliation
src/mdm/            MdmProvider interface, AMAPI client, fake provider, Pub/Sub verifier
src/billing/        Paystack client + signature, payment verification, entitlements
src/jobs/           downtime scheduler, retention, worker entrypoint
test/               unit + integration tests (tenancy, devices, billing)
```

## Secrets
Never commit `.env`, service-account keys, or Paystack keys. `.gitignore` covers the common names. Production secrets belong in a secret manager.
