# Notes reset implementation ledger

Release 0.4.0 replaces Pages with continuous Notes, removes Explore/Databases/saved filters, moves Activity to Settings, configures task layouts through setup and Settings, and shares context/ellipsis actions throughout retained item presentations.

The owner explicitly authorizes the permanent reset. Fixed generation: `stride-notes-2026-10-05`; local schema 9, sync/snapshot 4, backup 5. All old workspace stores and device preferences are cleared without recovery copies; authentication cookies and provider identity are preserved. Cloud cleanup has an authenticated same-origin owner boundary, persisted phases and leases, owner-scoped D1/R2 deletion, and final emptiness verification. Old clients/transfers/backups cannot repopulate the new generation. Native Watch pairing clears cached data and pending actions.

## Validation

- Typecheck and lint pass.
- Complete test suite: 84 tests pass, including the existing unrelated reminder-scheduler test.
- Production build passes.
- Drizzle migration consistency check passes.
- Added explicit stale file/upload/push/alarm rejection and repeated-reset preservation of new D1 records; isolated server integration passes.
- Browser: fresh setup, optional sample data, desktop/mobile Notes, light/dark themes, long titles and content, saved/reopened edits, checklists, editable tables, multiple images/files, upload retry, keyboard menu activation, folder movement, viewport-edge attachment menu, compact filters, and immediate layout default/override rendering. Board/table/timeline task menus target the clicked item. Screenshots record local UI fixtures, not production reset proof.

## Actual environment and reset evidence

Existing owner-private Site: `https://stride-workspace.kadennoh192.chatgpt.site`. The native publication changed the account subdomain; the previous `mooeykadancow` origin returns 404. Its origin-scoped browser data could not be accessed through the new origin.

The existing Supabase project was paused and was restored in place. Existing credentials then signed in successfully, preserving provider identity, password and infrastructure configuration. The authenticated initializer completed at `2026-10-06T12:05:40.942Z`. Production D1 shows the fixed generation's durable completion marker and zero rows in fields, changes, dedup, push subscriptions, reminder jobs, deliveries, schedule intent and Watch tokens. The completion implementation verifies empty owner D1 records and both R2 prefixes. Fresh setup appears after sign-in. Global dispatcher nonces are unrelated replay protection without workspace/owner data.

## Remaining device limits

Previously downloaded backups, disconnected devices and retired-origin local copies cannot be erased remotely. Physical installed-PWA/push/Watch and other browser/assistive-technology acceptance require their target environments. The current owner browser and deployed cloud reset have been verified; do not generalize this evidence to unavailable devices.

A built-Worker HTTP check exposed eager random generation in the note draft module during SSR. Lazy draft-session initialization fixes it; the regression test loads the module with random generation prohibited.

The original `workers/reminders/index.ts` authorization-header fix and `tests/reminder-scheduler.test.ts` have been preserved.
