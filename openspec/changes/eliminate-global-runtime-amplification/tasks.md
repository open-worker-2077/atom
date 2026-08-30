## 1. Scope and failing evidence

- [x] 1.1 Add focused tests that expose affected-path closure and fail when a local detail change expands into unrelated paths.
- [x] 1.2 Add focused tests that prove unrelated Programs, support edges, locks, and shortcuts are not selected for a local event.
- [x] 1.3 Add focused tests for move/rename descendants, cross-domain support endpoints, ancestor/subtree locks, shortcut targets, and missing-index local backfill.
- [x] 1.4 Add failure-injection tests for Patch/inverse Patch atomicity, restart recovery, and legacy snapshot-history readability.
- [x] 1.5 Add focused projection tests that count affected-domain publication and reject unrelated-domain rebuilds.

## 2. Local operation boundary

- [x] 2.1 Introduce a normalized Patch envelope with forward operations, inverse operations, base/commit revisions, and explicit changed paths.
- [x] 2.2 Derive a monotonic affected-path closure for replace, rename, move, discard, and restore, including required ancestors and old/new descendants.
- [x] 2.3 Carry the same prepared authoritative snapshot, revision, Patch envelope, and closure through one runtime interaction without duplicate reads or cloning.
- [ ] 2.4 Separate commit revision identity from path-scoped cache validity and expose closure-expansion diagnostics.
- [x] 2.5 Establish one 4784 cold-preparation/readiness boundary and retain the prepared immutable world across all steady interactions.
- [x] 2.6 Compute the canonical revision once per committed interaction and carry it through persistence, receipt, cache adoption, and publication.
- [x] 2.7 Complete the initial private recovery backup before 4784 readiness so it cannot contend with first user interactions.

## 3. Indexed runtime effects

- [ ] 3.1 Build disposable reverse indexes for Program triggers/read dependencies, support endpoints, locks, shortcuts, and descendant paths.
- [ ] 3.2 Update only intersecting reverse-index entries after a committed Patch and implement bounded local backfill for missing entries.
- [ ] 3.3 Route Program reconciliation and authorization/lock/support/shortcut selection through the affected closure and reverse indexes.
- [ ] 3.4 Verify indexed selection against focused shadow calculations and report candidate/executed counts in diagnostics.
- [x] 3.5 Return zero-candidate Transform events directly from the prepared reverse indexes without constructing whole-world Program records.

## 4. Incremental commit and projection

- [x] 4.1 Write new local transaction history as Patch/inverse Patch records with prepared/committed markers while preserving legacy snapshot reads.
- [x] 4.2 Remove per-edit complete-world before/after snapshot creation and repeated full-world change discovery from the local commit path.
- [x] 4.3 Make recovery idempotent across failures before and after authoritative atomic replacement.
- [x] 4.4 Share Graph construction and publish only affected Web domain segments and relationship endpoints.
- [x] 4.5 Reuse unaffected projection segments across revisions and preserve authoritative refresh/restart reconstruction.
- [x] 4.6 Move disposable Graph/Spatial synchronization outside the authoritative response path while exposing revisioned pending/recovery state.
- [x] 4.7 Route public interactive Agent entry context through 4784 and remove the direct backing-fact projection from that entry path.

## 5. Acceptance and delivery

- [x] 5.1 Run focused tests for all five Issue #29 TestCases and record work-count evidence.
- [x] 5.2 Run `.rep/.ren/.mov/.dsc/.rst` plus steady exact Explore on the shared local acceptance world and verify every operation is under five seconds.
  - Evidence `EV-I29-REAL-COPY-20260830-K`: `.rep/.ren/.mov/.dsc/.rst/Explore = 1.747/1.736/1.488/1.408/1.280/0.747s` on the 16.7MB isolated copy of the shared world.
- [x] 5.3 Verify failure rollback, runtime restart, authoritative readback, Web refresh, and zero unrelated Program execution.
  - Evidence: seven copy-only commits rolled back to the source revision; source bytes unchanged; restart healthy; zero Program failures; `TC-I24-WEB-MOVE-*` covers authoritative F5 persistence and failure rollback.
- [x] 5.4 Map each TestCase to an evidence ID and Issue #29, update Issue #1, and validate the OpenSpec change strictly.
- [ ] 5.5 Commit, push, open and merge the PR after focused CI passes, deploy the shared runtime, and repeat the acceptance measurements.
