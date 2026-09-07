# Architecture and persistence

## Boundaries

- `lib/stride/types.ts`: a kind-discriminated entity union plus kind-specific creation and edit payloads for tasks, projects, pages, blocks, databases, habits, views, templates, and activity records.
- `lib/stride/validation.ts`: shared runtime validation for local edits, sync operations, and imports, including per-kind shapes and safe link/embed boundaries.
- `lib/stride/domain.ts`, `formula.ts`, `timer.ts`: scheduling, dates, safe URLs, expressions, and persistent timer transitions.
- `lib/stride/storage.ts`, `field-index.ts`: versioned local persistence, field indexes, operations, recovery, and incremental entity materialization.
- `lib/stride/store.tsx`: account lifecycle, UI subscriptions, sync retries, undo, and global timer completion.
- `components/stride/features`: task, calendar, page, database, productivity, and settings modules. Editors are lazy loaded.
- `lib/server` and `app/api`: session verification, authorization, D1 operations, R2 attachments, and reminder scheduling.
- `workers/reminders`: independently deployed scheduled Worker, with signed dispatch requests.

## Local storage contract

The IndexedDB database `stride-workspace` is schema version 3. Portable snapshots and the sync/export protocol remain version 2; those versions are independent.

`meta` contains owner identity, logical clock, sync cursor, and a revision used to invalidate caches across tabs. `fields`, `records`, `operations`, and `conflicts` are indexed by owner. Records also have kind, container, and due-date indexes. Files, the outgoing attachment queue, and recovery snapshots have separate stores.

Every edit validates first, then commits changed fields, materialized records, activity, and outgoing operations in one read-write transaction. React is notified after completion. Aborted or quota-failed transactions leave both the entity and operation uncommitted. Drafts overlay a field index and commit only changed fields; a one-field edit does not rewrite the serialized workspace.

Version-one data migrates to unclaimed guest storage. Version-two snapshots migrate to indexed owner stores. The old stores remain intact and a recovery snapshot is retained. Legacy attachment bytes remain available. A blocked migration asks the user to close older tabs rather than deleting data.

The current UI still loads a complete owner snapshot, including database rows and history. Indexed pagination exists in storage, but full lazy workspace loading and large-dataset UI performance remain release work.

## Sync protocol

`POST /api/sync` requires a same-origin request and a verified Supabase session. Owner IDs supplied by clients must match that verified account. Requests contain `{version:2, owner, cursor, changes}`. Each change has a stable operation ID and fields with logical stamps, previous field stamps, and an observed entity revision. Acknowledgments remove operations only after durable cloud acceptance. A response includes at most 100 ordered changes and a continuation cursor.

D1 commits field updates, change history, deduplication IDs, and reminder scheduling intent together. Reusing an operation ID with different content is rejected. Replays retry pending scheduling work without duplicating the activity record. Local operation sequence is preserved across restarts.

Changes to different fields merge. Competing values on the same field retain both alternatives in the conflict inbox. Delete/edit races retain edited content behind the tombstone and offer an explicit restore choice. Legacy operations without entity revision context have weaker deletion-conflict detection. Cross-device graph conflicts and richer entity revision semantics still need additional release validation.

Retry triggers include connectivity, foregrounding, queued edits, and a bounded backoff. An authentication outage returns 503 rather than switching the workspace to guest. Account APIs never enter the service worker cache.

## Attachments and backups

Attachments use account-scoped R2 paths and SHA-256 verification. Files are saved locally before being uploaded. Transfers stage 1 MB chunks in account-scoped R2 paths, persist confirmed progress locally, and reconcile remote chunk hashes before resuming. The server checks each chunk and the complete file before finalization, recognizes completion retries, and removes corrupted chunks so they can be repaired. Expired temporary chunks are cleaned in bounded, owner-scoped scans; durable objects are outside that prefix. Downloads expose unavailable/offline states. File size is limited to 10 MB. Upload acknowledgments and in-flight downloads cannot replace files written by a newer local restore. Explicit owner headers reject transfers after an account switch.

Exports capture records and local attachment bytes from one read transaction. Missing cloud attachments are downloaded before export succeeds, including files referenced only by retained history, conflicts, deleted records, or page/database templates. Staging rejects missing historical bytes and contradictory entity types. The primary `.stride` backup is a version-three, stream-friendly container: its bounded JSON header is checksummed and each raw attachment is independently size- and SHA-256-verified without base64 expansion. Small workspaces can also produce the legacy JSON backup and `STRIDE2.<sha256>.<base64url-gzip-json>` compact code. Checksums detect corruption, not malicious authorship. Backups are not encrypted.

Restore validates the complete file in staging, previews its contents, preserves a pre-restore snapshot and original bytes, then commits atomically. Imported records become fresh local operations so restored state can sync. API keys, authentication cookies, and device push subscriptions are outside the export format. Each attachment remains limited to 10 MB and archive metadata to 150 MB; total archive size is bounded by browser/device storage rather than an application-wide attachment cap. JSON and compact-code compatibility exports retain their 100 MB attachment and 150 MB decoded limits.

## Reminders

The scheduler authenticates with HMAC-SHA256 over timestamp, nonce, and body. Dispatch rejects stale or repeated nonces. Due jobs are transactionally claimed with leases, bounded retry, quiet hours, stale-job expiry, completion cancellation, and at most 12 repeated attempts. Successful delivery is recorded per subscription and round to avoid resending to a successful device when another device fails.

Delivery to an OS is not exactly-once: a crash between push acceptance and recording its receipt can still duplicate a notification, and the OS can delay or suppress it. Notification tags reduce duplicate visible entries. Scheduling intent survives an interrupted sync request. Production keys, subscriptions, deployment, and real-device delivery have not been validated.
