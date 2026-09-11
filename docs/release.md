# Release acceptance

Status: **development preview; full objective remains active**. Implemented source and automated tests are not evidence of a complete cross-device product. Native Watch work remains deferred until the web release is complete.

## Current evidence

The automated suite covers version-one through version-three migrations; atomic writes and operation queues; owner isolation; restart ordering; concurrent saves; injected quota failure; field conflicts and deletion races; backup integrity, every entity kind, attachment-bearing blocks/rows/templates, and pre-restore recovery; task recurrence date arithmetic; timezone gaps/ambiguities; graph cycles; formula evaluation and short-circuiting; timer closure/restart; AI context boundaries and malformed responses; offline shell caching; and a local D1/R2 integration with mocked Auth responses.

The last directly observed full test run passed 31 tests. Run the checks again against the exact source selected for publication. Local development logs are in ignored `outputs/qa/`, not included in the deployment.

Production builds have succeeded during implementation. The build finalizer precaches local hashed bundles, including lazy feature modules. The first validated source was published privately at https://stride-workspace.mooeykadancow.chatgpt.site. Subsequent changes require their own successful build and publication results.

Browser control was unavailable in the most recent environment (no browser surfaces; in-app browser creation returned unavailable). Earlier browser work exercised task creation and search, but did not prove the final responsive layouts, editor workflows, or PWA behavior. Do not represent browser or real-device gates as passed.

A 60,000-record synthetic IndexedDB fixture (10,000 tasks and 50,000 database rows) completed in the Node `fake-indexeddb` diagnostic. Setup took 83.3 seconds, a 100-row deep keyset page took 54.5 ms, and one small edit took 4.06 seconds. These figures identify storage paths but do not model a browser's IndexedDB implementation or rendering, so no responsive-interaction claim follows from them. Reference-device p50/p95 measurements remain required.

## Requirement tracking

| Requirement | Current implementation/evidence | Remaining acceptance |
| --- | --- | --- |
| Modular, strongly typed domain | Feature modules, domain functions, a complete kind-discriminated entity/edit API, and per-kind runtime validators | Keep compile-time and import-validation coverage aligned as new record kinds are added |
| Versioned indexed storage | Schema 4, owner/record/field/operation indexes, tombstone-safe active indexes, keyset indexes, and v1-v3 migration/failure tests | Multi-tab browser migration/blocked-upgrade test; long offline datasets |
| Atomic edits and outgoing operations | One transaction; injected abort/quota tests | Real browser quota/eviction test |
| D1 durability and R2 integrity | Owner authorization and D1/R2 integration tests | Verify actual cloud records, reconnect, and cloud backup |
| Attachment queues | Resumable 1 MB chunks, persisted progress, remote hash reconciliation; local R2 interruption/restart, corrupt-part repair, empty-file and owner-switch checks | Browser/network interruption, long-offline resume and staging-cleanup acceptance |
| Supabase accounts | Signup, login, verify, recover, password, logout APIs and UI | Real project, email delivery, callback, account switching and access-gate verification |
| Account isolation and guest import | Owner-keyed stores; explicit staged backup import | Multi-device UI account-switch tests; logout notification lifecycle |
| Sync revisions, acknowledgments, cursors | Field/entity base stamps, operation IDs, D1 dedup, paginated changes | Concurrent multi-device stress, kind/graph races, and clock-skew tests |
| Merge and conflicts | Different-field merge, same-field alternatives, tombstones and deletion inbox | Rich editor/attachment conflict UI and mixed-version device testing |
| Recurrence and retry idempotence | Per-occurrence event IDs, month-end anchors, completion-relative schedule | Simultaneous completion on devices; missed occurrences and travel scenarios |
| PWA installation and update lifecycle | Manifest/icons, matched offline shell, API exclusion, safe waiting update | Actual install, multiple open versions, closure, reboot and offline reopen |
| Storage persistence and recovery notice | Capability-detected persistence request, quota display, explicit data-deletion explanation | Browser permission/denial and low-space testing |
| Desktop shell | Sidebar, commands, daily panel, adjustable task pane | Visual and keyboard verification at common desktop widths |
| Tablet shell | Collapsible drawer, task/main panes | Portrait/landscape touch and keyboard acceptance |
| iPhone shell | Bottom navigation, quick-add sheet, full-screen editors, safe areas | Real iPhone notch/keyboard/rotation and installation tests |
| Task organization | Projects, sections, labels, filters, priority, description | Section grouping and filter/view state UX audit; no dead actions |
| Subtasks/checklists/dependencies | Separate nested records and checklists; local cycle checks | Deep nesting UI, parent moves, distributed graph conflict handling |
| Archive/history/undo | Persisted history and completed/archive views, undo actions | Undo semantics across sync, recurrence, timers and restore |
| Date-only vs timed deadlines | Separate date/time/zone fields, IANA conversion | DST/timezone travel reschedule acceptance in all views |
| Reloadable routes/empty start | Hash navigation, optional starter data | Back/forward, deep-link reload, focus transitions |
| Structured page editor | Rich blocks, nesting, tables, toggles, quotes, code, links, files and allowlisted embeds | Editor round-trip, block lists/mentions, paste, drag and touch reorder validation |
| Page presentation and collaboration aids | Icons/covers, templates, backlinks, personal comments, search | Offline search coverage, linked references and comment persistence UI |
| Database schemas/properties | Listed primitive types, file/owner/relation/formula/rollup properties | Property validation, typed references and schema migration tests |
| Database layouts | Table, board, list, gallery, calendar and timeline | Group/filter/sort/hidden/order saved-view persistence; relations/rollups across views |
| Linked database views/templates | Shared row records and view configuration | Editing through linked views and template round-trip |
| Sandboxed formulas | Documented interpreter; no arbitrary JS; lazy conditions tested | Date/aggregate/type/cycle test expansion and UI errors |
| Task calendar and alternate views | Year/month/week/multi-week/multi-day/agenda/today/upcoming, list/board/table/timeline | Drilldown, range controls, saved preferences and consistent rescheduling audit |
| Hosted scheduler | Signed separate Worker, transactional claims, durable scheduling intent | Configure/deploy scheduler, retry/lease race tests and service monitoring |
| Reminder modes | Task/habit, daily, snooze, quiet hours, bounded repeats, completion cancellation | Real push providers, permission denial, multi-device partial failure, DST/travel/missed-job tests |
| Habit tracker | Numeric goals, schedule, historical logs, streak/history and stats | Schedule/goal-change semantics, timezone boundaries and reminders |
| Pomodoro | Configurable phases, timestamp persistence, global finalization, association and history | Pause/reconnect/conflict behavior on real devices |
| Matrix/countdowns | Editable matrix and persistent event dates | Drag/accessibility and legacy timezone migration |
| Analytics and XP | Recorded completion/session/habit events; day grouping | Exact event idempotence, timezone and large-history tests |
| Templates/quiz/inspiration | Usable template actions, explainable suggestions, saved favorites | End-to-end activation and persistence |
| Optional Gemini | Device key, model input, selected task/project context, editable preview | Live model/key failure testing and explicit ambiguous-date clarification workflow |
| Customization | Theme modes/presets/accent, density, typography, nav order/visibility, backgrounds | Full custom theme controls, placement coverage, persisted layout preferences and contrast validation |
| Complete backup/restore | Stream-friendly version-three archive with checksummed metadata and per-file hashes; compact code/JSON compatibility; staged validation and atomic recovery tests; automated round-trip of every entity kind and attachment-bearing blocks, rows and templates | Real-browser archive round-trip above 100 MB |
| Accessibility | Semantic controls, focus drawer, reduced motion, chart data alternatives | Screen readers, 200% zoom, contrast, keyboard-only and touch walkthroughs |
| Performance | Incremental field/operation writes, active-record and ID-keyset indexes, bounded pages, lazy editors; 10k-task/50k-row simulator diagnostic completed | Move UI/startup from full snapshots to paged reads; measure 10k tasks/50k rows and sub-100ms p50/p95 interactions on reference devices |
| Staged release/monitoring | Additive migrations, deployment instructions, private audience preserved | Cloud backup/rollback exercise, final preview, operational metrics and alert delivery |
| Apple Watch | Explicitly deferred, no simulated feature | After web acceptance: native companion, signing, sync bridge and physical Watch testing |

## Real-device acceptance checklist

- Desktop Chromium, Firefox and Safari: keyboard quick add, search, task details and resizing, archive/undo, pages, rich paste, block reorder, database schema/views/relations/formulas, imports, and theme changes.
- Tablet portrait and landscape: navigation collapse/focus, two-pane editing, touch reorder/reschedule, keyboard resize, and readable tables.
- iPhone installed PWA: first installation, safe-area layout, software keyboard, quick add, full-screen editors, permission denial, background push, app closure, reboot, offline edits, reconnect and update waiting.
- Two signed-in devices: disjoint edits, same-field rich edits, concurrent deletion, completed recurrence replay, long offline queues, independent attachments, account switch and recovery.
- Accessibility: logical focus order, VoiceOver/NVDA output, labelled fields, error announcements, 200% zoom, reduced motion, light/dark/custom-theme contrast.
- Large datasets: startup, task edit/complete, search, page editor load, sorted/filtered database pagination, backup export/import; record device/browser, dataset and p50/p95 interaction timings.

## Next implementation priorities

1. Validate large `.stride` archives and resumable attachment transfers on real devices, including interrupted and low-space cases.
2. Audit every editor and view against its functional requirements, including sections, saved layouts and cross-device conflicts.
3. Configure independent accounts and scheduler credentials, then verify cloud behavior and delivery.
4. Complete browser/real-device/accessibility/performance acceptance before widening access or calling the web release complete.
