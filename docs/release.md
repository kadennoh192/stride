# Release acceptance

## 0.4.0 (2026-10-05)

This release replaces Pages with continuous rich-text Notes; removes Explore, user Databases, templates and saved filters; moves Activity into Settings; adds configurable task layouts and shared item actions; and introduces an explicitly authorized permanent workspace reset. It preserves branding, themes, accents, density, sign-in identity, and the retained task, reminder, habit, School, alarm, timer, and planning behavior. The unrelated reminder scheduler changes present at the start of this work are preserved.

The fixed reset generation is `stride-notes-2026-10-05`. Local schema 9, snapshot/sync protocol 4 and backup format 5 form a permanent boundary. Pre-reset backups are rejected. Do not restore an old app build against the new workspace or create a recovery backup of the purged data. Existing downloaded backups and disconnected devices cannot be erased remotely.

## Automated evidence

The full suite covers schema 1–8 upgrades, deletion of all legacy stores and recovery copies, fresh startup, one-time markers, subsequent new data, owner isolation, stale protocols and transfers, interrupted D1/R2 cleanup, lease contention, repeated initialization, Watch authorization, resumable uploads, checksums, attachment deletion races, and complete backup/restore.

Notes coverage includes document formatting, tables, checklists, durable attachment IDs, folder ancestry cycles, folder deletion and Undo, pin/edit ordering, title fallback, body search, timestamps, quota failure retry, rapid staging and flush, competing tab drafts, remote edits, deleted-note recovery, pending attachment storage, offline file availability and download errors. Layout tests cover defaults, overrides and returning to default. Existing recurrence, dependencies, timezone/DST, reminders, alarms, habit/streak, School, planning and update tests remain intact.

Typecheck, lint, all 83 tests, the production build and Drizzle migration consistency check pass. Explicit stale file/upload/push/alarm requests return 426, and repeated initialization preserves new D1 fields and R2 files. Code and isolated tests alone are not proof of production deletion.

## Browser acceptance

Local browser checks cover the empty setup and task-layout choice, desktop and mobile Notes panes, saved title/body edits, formatting, tables/checklists, long text, images/files, menus, light/dark themes, settings and task layouts. Keyboard activation and right-click target the correct note/task; folder movement and Board/Table/Timeline default/override changes work without reload. Screenshots use local fixtures. Physical mobile devices and assistive technologies remain outside this browser acceptance.

## Intended deployment and reset

The intended environment is the existing owner-private Stride Site at `https://stride-workspace.mooeykadancow.chatgpt.site`. Keep its audience and infrastructure configuration. A successful deployment does not itself initialize or verify the owner's reset. The already signed-in owner must reach the updated application; its authenticated initializer verifies empty owner D1 records and R2 prefixes before recording completion.

Production reset verification is pending. Do not interpret test fixture cleanup as deletion of this workspace.

## Remaining device acceptance

Physical iPhone installed-PWA behavior, OS push delivery, native Watch compilation/signing and re-pairing, Safari/Firefox, screen readers, actual browser zoom, low-storage devices and long offline queues require their target environments. The existing private preview does not establish guaranteed alarm delivery or full production readiness. New pairing clears the native Watch cache and pending actions; unavailable devices clear browser-local workspace data on their first updated launch.
