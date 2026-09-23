# Architecture and persistence

## Boundaries

- `lib/stride/types.ts`: a kind-discriminated entity union plus kind-specific creation and edit payloads for tasks, projects, courses, assignments, habits, alarms, streak days, check-ins, shower sessions, pages, blocks, databases, views, templates, and activity records.
- `lib/stride/validation.ts`: shared runtime validation for local edits, sync operations, and imports, including per-kind shapes and safe link/embed boundaries.
- `lib/stride/domain.ts`, `formula.ts`, `timer.ts`, `school.ts`, `streak.ts`, `alarms.ts`, and `shower.ts`: scheduling, dates, safe URLs, expressions, grades, deterministic streaks, alarm recurrence, and persistent timer transitions.
- `lib/stride/storage.ts`, `field-index.ts`: versioned local persistence, field indexes, operations, recovery, and incremental entity materialization.
- `lib/stride/store.tsx`: account lifecycle, UI subscriptions, sync retries, undo, and global timer completion.
- `components/stride/features`: task, School, habit, wellness, alarm, calendar, page, database, productivity, and settings modules. Editors are lazy loaded.
- `lib/server` and `app/api`: session verification, authorization, D1 operations, R2 attachments, and reminder scheduling.
- `workers/reminders`: independently deployed scheduled Worker, with signed dispatch requests.

## Local storage contract

The IndexedDB database `stride-workspace` is schema version 8. Portable snapshots and sync use protocol version 3; backup archives use version 4 while retaining readers for the prior formats. Schema 4 added tombstone-safe active-record indexes and ID-inclusive keyset indexes; schema 5 added an owner/kind/active/due index for bounded task startup reads; schema 6 added bounded trigram search indexes plus a safe overflow path for unusually long text; schema 7 added the attachment-deletion ledger; schema 8 adds the School, alarm, wellness, and streak entity families without rewriting canonical records. Upgrades create stores and rebuild derived active, routing, due, and search values without discarding operation history.

`meta` contains owner identity, logical clock, sync cursor, and a revision used to invalidate caches across tabs. `fields`, `records`, `operations`, and `conflicts` are indexed by owner. Records also have kind, container, and due-date indexes. Files, outgoing upload and deletion queues, and recovery snapshots have separate stores.

Every edit validates first, then commits changed fields, materialized records, activity, and outgoing operations in one read-write transaction. React is notified after completion. Aborted or quota-failed transactions leave both the entity and operation uncommitted. Drafts overlay a field index and commit only changed fields; a one-field edit does not rewrite the serialized workspace.

Database rows are checked against the current property schema whenever that schema is available. Select values must use declared options; numbers, dates, checkboxes, URLs, files, and relations retain their declared runtime types; relation targets are verified against the configured entity kind or database. Changing a schema also validates its existing rows in the same transaction, so an incompatible edit aborts without partially changing the database. Cells for removed properties remain stored for Undo and import recovery, and orphaned rows remain recoverable if their database has already been deleted or is absent from legacy data.

Saved database views persist layout, query, filter, sort, grouping, visibility, and column order as ordinary syncable records. Restoration validates the bounded configuration, ignores references to removed properties, and appends newly introduced properties after the saved order. This keeps an older view usable across additive or subtractive schema changes without rewriting its stored history.

Database rendering, filtering, sorting, grouping, and entry details share one computed-value evaluator. It resolves formula dependencies by property name or ID, follows rollups into the related database's schema, and can aggregate a related formula result. Evaluation tracks row-and-property pairs so direct or cross-property cycles terminate as visible `#ERROR` values. The expression engine does not use JavaScript evaluation or expose external I/O.

Custom page and row templates are normalized into complete creation payloads before persistence. Page activation generates fresh page/block identities, canonical order, and ownership for the entire block set, then validates every record before the atomic edit. Row activation discards stale deletion state, retargets the chosen database, and relies on the same schema-aware transaction validation as direct entry creation. Partial legacy templates receive safe defaults; malformed or unsafe embedded content aborts before any workspace mutation.

Version-one data migrates to unclaimed guest storage. Version-two snapshots migrate to indexed owner stores. Version-three record indexes are backfilled in place for keyset paging. Later additive upgrades create missing indexes, the schema-seven deletion ledger, and the schema-eight recovery marker. The old stores remain intact and a recovery snapshot is retained. Legacy attachment bytes remain available. A blocked migration asks the user to close older tabs rather than deleting data.

Task routes can render from an owner-isolated, bounded startup projection while the complete conflict and sync snapshot hydrates in the background. The projection loads up to 100 undated tasks, 300 tasks due through the next 90 days, route-scoped project tasks, navigation records, settings, and recent completions. Non-task features wait for the full snapshot, while workspace search independently reads active searchable records through owner/kind indexes and returns at most 50 substring matches with explicit loading, empty, and failure states. Partial task counts remain labelled while hydration is in progress. Storage also exposes tombstone-safe keyset pagination that seeks from a stable record ID without walking earlier rows. Removing the background full-owner hydration, moving feature stores onto paged queries, and adding a query-selective text index if reference-device measurements require it remain release work.

## Sync protocol

`POST /api/sync` requires a same-origin request and a verified Supabase session. Owner IDs supplied by clients must match that verified account. Current requests contain `{version:3, owner, cursor, changes}`. Version-two clients receive an explicit upgrade response before they can submit version-three entity kinds. Each change has a stable operation ID and fields with logical stamps, previous field stamps, and an observed entity revision. Acknowledgments remove operations only after durable cloud acceptance. A response includes at most 100 ordered changes and a continuation cursor.

D1 commits field updates, change history, deduplication IDs, and reminder scheduling intent together. Reusing an operation ID with different content is rejected. Replays retry pending scheduling work without duplicating the activity record. Local operation sequence is preserved across restarts.

Changes to different fields merge. Competing values on the same field retain both alternatives in the conflict inbox. Delete/edit races retain edited content behind the tombstone and offer an explicit restore choice. Legacy operations without entity revision context have weaker deletion-conflict detection. Cross-device graph conflicts and richer entity revision semantics still need additional release validation.

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

Exports capture records and local attachment bytes from one read transaction. Missing cloud attachments are downloaded before export succeeds, including files referenced only by retained history, conflicts, deleted records, or page/database templates. Staging rejects missing historical bytes and contradictory entity types. The primary `.stride` backup is a version-three, stream-friendly container: its bounded JSON header is checksummed and each raw attachment is independently size- and SHA-256-verified without base64 expansion. Small workspaces can also produce the legacy JSON backup and `STRIDE2.<sha256>.<base64url-gzip-json>` compact code. Checksums detect corruption, not malicious authorship. Backups are not encrypted.

Restore validates the complete file in staging, previews its contents, preserves a pre-restore snapshot and original bytes, then commits atomically. Imported records become fresh local operations so restored state can sync. API keys, authentication cookies, and device push subscriptions are outside the export format. Each attachment remains limited to 10 MB and archive metadata to 150 MB; total archive size is bounded by browser/device storage rather than an application-wide attachment cap. JSON and compact-code compatibility exports retain their 100 MB attachment and 150 MB decoded limits.

## Reminders

The scheduler authenticates with HMAC-SHA256 over timestamp, nonce, and body. Dispatch rejects stale or repeated nonces. Due jobs are transactionally claimed with leases, bounded retry, quiet hours, stale-job expiry, completion cancellation, and at most 12 repeated attempts. Successful delivery is recorded per subscription and round to avoid resending to a successful device when another device fails.

Delivery to an OS is not exactly-once: a crash between push acceptance and recording its receipt can still duplicate a notification, and the OS can delay or suppress it. Notification tags reduce duplicate visible entries. Scheduling intent survives an interrupted sync request. Production keys and the one-minute deployment are configured, and signed production dispatch has been verified. Real provider delivery, OS notification presentation and multi-device subscription behavior remain guided acceptance.

## Apple Watch companion

The independent watchOS companion in `apple/StrideWatch` pairs through an eight-character, ten-minute, one-use code created by an authenticated browser. Pair codes and one-year device tokens are stored in D1 only as SHA-256 hashes; the raw device token is returned once and retained in the watch Keychain. Revocation removes every watch credential for the signed-in owner.

`/api/watch` exposes a bounded, owner-scoped snapshot of upcoming tasks, today's habits and the active focus timer. The watch retains that snapshot and a bounded 100-action queue in app-local storage, updates its visible state optimistically offline, and replays in order on reconnect. Stable quick-add identities, completion-only semantics, absolute habit values and original timer timestamps make retries safe. Watch mutations use the same validated field/change protocol as browser edits, including task dependency and recurrence behavior, deterministic habit logs, reminder rescheduling, and browser sync history. Native timer completion also schedules a local watch notification when permission is granted.

The current private Sites access gate intentionally blocks unauthenticated native traffic before it reaches the app. Pairing therefore becomes operational only on a production origin reachable by the intended audience. Xcode compilation, signing, distribution, background behavior and physical-device testing remain acceptance requirements.
