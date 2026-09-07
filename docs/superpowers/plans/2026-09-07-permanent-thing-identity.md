# Permanent Thing Identity Implementation Plan

## Current execution checkpoint (2026-09-07)

- **Scope**: active P0 mainline. Human, Agent and Program inputs remain semantic; the kernel owns permanent identity. Identity is addressing metadata, not a fifth Graph axis and not a reasoning input.
- **Recovered work**: Task 1 implementation and compatibility fixtures were present but uncommitted after restart; Task 2 had only switched runtime `ref` to the identity. Tasks 3-5 had not started.
- **RED found**: the partial Task 2 reused the first Thing `ref` as the world cache key. With stable identities, a changed Situation could reuse an old Program result (`cached:true`).
- **GREEN**: permanent Thing identity, world revision and Program result cache keys are separated; path-lock rebinding now resolves the current Thing ref. Focused cache/index/lock tests pass `3/3`. The broader direct set passed `207/207` before this correction and must be rerun after each coherent stage.
- **Stage 1 candidate**: trusted persisted Things receive one opaque identity, external requests cannot forge it, create/move/rename/discard/restore preserve it, copies receive fresh identities, and runtime coordinates use it without exposing it as a Graph axis. Shortcut targets now bind that identity while retaining the current semantic path as their readable projection; reusing an old path cannot redirect the Shortcut to a different Thing.
- **Stage 1 evidence**: the combined direct impact gate covering grammar, persistence, Program cache/revision separation, Transform relations, Shortcut lifecycle, local transactions, slot-body rollback and real random-port 4784 service journeys passes `251/251` (`67,791.8024ms`).
- **Stage 2 candidate**: Strut endpoints accept semantic authoring, bind the resolved target identity inside the same Transform, and project only the target current semantic path. Reusing an old name cannot capture the line. Endpoint identities cannot be supplied externally. Copy binds internal lines to copied identities; move, rename, discard and restore retain the original binding. A repeatable cold migration now assigns missing Thing identities and binds legacy Shortcut/Strut references while preserving four-axis topology.
- **Stage 2 evidence**: Slot/Strut/Program/local-transaction direct impact gate passes `251/251` (`88,179.896ms`); the final grammar, Transform, projection and migration gate passes `51/51` (`1,464.6366ms`). Migration is idempotent on its own output.
- **Stage 3 candidate**: Program literals are parsed through Python AST and rebound only for actual kernel reference sites (`explore`, Transform trigger nodes, `use_program`, path locks and Program `transform`). Comments, messages and ordinary data remain unchanged. Each semantic selector must first resolve to exactly one Thing in the pre-Transform world; the rewrite records that Thing's permanent ID and ambiguous selectors stay untouched. The same parser now refreshes relocated Program dependency caches, replacing the old whole-string guess.
- **Stage 3 evidence**: Program/Transform/lock direct tests pass `59/59`; the initial affected gate exposed one legacy relocation-cache mismatch, both original failures then passed, and the final Program/Slot/migration gate passes `104/104` (`97,532.8178ms`). GitNexus identifies the direct callers as `applyTransform` and `applyBatchRenames`, with six affected Program/Transform execution flows; those flows are included in the gates.
- **Stage 4 cold-production evidence**: the deployment operator creates and verifies a private backup, commits once, rereads the authoritative world, and supports receipt-bound rollback. A cold copy of the current production world passed: `12,243/12,243` unique Thing identities, topology preserved, `81/81` active resolvable Strut endpoints bound, then rollback restored source revision `sha256:3fc31f…2852`. Two pre-existing `./前件｜必要输入齐全` endpoints are both inside the typed default backup and remain unchanged as historical data.
- **Stage 4 formal preflight correction**: the first formal apply was safely rejected because its preflight read only the compacted base while revision `9adb90c5…e19d` also included later durable local commits. No production mutation occurred and 4784 recovered healthy. The operator now plans from `readCommittedSnapshot()` while still backing up every base/projection/journal file; a new uncompacted-source regression passes `1/1`. The corrected formal preflight passes against revision `9adb90c5…e19d` with the same `12,243/12,243`, topology and active-Strut results.
- **Next**: commit the corrected operator, deploy the formal transaction under a new attempt ID, then read back public 4784. The queued Web pointer/crosshair display revision follows this mainline.

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give every Thing a permanent kernel identity so rename, move, and unrelated Transform commits cannot invalidate internal references while semantic authoring remains unchanged.

**Architecture:** Store one kernel-owned `&id=<opaque-id>` modifier on the Thing key. Parse it as persistent metadata, reject it at untrusted write boundaries, and issue it only through the central atom creation/migration path. Change runtime coordinates and relation bindings in bounded stages, keeping current paths as human-readable projections.

**Tech Stack:** Node.js ESM, built-in `node:crypto`, Atom Graph-JSON parser/runtime, Node test runner.

---

### Task 1: Persistent identity grammar and issuance

**Files:**
- Modify: `work-engine/atom-language/key-parser.mjs`
- Modify: `work-engine/atom-language/slot-graph-semantics.mjs`
- Modify: `work-engine/atom-language/receiver.mjs`
- Test: `tests/atom-language-p0.test.mjs`
- Test: `tests/atom-language-context-store.test.mjs`

1. Add failing tests for canonical `thing@program&id=...#...` parsing and persistence.
2. Add failing tests proving external Explore/Transform cannot forge `&id`, while trusted persisted facts can be read.
3. Add one identity generator and make the central creation helper issue an ID exactly once.
4. Run only parser, context-store, and creation tests until green.

### Task 2: Stable runtime ThingCoordinate

**Files:**
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `work-engine/atom-language/query-capability.mjs`
- Test: `tests/atom-language-program.test.mjs`
- Test: `tests/atom-world-service-contract.test.mjs`

1. Add failing tests proving one Thing keeps the same coordinate across unrelated commits, rename, and move.
2. Build runtime `ref` from the persisted Thing identity instead of world revision plus array address.
3. Keep current semantic path in every returned coordinate and update it after rename/move.
4. Verify only the affected Explore/Program coordinate journeys.

### Task 3: Relation binding by identity

**Files:**
- Modify: `work-engine/atom-language/shortcut-runtime.mjs`
- Modify: `work-engine/atom-language/transform-executor.mjs`
- Modify: relation normalization modules identified by impact analysis
- Test: existing Shortcut, Slot, Strut, rename, and move suites

1. Add focused failures for Shortcut, Slot, and Strut references surviving rename/move without path rewriting.
2. Resolve semantic authoring to target identity at commit time and project the current path on read.
3. Migrate one relation family at a time; remove its old path rewrite only after its focused journey passes.

### Task 4: Program reference binding

**Files:**
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `work-engine/atom-language/program-worker.py`
- Test: `tests/atom-program-reference.test.mjs`
- Test: affected Program suites

1. Distinguish exact literal semantic references from values selected dynamically at runtime.
2. Bind exact literals to Thing identity when the Program revision is accepted; resolve dynamic selections against the current world at runtime.
3. Add focused tests for rename/move survival and clear failure after actual deletion.

### Task 5: Legacy-world migration and deployment

**Files:**
- Add or modify: the existing four-axis deployment migration module
- Test: `tests/atom-graph-four-axis-deployment-migration.test.mjs`

1. Add a repeatable migration that assigns one unique ID to every legacy Thing without altering the four axis values or topology.
2. Run it first on a cold production copy; verify count equality, ID uniqueness, exact Explore, rename/move stability, and rollback artifact.
3. Commit and push each coherent safe stage to `origin/main`.
4. Deploy the migration as one atomic world transaction and read back the public 4784 entry.
5. Run one final candidate-wide affected suite; do not repeatedly run the whole software during intermediate stages.
