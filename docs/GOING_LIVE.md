# Going live: from local pilot to a real business

Steps 1–3 can be done today, on your PC. Steps 4–7 are needed before you take real payments.

## 1. Your business details
Add these lines to `.env` (`notepad .env`), then restart SafeTab:
```
BUSINESS_NAME=SafeTab
SUPPORT_EMAIL=you@yourdomain.com
BUSINESS_ADDRESS=Your street, Accra, Ghana
BUSINESS_COUNTRY=Ghana
```
They appear in the footer and on the Terms, Privacy, Refunds and Contact pages.

## 2. "Continue with Google" (free)
1. In **console.cloud.google.com**, use your project.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - App name: `SafeTab`, support email: yours.
   - Scopes: leave the defaults (email, profile, openid).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI: `http://localhost:3000/auth/google/callback`. Add your real domain's `https://…/auth/google/callback` later.
4. Save the **Client ID** and **Client secret** with this command. It asks for both and writes them to `.env`, with a backup:
   ```
   npm run set-google-signin
   ```
5. Restart SafeTab. The "Continue with Google" button appears.

While the consent screen is in **Testing** mode, only accounts you add as test users can sign in. Click **Publish app** to allow everyone. These basic scopes normally don't need Google's review.

## 3. "Continue with Microsoft" (free)
1. In **portal.azure.com**, go to **Microsoft Entra ID → App registrations → New registration**.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI: **Web**, `http://localhost:3000/auth/microsoft/callback`.
2. **Certificates & secrets → New client secret**, and copy the **Value**.
3. In `.env`:
   ```
   MICROSOFT_OAUTH_CLIENT_ID=<Application (client) ID>
   MICROSOFT_OAUTH_CLIENT_SECRET=<secret value>
   ```
4. Restart SafeTab.

How accounts are linked:
- A Google sign-in links to an existing email/password account only when Google has verified the email.
- A Microsoft sign-in never links by email, because Microsoft doesn't guarantee the address is verified.

## 4. Put SafeTab online
Customers and parents need a real address, e.g. `https://safetab.com.gh`. You need:
- a domain
- a hosting service that runs Node.js and PostgreSQL with HTTPS
- `PUBLIC_BASE_URL` set to your domain

Then add the domain's callback URLs to Google and Microsoft (steps 2 and 3).

## 5. Paystack live payments
- Complete Paystack's business activation in the dashboard. They ask for business registration documents.
- Use **live** keys (`sk_live_…`) only on the online server.
- Paystack reviews your website. The Terms, Privacy, Refunds and Contact pages are there for this.

## 6. Legal review
The Terms, Privacy Policy and Refund Policy (`src/routes/site.ts`) are a **starting template**. Have a lawyer review them for your business and for Ghana's Data Protection Act, 2012 (Act 843). Also consider registering with Ghana's Data Protection Commission.

## 7. ⚠️ The product must work before you charge
SafeTab can't enroll real tablets until Google approves the Android Management API project, which requires a DUNS number (see the README). Until then, keep the site as **Early access** and don't take live payments. Charging for a service that can't yet be delivered can breach consumer protection rules and can get a Paystack account frozen.

## Not built yet
- Password reset and invitation emails. These need an email service (e.g. a free tier of an email API).
- Invoices sent by SafeTab. Paystack sends payment receipts.
