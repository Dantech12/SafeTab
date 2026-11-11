# Parent-owned tablets: school-hours rules with parent consent

This applies when students bring tablets their **parents bought**. The school may switch off chosen apps (for example TikTok and games) **during school hours only**, and **only with a parent's recorded consent**. Your school's privacy/legal lead must approve this process before it's used with real families.

## How it works
1. **Staff set the school-hours rules** on the student's page: days, times, and the apps to switch off.
2. **Staff invite a parent** (*Parents & consent → Invite parent*) and send the link by email or WhatsApp. The link works once, for 3 days, and only for that email address.
3. **The parent creates their SafeTab login.** They see the exact rules in plain language and sign by typing their name. Only the parent can do this; staff cannot agree for them.
4. **Staff add the tablet** as *Parent-owned*. SafeTab refuses until consent is recorded. The tablet is reset once and enrolled (back it up first).
5. **During school hours**, the listed apps are **switched off, not deleted**, so their data is kept. Outside school hours nothing is restricted.

## Safeguards built in
- **Only school-hours rules apply** to parent-owned tablets. Always-on app blocking, website rules, downtime and screen-time collection are never applied to them.
- **Rule changes need new consent.** If the school changes the days, times or app list, enforcement pauses on that tablet until the parent agrees to the new version.
- **Withdrawal at any time.** The parent clicks *Withdraw consent* and the rules stop immediately. Staff are prompted to retire the tablet. Retiring resets it, which fully removes management.
- **The family can always reset** its own tablet. Factory reset is not disabled on parent-owned tablets.
- **Parents see only their own child**, and cannot change the school's rules.
- **Consent is kept as evidence.** The wording, rules, signature name and time are stored and can't be deleted by the app. Granting and withdrawing appear in the Activity log.
- **No monitoring:** the school sees only whether the tablet is enrolled and whether rules are applied. It never sees messages, files, screens, location, browsing, or which apps are used.

## Limits to tell parents
- Rules switch at the start and end of school hours **when the tablet is online**. Offline, the change applies when it reconnects.
- Enrollment needs a **one-time reset**, and fully removing management needs another reset.
- Switching an app off relies on Android Enterprise's `disabled` app setting. Verify it on your tablets before rollout.

## For the privacy/legal review
- Consent wording: `src/policy/consent.ts` (versioned as `CONSENT_TEXT_VERSION`).
- Check the age of digital consent, and whether consent from both parents is needed, in your jurisdiction.
- Decide the retention period for consent records after a student leaves.
- Production needs invitation emails sent by SafeTab. In pilot mode the link is shown to staff to send.
