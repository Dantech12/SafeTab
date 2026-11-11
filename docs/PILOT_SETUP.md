# Pilot setup: enroll your first test tablet

This guide runs SafeTab **on your own computer** with your Google Cloud project, so you can enroll a real tablet.

- It needs no credit card: device status is fetched by polling instead of Pub/Sub, and billing is activated locally for the pilot, so Paystack isn't involved.
- It's for testing only. Don't enroll a device that anyone relies on, and don't use real student data.

## What you need
- A computer running Windows, macOS or Linux, with:
  - [Node.js 22 or newer](https://nodejs.org)
  - [Git](https://git-scm.com)
  - [Docker Desktop](https://www.docker.com/products/docker-desktop/) (runs the database)
- The service-account key `.json` file you downloaded. Move it to a folder **outside** the project, for example `Documents/keys/safetab-amapi.json`.
- Your Google Cloud project ID (e.g. `silent-snow-471809-m2`).
- An Android tablet you are allowed to factory-reset.

## 1. Get the code and start the database
```bash
git clone https://github.com/Dantech12/SafeTab.git
```
```bash
cd SafeTab
```
```bash
npm install
```
```bash
docker compose up -d db
```

## 2. Create your `.env` file
Copy the example, then edit it:
```bash
cp .env.example .env
```
On Windows Command Prompt use `copy .env.example .env` instead.

Open `.env` in a text editor and change only these lines:

| Setting | Value |
|---|---|
| `TOKEN_PEPPER` | A long random string. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `MDM_PROVIDER` | `amapi` |
| `GOOGLE_CLOUD_PROJECT_ID` | your project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | the full path to your key file |
| `PAYSTACK_SECRET_KEY` | leave the sample value for now (not used in this pilot) |

Leave `COMPANION_APP_ENABLED=false`. The SafeTab student app isn't published yet. Until it is, **app blocking and Chrome web rules work, but downtime and usage summaries are shown as "not supported"**.

`.env` is already in `.gitignore`. Never commit it, and never share the key file.

## 3. Set up the database
```bash
npm run migrate
```

## 4. Start SafeTab (two terminal windows)
Window 1, the API:
```bash
npm run dev
```
Window 2, the worker (checks device status every 5 minutes):
```bash
npm run worker
```

## 5. Run the guided setup (third terminal window)
```bash
npm run pilot
```
It walks you through these steps:
1. **Admin account:** create one (email + a password of 12+ characters).
2. **Billing:** activated for 30 days without payment. This is local pilot only.
3. **Connect Android:** it prints a Google link. Open it, sign in with a Google account (a personal Gmail is fine for testing), and follow Google's steps. Google only returns to `https://` addresses, so on your computer it ends on a static Google page. That page may look blank or say "not found", and that's expected. **Copy the whole address from the browser's address bar** (it contains `enterpriseToken=`) and paste it into the script. If your server has a public `https://` address in `PUBLIC_BASE_URL`, Google returns straight to SafeTab instead, and the browser shows **"Android connected"**.
4. **QR code:** it creates a test student and saves `pilot-enrollment-qr.png`. The QR works once and expires after 24 hours.

## 6. Enroll the tablet
1. Factory-reset the tablet (**Settings → System → Reset options → Erase all data**). Everything on it is erased.
2. On the first **Welcome** screen, tap the same blank spot **6 times**. A QR scanner opens. On some devices it asks to connect to Wi-Fi first.
3. Scan `pilot-enrollment-qr.png` from your computer screen.
4. Follow the on-screen setup. The tablet shows that it is managed by your organization.
5. Within about 5 minutes, the worker window logs the device, and it becomes **active**.

## 7. Try a control
Block an app (for example YouTube, `com.google.android.youtube`) using the commands below.

Get your session token by signing in. Replace the email and password with yours:
```bash
curl -s -X POST http://localhost:3000/v1/auth/login -H "content-type: application/json" -d '{"email":"YOU@example.com","password":"YOUR PASSWORD"}'
```
The response contains `token` and your `org_id`. Then list students to get the student ID:
```bash
curl -s http://localhost:3000/v1/orgs/ORG_ID/students -H "authorization: Bearer TOKEN"
```
Set the policy. Use `"expectedVersion": 0` the first time, then the version the API returns:
```bash
curl -s -X PUT http://localhost:3000/v1/orgs/ORG_ID/students/STUDENT_ID/policy -H "authorization: Bearer TOKEN" -H "content-type: application/json" -d '{"expectedVersion":0,"spec":{"apps":{"mode":"blocklist","packages":["com.google.android.youtube"]}}}'
```
Then watch the status go from `pending` to `applied` once the tablet reports in (up to about 5 minutes):
```bash
curl -s http://localhost:3000/v1/orgs/ORG_ID/students/STUDENT_ID/policy -H "authorization: Bearer TOKEN"
```
(On Windows, run these in Git Bash, which comes with Git. The quoting differs in Command Prompt.)

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| `Invalid configuration for: …` | A setting in `.env` is missing or malformed. The message names it. |
| `PERMISSION_DENIED` / 403 from Google | Check that the key file path is right, that the service account has the **Android Management User** role, and that the API is enabled in *this* project. |
| Google asks for billing during signup | Stop and tell us. Don't enter card details for this pilot. |
| QR scanner doesn't open after 6 taps | Make sure the tablet is fully factory-reset and on the very first screen. Some devices need Android 7+ and Google Play services. |
| `INSECURE_CALLBACK_URL` in the server window | You are on an old version. Run `git pull` and restart the server. |
| "Google did not accept it" after pasting | The link expires, and each one works once. Run `npm run pilot` again for a fresh link. |
| Device never becomes active | Check that the worker is running and that `DEVICE_STATUS_MODE=poll`. |

## Before anything beyond a test
This setup gives no payment, no student app, and runs on your laptop. See `docs/IMPLEMENTATION_GUIDE.md` §9–10 for what production needs.
