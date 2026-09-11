# Deployment

Keep this preview owner-private while completing acceptance. Independent accounts require a hosting origin that can be reached without a preceding ChatGPT login; the current private Sites access gate is a separate authentication boundary and must be verified before public release.

## Server configuration

Set runtime values through Sites environment configuration, never in `.openai/hosting.json` or the repository:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project HTTPS origin |
| `SUPABASE_ANON_KEY` | Supabase client/anonymous key for Auth REST calls; never a service-role key |
| `VAPID_PUBLIC_KEY` | Web Push public application-server key |
| `VAPID_PRIVATE_KEY` | Secret matching private key |
| `VAPID_SUBJECT` | VAPID contact URI |
| `REMINDER_DISPATCH_SECRET` | High-entropy secret shared only with the scheduled Worker |

D1 binding `DB` and R2 binding `FILES` are declared in the existing Sites hosting manifest. Apply the additive migrations in `drizzle/` in order. The original migrations are preserved. Do not clear cloud tables during rollout.

For local configuration, copy `.dev.vars.example` to `.dev.vars`, fill values locally, and keep it untracked. Guest operation needs no account or push credentials.

## Supabase email flows

Configure the production Site URL, allowlisted callback origin, verification, and production email delivery in Supabase. This implementation accepts `token_hash` and `type` query parameters at the app root and verifies them through `/api/auth`; it does not consume an implicit-flow access-token fragment.

Confirmation template link:

```html
<a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=email">Confirm email</a>
```

Recovery template link:

```html
<a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery">Reset password</a>
```

Use the intended environment's Site URL. Test verification and recovery from the delivered emails before release, including expired links and email security scanners. Follow Supabase's [email template guidance](https://supabase.com/docs/guides/auth/auth-email-templates) and [redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

The server keeps access and refresh tokens in HttpOnly cookies. Browser storage contains account-scoped workspace data but no Supabase tokens. A user's Gemini key is separate, device-local, and excluded from sync, backup, and logs.

## Background reminders

Deploy `workers/reminders/wrangler.jsonc` separately to Cloudflare Workers. Set `STRIDE_ORIGIN` to the HTTPS application origin and the same `REMINDER_DISPATCH_SECRET` as the app. For an owner-private Sites deployment only, the scheduler also needs its permitted `SITES_ACCESS_TOKEN`; store it as a secret. Do not expose that token to the client.

The scheduled trigger runs once per minute and calls `/api/reminders` with a signed request. Verify the callback can reach the application through its access gate. Configure alerts for dispatch failures and job backlog, using counts and IDs without task titles, descriptions, email contents, API keys, or push payloads.

Enable notifications from Settings on each device. On iPhone, Web Push requires a supported Home Screen web app; see [Apple's Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers). Do not promise closed-app offline alarms or guaranteed OS delivery.

## Rollout gate

Before widening access: verify a cloud backup, run all automated checks, apply only additive migrations, validate the private publication, and complete the real-device checklist in `release.md`. Record the exact validated source/build. Preserve the prior working publication and cloud backup for rollback. A private publication is a development preview, not evidence of production readiness.
