## Context

See `proposal.md` for motivation and the four delta specs for observable behavior. The current runtime repeatedly materializes the same authoritative world across language evaluation, Program reconciliation, transaction history, revision hashing, and two Web projectors. Partial caches exist, but a changed revision still causes broad invalidation and local history stores complete before/after snapshots. The authoritative source must remain the single `atom.json`; derived indexes and projections cannot acquire fact authority.

## Goals / Non-Goals

**Goals:**

- Carry one exact affected-path set from parsing through commit and publication.
- Share one prepared authoritative snapshot and revision within an interaction.
- Make Program/support/lock/shortcut selection proportional to affected dependencies.
- Replace new per-edit full-world history with atomic Patch/inverse Patch records while retaining legacy read compatibility.
- Update Web read models by affected domain and make performance scope observable.

**Non-Goals:**

- Replacing `atom.json` with another database or fact source.
- Deleting or rewriting legacy transaction history.
- Changing Atom language semantics, authorization semantics, or business node content.
- Using a full-world periodic backup as part of every local transaction.

## Decisions

### 1. Patch envelope is the shared transaction boundary

Every mutating language operation produces a normalized envelope containing base revision, operation kind, exact changed paths, forward operations, inverse operations, and relationship/path effects. All later stages consume that envelope rather than rediscovering changes by flattening complete before/after worlds.

Alternative considered: retain complete snapshots and optimize compression. Rejected because it leaves work proportional to world size and obscures the actual change boundary.

### 2. Affected closure is explicit and monotonic

The initial paths come from the command. Authorization adds required ancestors; move/rename adds old/new descendants; support and shortcut lookup add referenced endpoints; Program lookup adds only indexed readers/triggers. A stage may add paths but may not silently replace the closure with the whole world. Diagnostics record each expansion reason.

Alternative considered: infer scope independently in every layer. Rejected because duplicated inference caused inconsistent caches and repeated traversal.

### 3. Reverse indexes are disposable runtime state

A revisioned index maps dependency keys to Program IDs, support edges, locks, shortcuts, and descendant path entries. Successful Patch application updates intersecting entries. A missing entry is computed from the local node, ancestors, descendants, and explicit endpoints, then cached. A deliberate maintenance rebuild may scan the world outside a user transaction, but ordinary commands may not use it as synchronous fallback.

Alternative considered: persist indexes as authoritative JSON beside the world. Rejected because it creates dual truth and crash-consistency ambiguity.

### 4. Commit writes authoritative state once and Patch history once

Validation works against a copy-on-write path overlay. The repository verifies the base revision, prepares a Patch history record, atomically replaces `atom.json`, finalizes the commit marker, and updates in-memory derived state. Inverse Patch is sufficient for local rollback. Legacy snapshot records remain readable and untouched.

Alternative considered: modify `atom.json` in place. Rejected because atomic replacement and recoverability are more important than avoiding one final serialization in the first increment. The design removes repeated clones/hashes/snapshots first; a page-oriented storage migration is not required.

### 5. Revision identity and cache validity are separated

The commit revision remains a whole-world identity for compare-and-swap. Cache entries additionally carry dependency fingerprints or affected-path generations, so a new revision invalidates only intersecting entries. This preserves concurrency safety without equating every commit with global cache invalidation.

Alternative considered: eliminate revision checks. Rejected because that would weaken conflict detection.

### 6. Web publication is domain-incremental

Graph topology and scene records are stored as disposable revisioned read-model segments keyed by domain and relationship endpoint. A Patch invalidates only intersecting segments. The current-domain response is published immediately; other affected segments may publish in the same bounded transaction or deterministic follow-up, but unrelated domains are reused. Refresh can always reconstruct from authoritative facts.

Alternative considered: keep rebuilding complete Graph and scene documents in both projectors. Rejected because it duplicates the largest derived computation and makes local latency depend on unrelated nodes.

### 7. Acceptance uses work counts plus wall-clock evidence

Focused tests assert affected paths, candidate counts, unrelated-domain skips, Patch shape, rollback, and legacy compatibility. Shared-local-world acceptance separately measures `<5s` latency. Work-count assertions prevent a fast test machine from hiding renewed global amplification; wall-clock evidence verifies user experience.

## Risks / Trade-offs

- **[Incomplete dependency index misses an effect]** → Compare indexed selection with a diagnostic shadow calculation in focused tests and maintenance verification; fail closed for authorization/lock uncertainty while keeping the scan local.
- **[Patch inverse is incorrect for move/rename]** → Generate inverse from captured local preimages and property-test round trips for descendants and references.
- **[Crash occurs between authoritative replacement and history finalization]** → Use prepared/committed markers with idempotent recovery keyed by commit ID and authoritative revision.
- **[Derived Web segments temporarily differ]** → Revision-tag every segment and never combine incompatible revisions in one response.
- **[First deployment has cold indexes]** → Warm indexes out of band and retain bounded local backfill; expose cold/backfill diagnostics.
- **[Initial implementation still serializes `atom.json` once]** → Accept one authoritative atomic serialization while eliminating duplicate whole-world work; measure before considering a different physical store.

## Migration Plan

1. Add Patch envelope, affected-closure diagnostics, and focused failing tests behind existing command behavior.
2. Add disposable reverse indexes and route Program/support/lock/shortcut selection through them with shadow verification in tests.
3. Add Patch history writes and legacy history reads; retain old snapshot files without deletion.
4. Share prepared snapshots and remove duplicate whole-world projection construction; publish affected Web segments.
5. Run focused regression, failure injection, restart/readback, and shared-local-world latency acceptance.
6. Merge and restart the shared runtime only after evidence is linked to Issue #29 and Issue #1.

Rollback reverts runtime code to the previous release. New Patch history is additive and self-describing; authoritative `atom.json` remains compatible. No legacy data is deleted.
