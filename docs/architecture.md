# Architecture and persistence

## Boundaries

- `lib/stride/types.ts`: a kind-discriminated entity union plus kind-specific creation and edit payloads for tasks, projects, courses, assignments, habits, alarms, streak days, check-ins, shower sessions, notes, folders, and activity records.
- `lib/stride/validation.ts`: shared runtime validation for local edits, sync operations, and imports, including per-kind shapes and safe rich-document and link boundaries.
- `lib/stride/domain.ts`, `timer.ts`, `school.ts`, `streak.ts`, `alarms.ts`, and `shower.ts`: scheduling, dates, safe URLs, grades, deterministic streaks, alarm recurrence, and persistent timer transitions.
- `lib/stride/storage.ts`, `field-index.ts`: versioned local persistence, field indexes, operations, recovery, and incremental entity materialization.
- `lib/stride/store.tsx`: account lifecycle, UI subscriptions, sync retries, undo, and global timer completion.
- `components/stride/features`: task, School, habit, wellness, alarm, calendar, Notes, productivity, and settings modules. Editors are lazy loaded.
- `lib/server` and `app/api`: session verification, authorization, D1 operations, R2 attachments, and reminder scheduling.
- `workers/reminders`: independently deployed scheduled Worker, with signed dispatch requests.

## Local storage contract

The IndexedDB database `stride-workspace` is schema 9. Snapshots and sync use protocol 4 and require fixed generation `stride-notes-2026-10-05`. Backups use format 5. Schema 9 clears every legacy workspace store, attachment queue, byte cache, and recovery store during the upgrade transaction, before any old data renders. No old-data recovery snapshot is created. Independent `reset` markers keep this operation from repeating on later launches. Preferences are cleared once after the upgrade; authentication cookies and the account provider are retained. Version-change notifications close open database handles and reload stale tabs. Historical SQL migrations remain available; retired runtime migration readers are removed.

`meta` contains owner identity, logical clock, sync cursor, and a revision used to invalidate caches across tabs. `fields`, `records`, `operations`, and `conflicts` are indexed by owner. Records also have kind, container, and due-date indexes. Files, outgoing upload and deletion queues, and recovery snapshots have separate stores.

Every edit validates first, then commits changed fields, materialized records, activity, and outgoing operations in one read-write transaction. React is notified after completion. Aborted or quota-failed transactions leave both the entity and operation uncommitted. Drafts overlay a field index and commit only changed fields; a one-field edit does not rewrite the serialized workspace.

Notes store one typed rich document, searchable plain text, title, folder, pin, and creation/edit timestamps. Attachment nodes contain durable IDs, names, and image flags. The editor uses Tiptap headings, marks, lists, nested checklists, and tables. Folder parent edges are validated for cycles; folder deletion moves notes to All Notes and reparents children in one reversible edit.

Drafts are staged synchronously in memory and durably in separate per-tab `noteDrafts` slots. Autosave runs after about 500 ms. Navigation and update activation wait for drafts and pending attachment storage. A failed write retains the draft and retry persists it again. Saves compare the observed title/document against the current transaction, retaining conflicts instead of silently replacing remote edits. Recovery slots with different content survive saves in other tabs.

Task layout is a typed default with optional `taskViews` route/project overrides. Screens read settings directly, so changes render immediately. Right-click and ellipsis menus share action definitions; editable text keeps its native context menu. Activity is a Settings category.

Task routes can render from an owner-isolated, bounded startup projection while the complete conflict and sync snapshot hydrates in the background. The projection loads up to 100 undated tasks, 300 tasks due through the next 90 days, route-scoped project tasks, navigation records, settings, and recent completions. Non-task features wait for the full snapshot, while workspace search independently reads active searchable records through owner/kind indexes and returns at most 50 substring matches with explicit loading, empty, and failure states. Partial task counts remain labelled while hydration is in progress. Storage also exposes tombstone-safe keyset pagination that seeks from a stable record ID without walking earlier rows. Removing the background full-owner hydration, moving feature stores onto paged queries, and adding a query-selective text index if reference-device measurements require it remain release work.

## Sync protocol

`POST /api/sync` requires a same-origin request and a verified Supabase session. Owner IDs supplied by clients must match that verified account. Current requests contain `{version:4, generation, owner, cursor, changes}` and the fixed generation header. Older clients receive HTTP 426 before accessing sync or files. A signed-in workspace waits for the authenticated same-origin reset initializer to complete; workspace APIs return HTTP 423 during cleanup. Each change has a stable operation ID and fields with logical stamps, previous field stamps, and an observed entity revision. Acknowledgments remove operations only after durable cloud acceptance. A response includes at most 100 ordered changes and a continuation cursor.

D1 commits field updates, change history, deduplication IDs, and reminder scheduling intent together. Reusing an operation ID with different content is rejected. Replays retry pending scheduling work without duplicating the activity record. Local operation sequence is preserved across restarts.

Changes to different fields merge. Competing values on the same field retain both alternatives in the conflict inbox. Delete/edit races retain edited content behind the tombstone and offer an explicit restore choice. Cross-device graph conflicts and richer entity revision semantics still need additional release validation.

Task completion events use a SHA-256-derived ID from task identity and occurrence. Devices completing the same occurrence therefore converge to one bounded analytics record. Differing non-empty completion timestamps use last-writer-wins rather than creating a non-actionable same-event conflict; a completion deletion racing retained content still enters the deletion-conflict path.

Fixed daily, weekly, weekday, monthly, and yearly recurrences skip missed slots and choose the first date strictly after the completion day in the task's timezone. Monthly/yearly schedules retain their original day anchor across short months. `after-days` remains completion-relative rather than calendar-anchored.

Retry triggers include connectivity, foregrounding, queued edits, and a bounded backoff. An authentication outage returns 503 rather than switching the workspace to guest. Account APIs never enter the service worker cache.

## School, streaks, wellness, and Insights

Courses own grading mode, optional weighted categories, editable grade thresholds, target grade, term, instructor, and color. Assignments reference a valid course, support date/time/zone, workflow state, priority, type, notes, reminders, alarms, scores, expected scores, and attachment references. Grade calculations exclude missing scores and only include ungraded work in projections when an expected score is present. Assignments participate in global search and calendar indexes; history, Trash, sync, and backup use the ordinary entity pipeline.

The overall habit streak is derived from scheduled habits and deterministic daily logs in the workspace timezone. Non-scheduled days are neutral. Each seven successful days awards one freeze up to the two-freeze cap; the next eligible missed day consumes a freeze automatically. Materialized `streakDay` records make backfill and cross-device convergence inspectable while the calculation remains reproducible from habit history.

Optional check-ins and shower sessions are ordinary validated entities. The running shower timer is kept in settings with its original start timestamp, so reloads and offline use do not reset elapsed time and it can coexist with the focus timer. Insights reads task and assignment completions, focus sessions, habit/streak outcomes, grade data, showers, and check-ins. Paired mood/focus summaries only appear with enough matching data and remain descriptive.

## Updates

`releases.json` is the changelog source. The release preparation script requires the package version to have valid dated metadata and generates an immutable source build identifier. Production builds emit `/version.json` with `Cache-Control: no-store`. The client checks on startup, on a six-hour foreground interval, and on demand. A waiting service worker activates only after the local tab and other Stride tabs report no unsaved draft. The previous cache remains available until activation, and a failed or offline check leaves the running build untouched.

## Attachments and backups

Attachments use account-scoped R2 paths and SHA-256 verification. Files are saved locally before being uploaded. Transfers stage 1 MB chunks in account-scoped R2 paths, persist confirmed progress locally, and reconcile remote chunk hashes before resuming. The server checks each chunk and the complete file before finalization, recognizes completion retries, and removes corrupted chunks so they can be repaired. Expired temporary chunks are cleaned in bounded, owner-scoped scans; durable objects are outside that prefix. Downloads expose unavailable/offline states. File size is limited to 10 MB. Upload acknowledgments and in-flight downloads cannot replace files written by a newer local restore. Explicit owner headers reject transfers after an account switch.

Ordinary record deletion remains recoverable in Trash and therefore retains referenced attachment bytes. “Remove file permanently” is a separate confirmed action. It atomically removes the reference, writes a synced per-file tombstone, and queues deletion while retaining local bytes. Only after D1 acknowledges the tombstone may the authenticated endpoint delete that owner's durable object and temporary chunks; local bytes are removed only after R2 confirms success. The server rechecks the tombstone after R2 cleanup, so a concurrent restore cancels the local deletion, retains the bytes and requeues upload. Offline and failed deletions retry, while an account switch leaves the prior owner's queue untouched until that owner returns. Backups exclude explicitly purged bytes even while cleanup is pending, while restoring an older backup clears the matching local deletion marker and requeues its bytes for upload.

Exports capture records and local attachment bytes from one read transaction. Missing cloud attachments are downloaded before export succeeds, including files referenced only by retained history, conflicts, deleted notes, or recoverable document versions. Staging rejects missing historical bytes and contradictory entity types. The primary `.stride` backup is a version-five, stream-friendly container: its bounded JSON header is checksummed and each raw attachment is independently size- and SHA-256-verified without base64 expansion. Small workspaces can also produce a format-five JSON backup and `STRIDE5.<sha256>.<base64url-gzip-json>` compact code. Checksums detect corruption, not malicious authorship. Backups are not encrypted.

Restore validates the complete file in staging, previews its contents, preserves a pre-restore snapshot and original bytes, then commits atomically. Imported records become fresh local operations so restored state can sync. API keys, authentication cookies, and device push subscriptions are outside the export format. Each attachment remains limited to 10 MB and archive metadata to 150 MB; total archive size is bounded by browser/device storage rather than an application-wide attachment cap. JSON and compact-code compatibility exports retain their 100 MB attachment and 150 MB decoded limits.

## Reminders

The scheduler authenticates with HMAC-SHA256 over timestamp, nonce, and body. Dispatch rejects stale or repeated nonces. Due jobs are transactionally claimed with leases, bounded retry, quiet hours, stale-job expiry, completion cancellation, and at most 12 repeated attempts. Successful delivery is recorded per subscription and round to avoid resending to a successful device when another device fails.

Delivery to an OS is not exactly-once: a crash between push acceptance and recording its receipt can still duplicate a notification, and the OS can delay or suppress it. Notification tags reduce duplicate visible entries. Scheduling intent survives an interrupted sync request. Production keys and the one-minute deployment are configured, and signed production dispatch has been verified. Real provider delivery, OS notification presentation and multi-device subscription behavior remain guided acceptance.

## Apple Watch companion

The independent watchOS companion in `apple/StrideWatch` pairs through an eight-character, ten-minute, one-use code created by an authenticated browser. Pair codes and one-year device tokens are stored in D1 only as SHA-256 hashes; the raw device token is returned once and retained in the watch Keychain. Revocation removes every watch credential for the signed-in owner.

`/api/watch` exposes a bounded, owner-scoped snapshot of upcoming tasks, today's habits and the active focus timer. The watch retains that snapshot and a bounded 100-action queue in app-local storage, updates its visible state optimistically offline, and replays in order on reconnect. Stable quick-add identities, completion-only semantics, absolute habit values and original timer timestamps make retries safe. Watch mutations use the same validated field/change protocol as browser edits, including task dependency and recurrence behavior, deterministic habit logs, reminder rescheduling, and browser sync history. Native timer completion also schedules a local watch notification when permission is granted.

The current private Sites access gate intentionally blocks unauthenticated native traffic before it reaches the app. Pairing therefore becomes operational only on a production origin reachable by the intended audience. Xcode compilation, signing, distribution, background behavior and physical-device testing remain acceptance requirements.

## Permanent reset boundary

Additive migration 0003 creates `workspace_resets`, independent of workspace settings. The initializer acquires an owner lease, deletes owner fields/history/deduplication, reminder jobs and deliveries, scheduling intent, push subscriptions and Watch credentials, then scans owner durable and temporary R2 prefixes in bounded batches. It persists phases and retries from remaining objects. It verifies empty D1 counts and R2 prefixes before completion. Later initialization returns the same completion marker and preserves newly created data. Background scheduling and dispatch require completion; job insertion and delivery receipts have database guards against in-flight cleanup races. Infrastructure secrets and dispatch nonces are unrelated to owner workspace records and remain intact.

Watch credentials are revoked server-side. Beginning native re-pairing clears cached snapshots, queued actions, Keychain credential, and local notifications. Disconnected devices erase their local workspace only when running the updated app. Existing downloaded backups cannot be erased remotely. Pre-reset imports are rejected.
