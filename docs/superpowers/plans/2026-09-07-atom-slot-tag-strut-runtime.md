# Atom Slot Tag Strut Runtime Implementation Plan

> **Status:** APPROVED FOR EXECUTION. The user-approved contract is `docs/superpowers/specs/2026-08-31-atom-world-program-design.md` §4.2.1. This plan implements that contract and supersedes the adjacent parent/child Slot-signal execution plan.

**Goal:** Make one ephemeral label packet travel from an explicit provider, through the source node's actual Graph push-strut and its Program, to explicitly matching receiver Programs, while facts and causal effects remain separate atomic closures.

**Architecture:** Reuse the existing Transform action envelope as the external ingress and replace the adjacent-tree resolver with one canonical Graph-strut packet router. Program declarations compile into local provider/receiver indexes; one causal scene advances in waves, groups all packets reaching the same strut in the same wave, runs that strut's explicit Program once, and emits zero or one multi-label packet. Existing strict-bool Strut and adjacent `slot()/signal()` behavior enters only through a marked compatibility adapter during migration; it does not form another scheduler and is removed after its active production declarations are migrated.

**Graph impact evidence:** GitNexus index `main@a0e6e45` shows `resolveSlotSignalDeliveries` has two direct production callers (`executeAtomLanguageInteraction`, `reconcileProgramsForWorld`) and `buildStrutDeliveries` has one production caller (`ProgramRuntimeScheduler.computeRefresh`). Directly affected gates therefore center on Graph parsing, Program runtime, Engine reconciliation, `$act`, Slot-signal migration and public command journeys; whole-software `npm test` is outside this plan.

---

## Task 1: Freeze the canonical packet and declaration contracts

**Files:**
- Modify: `work-engine/atom-language/program-worker.py`
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `work-engine/atom-language/program-function-registry.json`
- Create: `tests/atom-slot-tag-contract.test.mjs`

- [x] RED: prove `slot_provide(["标签一","标签二"])` produces exactly one packet for the current Program's containing node; a second call, empty/duplicate/invalid labels, or use outside an active causal invocation is rejected.
- [x] RED: prove `slot_receive({"labels":[...],"match":"all|exact"}, handler)` is a top-level declaration, contains no path/channel, and invokes `handler(packet)` only for a matching packet.
- [x] GREEN: add canonical `slot_provide()/slot_receive()` effects and AST declarations. Historical names remain temporarily available only for Task 5 migration and do not enter the canonical packet type.
- [x] GREEN: compile provider ownership as the containing node (or the Program itself when top-level). Receiver declaration is source-derived and contains labels only; Task 2 binds its containing node into the Graph index.
- [x] Verify: contract, Python runtime and registry tests pass `33/33`; commit `feat(slot): define tag packet contracts`.

## Task 2: Replace adjacent-tree routing with Graph-strut routing

**Files:**
- Replace: `work-engine/atom-language/slot-signal-runtime.mjs` with canonical packet routing semantics, then rename only if all imports and recovery evidence remain exact.
- Modify: `cli/lib/graph-json.mjs`
- Modify: `work-engine/atom-language/strut-runtime.mjs`
- Create: `tests/atom-slot-tag-routing.test.mjs`

- [x] RED: an ingress packet selects only struts whose antecedent contains the exact provider node; containment parent/child proximity alone produces no delivery.
- [x] RED: same-wave packets from multiple antecedents are grouped into one immutable input packet for one compound strut; no historical packet is read or retained.
- [x] RED: each strut requires one explicit Program for target behavior; zero Program means no target-runtime propagation, multiple Programs are rejected. Existing declarations remain readable only through the marked migration adapter.
- [x] GREEN: build a cached local `node -> outgoing struts` index; each selected clause already owns its downstream endpoint list. Task 3 adds the receiver-condition index when it can be exercised end to end.
- [x] GREEN: use Graph clause identity, antecedent order and consequent order already produced by `parseGraphDocument`; do not infer channels from Slot containment.
- [x] Verify: packet routing, adjacent-legacy isolation, strut endpoint and four-axis Graph gates pass `35/35`; commit `feat(slot): route packets through graph struts`.

## Task 3: Run the strut Program and downstream receivers

**Files:**
- Modify: `work-engine/atom-language/program-runtime.mjs`
- Modify: `work-engine/atom-language/strut-runtime.mjs`
- Create: `tests/atom-slot-tag-scheduling.test.mjs`

- [ ] RED: the line Program receives the current wave's packet and same-revision fact context, then zero `slot_provide()` calls means no output and one call means one multi-label output; strict boolean return does not drive target propagation.
- [ ] RED: downstream `all` and `exact` receivers execute only on their declared node; plain text nodes, Programs without `slot_receive`, and unrelated labels remain still.
- [ ] RED: a causal scene is ephemeral. Each strut runs at most once in that scene and emits at most one packet; a later external ingress is a new scene. The kernel adds no hidden Program, default pass-through, historical accumulation, global broadcast or application-specific cycle policy.
- [ ] GREEN: add a scene-local wave queue to the existing scheduler, retain packet identity only until the scene settles, and route receiver/line Program effects through current bounded execution and claim lifecycle.
- [ ] Verify: scheduling, concurrency/isolation, Program failure and projection-lifecycle gates; commit `feat(slot): execute tag causal scenes`.

## Task 4: Join `$act`, fact commits and Program effects without coupling them

**Files:**
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `work-engine/atom-language/transform-executor.mjs` only if the action envelope lacks an exact target packet field.
- Create: `tests/atom-slot-tag-e2e.test.mjs`

- [ ] RED: `transform {"thing$act=钻木取火|人工介入":"世界/木头"}` creates one scene at the exact target after existing Agent write authorization and does not mutate facts.
- [ ] RED: a normal Transform commits its fact independently; only an explicitly running provider Program may emit a packet. Downstream Program failure cannot revoke the source fact receipt and must be reported as the subsequent execution result.
- [ ] RED: receiver Transform effects use existing authorization and local atomic commit logic; labels never lend authority. One receiver failure does not corrupt facts or leak a half packet into a later scene.
- [ ] GREEN: translate `$act` and Program provider output into the same canonical ingress shape and queue it through `reconcileProgramsForWorld`; preserve source/subsequent receipt separation.
- [ ] Verify: `$act`, postcommit boundary, local atomic, Engine and public random-port CLI journeys; commit `feat(slot): connect act to tag causal runtime`.

## Task 5: Migrate the old runtime through one adapter

**Files:**
- Modify: `work-engine/atom-language/inline-strut-migration.mjs`
- Modify: `work-engine/atom-language/strut-receiver-migration.mjs`
- Modify: `work-engine/atom-language/program-strut-trigger-migration.py`
- Modify: `work-engine/atom-language/cli.mjs`
- Modify: `docs/superpowers/specs/2026-08-31-atom-world-program-design.md`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`

- [ ] Inventory active non-backup strict-bool Strut and adjacent Slot declarations on a private production-world copy; immutable logs and backup-zone objects are excluded.
- [ ] Convert behavior-preserving active declarations into explicit line/receiver Programs when the mapping is exact. Ambiguous business predicates remain listed and keep using the marked adapter; never guess labels or rewrite production facts silently.
- [ ] Remove public Help/registry promotion of `slot()/signal()` and strict-bool delivery after exact migration; document only canonical `slot_provide()/slot_receive()` plus the user-owned `$act` ingress.
- [ ] Run only the Graph impact gates identified above, one private-world migration/readback journey, and one formal CLI/API journey. Record exact remaining adapter count; zero is required before declaring the old runtime removed.
- [ ] Commit `feat(slot): migrate legacy strut signals`.

## Task 6: Review, backup and controlled deployment

- [ ] Run GitNexus change detection and direct impact review. Resolve every Critical/Important finding.
- [ ] Reuse the affected evidence for unchanged revisions; do not run whole-software full tests.
- [ ] Create a private hashed production backup, deploy through the existing Runtime/Watchdog tasks, and verify health, projection status, source hash conservation, `$act` ingress, one plant provider, one line Program and one matching receiver through formal entry points.
- [ ] Update the unique ledger by user-visible capability/bug axes, commit, and attempt the already-authorized remote safety push. A remote approval failure remains local to that push and cannot suspend product work.
