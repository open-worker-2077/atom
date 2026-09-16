# Memory-Authoritative World and Independent Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the running memory world the sole interaction fact owner; reads observe accepted writes immediately while an efficient periodic saver persists versioned recovery points independently.

**Architecture:** One in-process versioned authority accepts validated local transitions and serves all CLI/Web/Program reads. A single-writer saver consumes immutable version snapshots after an interaction-driven quiet window or maximum dirty age, groups pending changes without skipping receipt/history semantics, and advances a durable watermark only after atomic persistence. On restart, the last verified watermark seeds memory; disk never overwrites a newer running version.

**Tech Stack:** Node.js 24 ES modules, built-in `node:test`, existing Atom four-axis engine, world repository and transaction journal.

**Spec:** `docs/superpowers/specs/2026-09-16-memory-authoritative-world-and-independent-save-design.md`

## Global Constraints

- The remote pre-change rollback marker is `backup/pre-memory-authority-20260916` at `86a5e8c8fa4ac074384786d86747432d0f34d111`.
- `atom.json` and private runtime facts are never committed to the code repository or modified for a test.
- Preserve a single public transition boundary, authorization, local conflict rules, one-Transform atomicity, Program source/effect boundaries, stable identities, and rollback evidence.
- Never use an old save or projection to overwrite a newer accepted memory version.
- Record `acceptedRevision`, `savedRevision`, pending/failed save state, and distinct interaction/save timing without exporting user content.
- Do not treat optimistic Web rendering as an authoritative read or a background copy of the existing slow synchronous commit as an efficient saver.

---

## File Structure

- `src/atom-system/world-runtime/memory-world-authority.mjs`: owns current immutable version, atomic transition ordering, same-version facts/manifest, and accepted receipts.
- `src/atom-system/world-runtime/independent-world-saver.mjs`: owns quiet/max-age scheduling, one save writer, durable watermark, retry/backpressure and close/flush.
- `src/atom-system/adapters/transactional-world-persistence.mjs`: storage adapter for verified recovery and batched, ordered save; existing durable journal/repository remains the storage contract, not a competing runtime fact owner.
- `src/atom-system/adapters/legacy-engine-adapter.mjs`: binds the Engine's existing `commitWorld`/snapshot ports to the memory authority and saver without changing public command syntax.
- `src/atom-system/public/interaction-runtime.mjs` and Web/CLI adapters only if needed: convey accepted versus saved state; no UI-only shortcut.
- `tests/atom-memory-authoritative-interaction.test.mjs`, `tests/atom-world-transaction.test.mjs`, `tests/atom-legacy-runtime-composition.test.mjs`, and targeted CLI/Web tests: RED/GREEN, recovery, compatibility and user journey.

### Task 1: Establish the red contract and cost attribution

**Files:** `tests/atom-memory-authoritative-interaction.test.mjs`, `work-engine/atom-language/engine.mjs`, `src/atom-system/adapters/legacy-engine-adapter.mjs`, current Superpowers ledger.

**Interfaces:** Consumes existing `createLegacyWorldService({execute,transactionProvider})`; produces a repeatable failing test for read-after-write while storage is blocked and timing evidence for currently unlabelled intervals.

- [x] **Step 1: Write the failing test.** Use a gated persistence `commit`, start one Transform, then issue Explore through the same World Service before releasing the gate; assert new value and prompt acknowledgment.
- [x] **Step 2: Run RED.** `node --test --test-isolation=none tests/atom-memory-authoritative-interaction.test.mjs` currently fails with `before !== after` in 0.55 seconds.
- [ ] **Step 3: Attribute the missing timing.** The content-free `security-rebuild` probe is RED→GREEN and its affected 16 tests pass; source notification/snapshot timing and real-scale attribution remain. Compare named stages with total `transform-stage` elapsed before closing this step.
- [ ] **Step 4: Re-run existing baseline.** `node --test --test-isolation=none tests/atom-world-transaction.test.mjs` must remain 102/102 before architectural changes; current valid baseline is 102/102.
- [ ] **Step 5: Commit only the reproducible test and timing diagnosis**, then update the existing ledger with the exact cause and measured stage boundaries.

### Task 2: Build one versioned memory authority

**Files:** Create `src/atom-system/world-runtime/memory-world-authority.mjs`; create `tests/atom-memory-world-authority.test.mjs`.

**Interfaces:** `createMemoryWorldAuthority({initialSnapshot})` produces `snapshot()` and `accept({expectedVersion,expectedRevision,nextSnapshot,receipt})`; a successful `accept` returns `{acceptedVersion,acceptedRevision,savedVersion,savedRevision}`. `markSaved({version,revision})` changes only the durable watermark. The monotonic version guards A→B→A hash cycles; facts and manifest are read together from one version.

- [x] **Step 1: Write RED tests** for immediate read-your-writes, rejected stale revision/version, A→B→A save ordering, older save not rolling back facts, and exclusion of shallow-frozen mutable nested facts. Disjoint rebase remains an integration test at the existing closure-aware coordinator, not a new rule in this core.
- [x] **Step 2: Run** `node --test --test-isolation=none tests/atom-memory-world-authority.test.mjs`; observed initial constructor RED, then A→B→A and shallow-freeze RED before each fix.
- [x] **Step 3: Implement** the smallest authority around existing sealed revision utilities; atomic publication assigns one snapshot with facts, manifest, content revision and monotonic version. Readers take that object without storage I/O.
- [x] **Step 4: Run the new tests and existing local conflict tests** in `tests/atom-world-transaction.test.mjs`; new authority and revision tests `10/10 PASS`, existing transaction/recovery suite `102/102 PASS` at this revision.
- [x] **Step 5: Commit the authority and its tests.** Saved as `a5eaea5` on the isolated branch.

### Task 3: Build the independent, bounded saver

**Files:** Create `src/atom-system/world-runtime/independent-world-saver.mjs`; create `tests/atom-independent-world-saver.test.mjs`.

**Interfaces:** `createIndependentWorldSaver({save,quietMs,maxDirtyMs,clock,onState})` exposes `enqueue(version)`, `status()`, `flush()` and `close()`. `save(version)` persists a stable immutable version and returns its verified revision. Only one save call may run per world; a dirty version newer than the completed save is scheduled again.

- [x] **Step 1: Write RED tests** for quiet-window coalescing, maximum dirty age under continuous input, single active save with 100 queued accepts coalescing to the latest, retry after failure, and close flush.
- [x] **Step 2: Run** `node --test --test-isolation=none tests/atom-independent-world-saver.test.mjs`; three original tests failed on missing implementation before GREEN.
- [x] **Step 3: Implement** bounded scheduling and state changes; disk I/O stays behind injected `save`, with no memory authority lock while awaiting it. The real `save` adapter still must keep CPU serialization off the interaction event loop.
- [x] **Step 4: Run the new suite** with gated/failing save and deterministic clock; `4/4 PASS`. This proves orchestration only, not nonblocking real I/O.
- [x] **Step 5: Commit the scheduler and tests.** Saved as `a43c6f3` on the isolated branch.

### Task 4: Integrate real transactions, journal evidence and restart

**Files:** Modify `src/atom-system/adapters/legacy-engine-adapter.mjs`, `src/atom-system/adapters/transactional-world-persistence.mjs`, and only the necessary `world-runtime/commit-coordinator.mjs` / repository boundaries; extend `tests/atom-memory-authoritative-interaction.test.mjs` and `tests/atom-world-transaction.test.mjs`.

**Interfaces:** Engine `commitWorld(transition)` returns an accepted-memory receipt without awaiting saving; `readCommittedSnapshot` returns the current memory version; storage `saveThrough(version)` verifies ordered durable receipts and a recovery watermark. Existing `programExecutionForInteraction`, `recordProgramExecution`, restore evidence and rollback must read accepted in-memory history while running, with durable save snapshots preserving restart semantics.

- [ ] **Step 1: Extend RED** to real fixture storage: block disk save, accept two independent edits, Explore both immediately, release save, restart and inspect the last saved watermark; inject a save failure and verify memory keeps serving the new version while status reports unsaved.
- [x] **Step 1a: Preserve the coordinator rules at the new boundary.** An in-memory world/journal port now runs the existing coordinator and exposes accepted facts, receipt and pending Program outcome together; focused tests `3/3 PASS`. It is not yet the public runtime or a durable save adapter.
- [ ] **Step 2: Implement one startup owner** seeded from the existing verified committed view and bind all runtime reads to it. No request may reload a stale disk snapshot into active memory.
- [ ] **Step 3: Move commit I/O behind `saveThrough`** and batch or append only the changed closed set plus ordered receipt/history metadata; keep existing private recovery and integrity checks. Measure bytes and stage timing to prove no per-interaction full-world rewrite or per-cycle full-history scan.
- [ ] **Step 3a: Keep CPU off the interaction loop.** The real save adapter must serialize/hash/compress the changed closed set in a worker or equivalent bounded off-thread lane, with a real-scale event-loop-delay assertion while saving; an unawaited Promise on the same loop is not sufficient.
- [ ] **Step 4: Run the RED fixture, 102 transaction tests, Program source/effect and restore tests**, then targeted CLI/Web tests; resolve semantics conflicts at the owning boundary, not by weakening assertions.
- [ ] **Step 5: Commit the integrated runtime.**

### Task 5: Public state, exact rollback and production acceptance

**Files:** Public response/state adapters as required, focused contract tests, existing ledger and plan.

**Interfaces:** Public responses retain existing revision fields and add explicit accepted/saved watermark and save state; shutdown requests flush with a bounded timeout. A saved older version can seed restart but never overwrite a newer live version.

- [ ] **Step 1: Test CLI/Web/Program read-after-write, save pending/failure, same- and disjoint-path concurrent writes, and projection ordering through the real public entry points.**
- [ ] **Step 2: Test crash points** before save, during temporary write, after durable write but before watermark publication, and after it; verify only complete saved versions recover and no accepted version is silently called durable.
- [ ] **Step 3: Benchmark** separate p50/p95 for local read/write, save duration, save lag, affected paths, bytes and full-history reads using a private real-scale copy; compare with the pre-change 3.065-second reads and 17.805-second writes.
- [ ] **Step 4: Run gates in order:** smallest affected suites, real critical journeys, required architecture/system checks, one final candidate full suite. Do not upgrade while the current layer is RED.
- [ ] **Step 5: Before deploying, verify private world backup and old-code compatibility/rollback on a copy.** Deploy via the existing supervised runtime, read back the exact public revision and E3 journeys; push the exact code revision, wait for its remote checks to finish, and update the existing ledger with evidence.
