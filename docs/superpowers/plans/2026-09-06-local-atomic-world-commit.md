# Atom Local Atomic World Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make independent Atom Transform submissions commit, persist and become readable as independent local atomic units while preserving multi-path Transform atomicity, permissions, recovery and projections.

**Architecture:** Bind each request to one committed facts/manifest snapshot, rebase precise local patches across unrelated commits, then move full-world JSON compaction off the local commit hot path. Keep the world fingerprint for receipts and projection ordering while using local preimages and affected closures for concurrency.

**Tech Stack:** Node.js ESM, JSONL transaction journal, SHA-256 world/local fingerprints, `node:test`, Atom public CLI and Graph runtime.

**Spec:** `docs/superpowers/specs/2026-09-06-local-atomic-world-commit-design.md`

## Global Constraints

- One Transform remains one indivisible transaction across all of its affected paths.
- Reads return an old or new committed local value, never a mixed facts/manifest state.
- Disjoint local changes merge; overlapping preimages conflict without blind business replay.
- Permissions, locks, references, idempotency, Program lifecycle and projection ordering stay enforced.
- Production migration requires a private full backup, real-scale clone evidence and exact rollback.

---

### Task 1: Committed request snapshot

**Files:**
- Modify: `src/atom-system/adapters/transactional-world-persistence.mjs`
- Modify: `src/atom-system/adapters/legacy-engine-adapter.mjs`
- Modify: `src/atom-system/world-runtime/commit-coordinator.mjs`
- Modify: `work-engine/atom-language/context-store.mjs`
- Modify: `work-engine/atom-language/engine.mjs`
- Test: `tests/atom-world-transaction.test.mjs`
- Test: `tests/atom-graph-four-axis-deployment-migration.test.mjs`
- Test: `tests/atom-world-service-contract.test.mjs`
- Test: `tests/atom-transform-postcommit-boundary.test.mjs`

**Interfaces:**
- Produces: `persistence.readCommittedSnapshot()` returning `{ facts, revision, compatibilityManifest }` from one committed boundary.
- Consumes: the existing world repository and compatibility manifest cache.

- [x] **Step 1: Write failing interleaving tests**

Add a controlled test that pauses an Explore after it receives a committed snapshot, commits a different local change, then resumes the Explore. Assert that the first request returns the old self-consistent value and the next request returns the new value without `GRAPH_COMPATIBILITY_MANIFEST_REVISION_MISMATCH`.

- [x] **Step 2: Run the RED tests**

Run: `node --test tests/atom-world-service-contract.test.mjs tests/atom-transform-postcommit-boundary.test.mjs`

Expected: the paused request currently reads facts independently and fails with the manifest revision mismatch.

- [x] **Step 3: Add the committed snapshot port**

Return one frozen snapshot from the persistence owner and pass it through World Service to Engine/Explore. Reacquire it after a successful source commit instead of retaining the request's pre-commit manifest.

- [x] **Step 4: Run focused GREEN tests**

Run: `node --test tests/atom-world-service-contract.test.mjs tests/atom-transform-postcommit-boundary.test.mjs tests/atom-language-graph-server.test.mjs`

Expected: all tests pass and the deterministic interleaving returns old/new self-consistent snapshots.

Evidence: RED reproduced `GRAPH_COMPATIBILITY_MANIFEST_REVISION_MISMATCH` when the file advanced after capture, and a second RED proved committed inspection could observe the world-write/journal-commit gap. GREEN binds facts, revision and manifest inside the coordinator boundary and reacquires the tuple after source commit. Transaction/World Service `40/40` and Graph four-axis migration `11/11` pass; the latter was rerun outside the restricted sandbox because its Program AST subprocesses receive `EPERM` inside it.

- [x] **Step 5: Commit Task 1**

Run: `git add src/atom-system/adapters/transactional-world-persistence.mjs src/atom-system/adapters/legacy-engine-adapter.mjs work-engine/atom-language/engine.mjs tests/atom-world-service-contract.test.mjs tests/atom-transform-postcommit-boundary.test.mjs && git commit -m "fix(atom): bind reads to committed world snapshots"`

Committed as `9f5c8b1` together with the coordinator/context-store seams and exact evidence named above.

### Task 2: Disjoint local patch rebase

**Files:**
- Modify: `src/atom-system/world-runtime/local-world-patch.mjs`
- Modify: `src/atom-system/world-runtime/commit-coordinator.mjs`
- Modify: `src/atom-system/world-runtime/affected-path-closure.mjs`
- Test: `tests/atom-world-transaction.test.mjs`
- Test: `tests/atom-program-service-e2e.test.mjs`

**Interfaces:**
- Produces: `rebaseLocalWorldPatch(currentFacts, patch)` returning rebased facts and a patch with current before/after world fingerprints.
- Consumes: v1 local patches and affected path closure entries.

- [x] **Step 1: Write conflict-matrix RED tests**

Add tests for two different top-level paths, two different slot-instance paths, the same Atom axis, ancestor move versus descendant edit, relation endpoint overlap and lock-path overlap. Assert disjoint pairs both commit and overlapping pairs return `WORLD_REVISION_CONFLICT` with only the conflicting paths.

- [x] **Step 2: Run the RED matrix**

Run: `node --test tests/atom-world-transaction.test.mjs tests/atom-program-service-e2e.test.mjs`

Expected: disjoint candidates currently fail because `commitCandidate` compares the complete before revision.

- [x] **Step 3: Rebase verified local patches**

When the complete world fingerprint advanced, apply the candidate patch to current facts using its recorded preimages. If every local preimage still matches and the affected closures do not overlap, rebuild the after snapshot, receipt, local patch and inverse patch against the current fingerprint. Preserve the original command and correlation identities.

- [x] **Step 4: Keep incomplete effects conservative**

Commands without precise `changedPaths`, or with an incomplete affected closure, retain the existing complete-world conflict behavior. Do not infer independence from names or sibling position.

- [x] **Step 5: Run focused GREEN tests**

Run: `node --test tests/atom-world-transaction.test.mjs tests/atom-program-service-e2e.test.mjs tests/atom-program-work-order-e2e.test.mjs tests/atom-system-failure-recovery.test.mjs`

Expected: disjoint cases commit, overlap cases reject, rollback and recovery remain green.

Evidence: initial matrix RED showed both disjoint cases rejected by the complete-world revision and overlap errors lacked path evidence. GREEN covers different top-level Atoms, different slot instances, same Atom, ancestor move versus descendant edit, and shared relation/lock/Shortcut guards. A second RED proved a disjoint request arriving after the first commit still failed before candidate preparation; verified base facts now let it enter the same conservative rebase path. Public 4784 now commits both sibling edits without retry. The affected transaction, manifest, Program service/work-order and recovery chain passes `78/78` outside the restricted subprocess sandbox.

- [x] **Step 6: Commit Task 2**

Run: `git add src/atom-system/world-runtime/local-world-patch.mjs src/atom-system/world-runtime/commit-coordinator.mjs src/atom-system/world-runtime/affected-path-closure.mjs tests/atom-world-transaction.test.mjs tests/atom-program-service-e2e.test.mjs && git commit -m "feat(atom): commit disjoint local patches independently"`

### Task 3: Local durable commit hot path

**Files:**
- Modify: `src/atom-system/adapters/json-world-repository.mjs`
- Modify: `src/atom-system/world-runtime/commit-coordinator.mjs`
- Modify: `src/atom-system/adapters/transactional-world-persistence.mjs`
- Test: `tests/atom-world-transaction.test.mjs`
- Test: `tests/atom-local-runtime-amplification.test.mjs`

**Interfaces:**
- Produces: repository methods `appendLocalCommit(record)` and `compactCommittedState()`; `read()` materializes baseline plus committed records after its compaction watermark.
- Consumes: rebased local patch records from Task 2 and the existing incremental transaction directory.

- [x] **Step 1: Write durability and visibility RED tests**

Pause ten independent appends at controlled points. Complete seven and assert a read returns seven new values plus three old values. Inject failure before append, after append/fsync, before memory publication, during compaction write and after compaction replacement; restart each fixture and assert only committed records appear once.

- [x] **Step 2: Run the RED tests**

Run: `node --test tests/atom-world-transaction.test.mjs tests/atom-local-runtime-amplification.test.mjs`

Expected: the current repository rewrites the complete world file and lacks a committed-record watermark.

- [x] **Step 3: Add local committed-record storage**

Append the validated local record to the existing incremental transaction directory, sync it, advance the in-memory committed state once, and return the receipt. Reads load the compacted baseline and replay only complete committed records after its watermark. Partial trailing records remain invisible.

- [x] **Step 4: Move compaction off the acknowledgment path**

Create the next baseline in a temporary file, verify its world fingerprint and watermark, then atomically replace the baseline. A failed compaction leaves the prior baseline and committed records usable. Bound retained records by scheduling another compaction rather than blocking a local commit.

- [x] **Step 5: Prove the hot path is local**

Instrument the test filesystem and assert a one-axis Transform appends one bounded local record and does not write the complete world JSON before returning its committed receipt.

- [x] **Step 6: Run focused GREEN tests**

Run: `node --test tests/atom-world-transaction.test.mjs tests/atom-local-runtime-amplification.test.mjs tests/atom-system-failure-recovery.test.mjs`

Expected: all durability, visibility, recovery and bounded-write assertions pass.

Evidence: the recovered baseline first exposed missing closure premises and an eager-compaction cleanup race. Added RED cases covered every planned crash boundary, bounded filesystem writes, a compaction/read interleaving, explicit watermark recovery, invalid snapshot rejection, and threshold scheduling. Final Task 3 focused gate passed `61/61`; Task 1/2 preservation and affected public/structural gates passed `144/144`, all with zero skipped.

- [x] **Step 7: Commit Task 3**

Run: `git add src/atom-system/adapters/json-world-repository.mjs src/atom-system/world-runtime/commit-coordinator.mjs src/atom-system/adapters/transactional-world-persistence.mjs tests/atom-world-transaction.test.mjs tests/atom-local-runtime-amplification.test.mjs && git commit -m "feat(atom): persist local commits before async compaction"`

### Task 4: Public journeys and performance

Status: IMPLEMENTED and verified at `bfb18c89ac0ba43a9b8c8fa9234828849333e29d` from base `efd7fe44053aafb20f2288d3c8c07477109f68b7` (`I3/U3/D3/E2`). The four-axis/slot-body RED was `ROLLBACK_WORLD_DIVERGED` when an earlier precise local receipt applied its inverse after a later disjoint local receipt. GREEN rebases that inverse only across a complete, precise and non-overlapping committed chain; raw, incomplete, overlapping and full-world divergence remain conservative. Public HTTP evidence commits two generated slot instances with exact independent paths, confines the injected Program failure to instance A, completes instance B, and reads `新甲`/`新乙` once each through exact Explore. Focused evidence is rollback journey `1/1`, existing rollback matrix `5/5`, public journey `1/1` and work-order history `1/1`.

Fix round 1 is VERIFIED at `f21318dd31a72472314131a764f9b37bb02dc18d` from evidence revision `a256dfa9b543ac2d97a4d7d35b02ccd981856ce1`. A deterministic second-owner barrier after rollback candidate preparation produced RED `1 !== 2`: inverse facts rebased after the owner committed a disjoint path, but `rebaseResult` was not retained and the compatibility manifest was not recalculated. Passing the existing callback into candidate preparation makes the focused manifest/facts journey `1/1` GREEN (`85.247ms`). The public journey now keys histories by correlation ID and compares each complete `changedPaths` and patch-operation path array to its sole expected path, with explicit peer-path absence and distinct command IDs; focused public GREEN is `1/1` (`11,021.552ms`). The exact affected gate passes `198/198`, zero failures/skips, in `35,633.623ms`; original private-copy performance and production-source conservation evidence remain unchanged. Independent fix-round review remains pending.

Real-scale evidence used a private copy of the current 14,293,038-byte production source containing 12,243 Atoms. A 519-byte non-Program leaf received five warmups followed by 35 measured one-axis commits: acknowledgment p50 `401.021ms`, p95 `438.612ms`, min `366.453ms`, max `449.019ms`; appended local frames p50 `3,458B`, p95 `4,354B`, range `2,515–4,410B`. The copied baseline had zero writes before acknowledgment and stayed byte-identical; production SHA-256 was `3a9e51cb00c0ed6a8bb77ed495adf1c99d48d7c058cb14d6dbd6b55e9f9afcbb` before and after. The exact affected gate passed `197/197`, zero failures/skips, in `33,786.271ms`. No production write, push or deployment occurred; Task 5 owns migration and deployment, and the separate A immersive domain-frame defect remains red.

**Files:**
- Modify: `tests/atom-language-graph-server.test.mjs`
- Modify: `tests/atom-program-work-order-e2e.test.mjs`
- Modify: `tests/atom-slot-body-mirror-runtime.test.mjs`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`

**Interfaces:**
- Consumes: committed snapshots, disjoint rebase and local durable storage from Tasks 1–3.
- Produces: CLI/Web/Program evidence and real-scale timing evidence.

- [x] **Step 1: Add public concurrency journeys**

Run two different slot instances concurrently through public requests. Assert both source receipts commit, histories remain isolated, a Program failure is reported only on its source, and exact Explore observes each completed local state without retry.

- [x] **Step 2: Add four-axis conservation journeys**

Exercise rename, move, discard/restore, Strut endpoints, Shortcut targets, locks and a slot-body instance. Assert references and inverse rollback remain exact after an unrelated local commit lands between prepare and commit.

- [x] **Step 3: Measure a real-scale private copy**

On a private copy of the current production world, run at least 30 warm single-axis commits and record p50, p95, local record bytes and whether any complete-world write occurred before acknowledgment. The engineering target is p95 no greater than 1000ms.

- [x] **Step 4: Run the affected system gate**

Run: `node --test tests/atom-world-transaction.test.mjs tests/atom-world-service-contract.test.mjs tests/atom-transform-postcommit-boundary.test.mjs tests/atom-language-graph-server.test.mjs tests/atom-program-service-e2e.test.mjs tests/atom-program-work-order-e2e.test.mjs tests/atom-slot-body-mirror-runtime.test.mjs tests/atom-system-failure-recovery.test.mjs tests/atom-local-runtime-amplification.test.mjs`

Expected: all tests pass with zero unexpected skip.

- [x] **Step 5: Record evidence and commit Task 4**

Update the existing current requirement ledger with exact revision, counts, timings and open boundaries, then commit tests and documentation with message `test(atom): prove local atomic commit journeys`.

### Task 5: Migration, full verification and controlled deployment

**Current checkpoint (2026-09-07):** Exact whole-branch review of `2701e61..854f023` returned Changes Required (Critical 0 / Important 3). I1 is implemented and affected-chain verified at `224ebb0e8eedf27f5d5311d0bca4a21728884d5f`: a real local append followed by committed-event `EIO` now advances the shared persistence-owner generation when recovery finalizes the prepared decision, invalidates the owner manifest cache, and forces the next adapter request to reacquire one facts/revision/manifest tuple while an already active request remains fixed. The same adapter also exposes a thin read-only `readCommittedSnapshot({ contextFile, projectionFile })` seam over `transactionFor()` and `committedSnapshotFor()` for the separate cold-read repair; it contains no projection logic. I2 and I3 remain open: cold projection/direct authority consumers can still read the frozen baseline without the un-compacted local log, and a valid schema-version-1 prepared transaction interrupted after the old world write cannot yet cross the new exact-proof cutover. Production, remote, generated bundles and the A immersive-domain defect remain untouched. The first attempted full suite remains failure evidence rather than a release gate; run the final full suite once only after I2 and I3 close and the repaired range is independently approved.

**Files:**
- Modify: `docs/superpowers/plans/2026-09-06-local-atomic-world-commit.md`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`

**Interfaces:**
- Consumes: the reviewed candidate and private real-world backup.
- Produces: migrated production runtime, formal entry readback and exact rollback evidence.

- [ ] **Step 1: Review the exact candidate range**

Run GitNexus change detection for the staged code and inspect direct callers of the repository and coordinator. Resolve every Critical or Important finding before broader tests.

Review evidence: `.superpowers/sdd/2026-09-06-local-atomic-world-commit/final-review.md`. I1 is repaired with a two-mode real-persistence regression; I2 and I3 remain reproduced and unresolved. This step remains open until all three repairs receive independent exact-range approval.

- [ ] **Step 2: Run one final full suite**

Run: `npm test`

Expected: all applicable tests pass; infrastructure-only cleanup failure must be isolated and rerun without discarding business assertions.

- [ ] **Step 3: Create and verify a private production backup**

Copy the current world baseline, incremental journal, transaction index and projections into the established dated backup root. Record SHA-256 for every file and prove cold read plus exact rollback on the copy.

- [ ] **Step 4: Deploy through the existing service task**

Stop the existing controlled runtime, migrate its current state once, start the same service entry and verify health, committed watermark and projection status. Never restore an earlier development snapshot over newer production facts.

- [ ] **Step 5: Verify formal user journeys**

Through the formal HTTPS/CLI entry, perform one read-only snapshot check and authorized disjoint local test operations in an approved test domain. Confirm immediate exact Explore, independent receipts, Program outcome separation and Web projection convergence.

- [ ] **Step 6: Verify remote backup and close the ledger**

Push the reviewed code and non-sensitive documentation to the existing private origin, compare the exact remote SHA, and update the current ledger with deployment, formal readback, rollback and remaining true-device boundaries.
