# Release acceptance

## 0.4.0 (2026-10-05)

This release replaces Pages with continuous rich-text Notes; removes Explore, user Databases, templates and saved filters; moves Activity into Settings; adds configurable task layouts and shared item actions; and introduces an explicitly authorized permanent workspace reset. It preserves branding, themes, accents, density, sign-in identity, and the retained task, reminder, habit, School, alarm, timer, and planning behavior. The unrelated reminder scheduler changes present at the start of this work are preserved.

The fixed reset generation is `stride-notes-2026-10-05`. Local schema 9, snapshot/sync protocol 4 and backup format 5 form a permanent boundary. Pre-reset backups are rejected. Do not restore an old app build against the new workspace or create a recovery backup of the purged data. Existing downloaded backups and disconnected devices cannot be erased remotely.

## Automated evidence

The full suite covers schema 1–8 upgrades, deletion of all legacy stores and recovery copies, fresh startup, one-time markers, subsequent new data, owner isolation, stale protocols and transfers, interrupted D1/R2 cleanup, lease contention, repeated initialization, Watch authorization, resumable uploads, checksums, attachment deletion races, and complete backup/restore.

Notes coverage includes document formatting, tables, checklists, durable attachment IDs, folder ancestry cycles, folder deletion and Undo, pin/edit ordering, title fallback, body search, timestamps, quota failure retry, rapid staging and flush, competing tab drafts, remote edits, deleted-note recovery, pending attachment storage, offline file availability and download errors. Layout tests cover defaults, overrides and returning to default. Existing recurrence, dependencies, timezone/DST, reminders, alarms, habit/streak, School, planning and update tests remain intact.

Typecheck, lint, all 84 tests, the production build and Drizzle migration consistency check pass. Explicit stale file/upload/push/alarm requests return 426, and repeated initialization preserves new D1 fields and R2 files. Code and isolated tests alone are not proof of production deletion.

## Browser acceptance

Local browser checks cover the empty setup and task-layout choice, desktop and mobile Notes panes, saved title/body edits, formatting, tables/checklists, long text, images/files, menus, light/dark themes, settings and task layouts. Keyboard activation and right-click target the correct note/task; folder movement and Board/Table/Timeline default/override changes work without reload. Screenshots use local fixtures. Physical mobile devices and assistive technologies remain outside this browser acceptance.

## Production deployment and reset

The existing owner-private Site now publishes at `https://stride-workspace.kadennoh192.chatgpt.site`. Its audience and infrastructure configuration are preserved. The previous `mooeykadancow` origin returns 404; browser storage and cookies are origin-scoped, so local copies on that retired origin could not be inspected or erased from the current origin.

The existing Supabase account project was paused. It was restored without changing accounts, passwords, authentication configuration or secrets. The owner's existing credentials successfully signed in. At 2026-10-06T12:05:40.942Z, the authenticated initializer recorded generation `stride-notes-2026-10-05` as complete. Live D1 reads then verified zero fields, changes, dedup rows, push subscriptions, reminder jobs/deliveries/scheduling intent and Watch tokens. The completion path verifies zero owner rows and empty owner durable and staged-upload R2 prefixes before writing the marker. Global dispatcher replay nonces have no owner/workspace payload and remain infrastructure protection.

Fresh setup appeared after sign-in. The local schema upgrade and isolated tests prove clearing of legacy browser stores on an updated launch; inaccessible retired-origin storage, downloaded backups and disconnected devices remain outside actual deletion verification.

A production-response check found a Worker module-load failure from an eager random draft-session ID. Draft identities are now lazy, and an isolated import test rejects any random generation during server module loading. The final release is checked with the built Worker for a successful HTML response before publication.

## Remaining device acceptance

Physical iPhone installed-PWA behavior, OS push delivery, native Watch compilation/signing and re-pairing, Safari/Firefox, screen readers, actual browser zoom, low-storage devices and long offline queues require their target environments. The existing private preview does not establish guaranteed alarm delivery or full production readiness. New pairing clears the native Watch cache and pending actions; unavailable devices clear browser-local workspace data on their first updated launch.
