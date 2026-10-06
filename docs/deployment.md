# Deployment

Keep this preview owner-private while completing acceptance. Independent accounts require a hosting origin that can be reached without a preceding ChatGPT login; the current private Sites access gate is a separate authentication boundary and must be verified before public release.

## Server configuration

Set runtime values through Sites environment configuration, never in `.openai/hosting.json` or the repository:

| Variable                   | Purpose                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| `SUPABASE_URL`             | Supabase project HTTPS origin                                               |
| `SUPABASE_ANON_KEY`        | Supabase client/anonymous key for Auth REST calls; never a service-role key |
| `STRIDE_OWNER_EMAIL`       | Lowercase email allowed to create and use the private Stride account        |
| `VAPID_PUBLIC_KEY`         | Web Push public application-server key                                      |
| `VAPID_PRIVATE_KEY`        | Secret matching private key                                                 |
| `VAPID_SUBJECT`            | VAPID contact URI                                                           |
| `REMINDER_DISPATCH_SECRET` | High-entropy secret shared only with the scheduled Worker                   |

D1 binding `DB` and R2 binding `FILES` are declared in the existing Sites hosting manifest. Apply the additive migrations in `drizzle/` in order. The original migrations are preserved. Migration 0003 is additive; the authorized one-time initializer performs owner-scoped deletion only after authenticated startup. Do not manually clear global tables.

For local configuration, copy `.dev.vars.example` to `.dev.vars`, fill values locally, and keep it untracked. Guest operation needs no account or push credentials.

## Supabase email flows

Configure the production Site URL, allowlisted callback origin, verification, and production email delivery in Supabase. Stride starts confirmation and recovery with PKCE: Supabase's default `{{ .ConfirmationURL }}` email link returns a short-lived one-time `code`, and `/api/auth` exchanges it using an HttpOnly, 15-minute verifier cookie. Supabase access and refresh tokens never appear in the browser URL or browser storage. The link must be opened in the browser that requested it.

Set `STRIDE_OWNER_EMAIL` before enabling account creation. The server rejects sign-up, sign-in, recovery, refreshed sessions, and authenticated workspace access for other email addresses. Create and verify the owner account, then keep the allowlist value configured for every deployment.

The default Supabase confirmation and recovery templates work without edits. If custom SMTP is configured later, these direct token-hash links remain supported as an optional alternative.

Confirmation template link:

```html
<a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=email"
  >Confirm email</a
>
```

Recovery template link:

```html
<a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery"
  >Reset password</a
>
```

Use the intended environment's Site URL. Test verification and recovery from the delivered emails before release, including expired links and email security scanners. Follow Supabase's [email template guidance](https://supabase.com/docs/guides/auth/auth-email-templates) and [redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

The server keeps access and refresh tokens in HttpOnly cookies. Browser storage contains account-scoped workspace data but no Supabase tokens. A user's Gemini key is separate, device-local, and excluded from sync, backup, and logs.

## Background reminders

Deploy `workers/reminders/wrangler.jsonc` separately to Cloudflare Workers. It is a cron-only Worker: `workers_dev` and preview URLs stay disabled, so it has no public Worker URL. A brand-new Cloudflare Workers account may still require the one-time Workers onboarding page before it accepts a Cron Trigger. Set `STRIDE_ORIGIN` to the HTTPS application origin and the same `REMINDER_DISPATCH_SECRET` as the app. For an owner-private Sites deployment only, the scheduler also needs its permitted `SITES_ACCESS_TOKEN`; store it as a secret. That token lets only the scheduler pass the Sites owner-only gate; never expose it to the client, logs, source control, or a public Worker route.

The scheduled trigger runs once per minute and calls `/api/reminders` with a signed request. Verify the callback can reach the application through its access gate. Configure alerts for dispatch failures and job backlog, using counts and IDs without task titles, descriptions, email contents, API keys, or push payloads.

Enable notifications from Settings on each device. Task reminders, assignment reminders, check-in and shower nudges, and alarms share this scheduler. Alarms can bypass quiet hours when their own setting allows it, and notification actions call the authenticated `/api/alarms` endpoint for idempotent snooze or dismiss. Keep the visible in-app alarm overlay as the fallback when audio, vibration, push, or notification actions are unavailable. On iPhone, Web Push requires a supported Home Screen web app; see [Apple's Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers). Do not promise closed-app offline alarms or guaranteed OS delivery.

## Release metadata and client updates

Add a dated, user-facing entry to `releases.json` and bump `package.json` before building. `npm run release:validate` rejects missing or malformed metadata. `npm run build` generates the source build identifier, the client asset build, `/version.json`, and its no-cache header. Do not create or retain a pre-reset workspace backup as part of this rollout. The one-time purge is intentionally irreversible. A pre-reset application build must not be restored against protocol-four workspace data; do not force a waiting worker past an unsaved local or cross-tab draft.

## Apple Watch

The independent watchOS app reads `STRIDE_API_ORIGIN` from its Info.plist. Set it to the final HTTPS application origin before signing. A private Sites access gate rejects the watch's bearer-token requests before they reach `/api/watch`, so native pairing must remain a development-only control until that origin is reachable by the intended account audience. Do not embed a Sites bypass token, Supabase credential, or watch bearer token in the app bundle.

Generate the Xcode project from `apple/StrideWatch/project.yml`, select the release signing team and bundle identifier, and validate on both a watchOS 10+ simulator and physical Watch. Pairing requires a configured Stride account. Revoke test tokens in Settings after acceptance.

The browser-based Watch Link at `/watch` is a separate online-only convenience surface. Create it from **Settings → Apple Watch**, send it only to the owner, and revoke it immediately if the message or link is exposed. Its credential is placed in the URL fragment so it is not included in the HTTP request URL, then retained locally where the Watch web view permits. It never accepts offline writes and does not claim background refresh or notification delivery.

## Rollout gate

Before widening access: run all automated checks, apply the additive migrations, validate the owner-private publication, and complete the real-device checklist in `release.md`. Record the exact validated source/build. The reset does not have a data rollback. A private publication is a development preview, not evidence of production readiness.

## Release 0.4.0 reset and verification

Deploy the exact validated build and all four historical SQL migrations to the existing Stride Site. Keep its owner-private audience, account configuration, and reminder infrastructure secrets. Open the updated app as the already signed-in owner. Local schema 9 purges old stores before rendering; the signed-in app calls `POST /api/workspace/reset` with same-origin authentication and the fixed generation header. An interrupted request leaves progress and can be retried by reopening or syncing. No setup/settings marker substitutes for verified cloud completion.

Verify the owner's `workspace_resets` phase is `complete` with the fixed generation and completion timestamp. Before creating new data, inspect owner counts for fields, changes, dedup, reminder jobs/deliveries/queue, push subscriptions and Watch credentials, and verify both R2 prefixes are empty through initializer verification. Repeat startup and initialization after creating new data to confirm it survives. Verify auth still resolves the same account. Never use a different test account or environment as evidence that the intended workspace was purged.

Other devices clear local data on their first updated launch. Require native Watch re-pairing. Downloaded backup files and unavailable devices remain outside remote erasure. If the browser has no owner session, cloud reset must wait for owner sign-in; deployment alone is not reset verification.
