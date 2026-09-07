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

- [x] RED: the line Program receives the current wave's packet and same-revision fact context, then zero `slot_provide()` calls means no output and one call means one multi-label output; strict boolean return does not drive target propagation.
- [x] RED: downstream `all` and `exact` receivers execute only on their declared node; plain text nodes, Programs without `slot_receive`, and unrelated labels remain still.
- [x] RED: a causal scene is ephemeral. Each strut runs at most once in that scene and emits at most one packet; a later external ingress is a new scene. The kernel adds no hidden Program, default pass-through, historical accumulation, global broadcast or application-specific cycle policy.
- [x] GREEN: add a scene-local wave queue to the existing scheduler, retain packet identity only until the scene settles, and route receiver/line Program effects through current bounded execution and claim lifecycle.
- [x] Verify: scheduling, concurrency/isolation, Program failure and projection-lifecycle gates pass `134/134`; commit `feat(slot): execute tag causal scenes`.

## Task 4: Join `$act`, fact commits and Program effects without coupling them

**Files:**
- Modify: `work-engine/atom-language/engine.mjs`
- Modify: `work-engine/atom-language/transform-executor.mjs` only if the action envelope lacks an exact target packet field.
- Create: `tests/atom-slot-tag-e2e.test.mjs`

- [x] RED: `transform {"thing$act=钻木取火|人工介入":"世界/木头"}` creates one scene at the exact target after existing Agent write authorization and does not mutate facts.
- [x] RED: a normal Transform commits its fact independently; only an explicitly running provider Program may emit a packet. Downstream Program failure cannot revoke the source fact receipt and must be reported as the subsequent execution result.
- [x] RED: receiver Transform effects use existing authorization and local atomic commit logic; labels never lend authority. One receiver failure does not corrupt facts or leak a half packet into a later scene.
- [x] GREEN: translate `$act` and Program provider output into the same canonical ingress shape and queue it through `reconcileProgramsForWorld`; preserve source/subsequent receipt separation.
- [x] Verify: canonical contracts, Graph routing, scheduling, `$act`, authorization and legacy Strut isolation pass `33/33`; the broader direct run passes `218/219`, with its sole old Slot source-file assertion independently reproduced unchanged on baseline `e768d34` and therefore not attributed to this change. Commit `feat(slot): connect act to tag causal runtime`.

## Task 5: Migrate the old runtime through one adapter

**Files:**
- Modify: `work-engine/atom-language/inline-strut-migration.mjs`
- Modify: `work-engine/atom-language/strut-receiver-migration.mjs`
- Modify: `work-engine/atom-language/program-strut-trigger-migration.py`
- Modify: `work-engine/atom-language/cli.mjs`
- Modify: `docs/superpowers/specs/2026-08-31-atom-world-program-design.md`
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`

- [x] Inventory active non-backup strict-bool Strut and adjacent Slot declarations with the read-only `inventory-slot-tag-runtime.mjs`; immutable logs and the typed default-backup subtree are separated. Production result: zero adjacent `slot()/signal()`, zero canonical declarations, twelve literal strict-bool line Programs and five unclassified line Programs.
- [x] Convert behavior-preserving active declarations only when the mapping is exact. Current exact conversion count is zero: the seventeen active line Programs contain business predicates but no user-owned output label contract, so inventing labels would change meaning. They remain listed on the compatibility path and production facts remain byte-untouched.
- [x] Keep public compatibility functions while the exact remaining adapter count is seventeen. Do not claim the old runtime removed; public removal is conditional on a later application-owned label migration reducing that count to zero.
- [x] Run only the Graph impact gates identified above, one private-world migration/readback journey, and one formal CLI/API journey. The public CLI used an isolated random-port Graph service and proved `$act → line Program → slot_receive → Transform`, followed by cold-start exact readback. The direct set passes `48/48`; the remaining compatibility count is seventeen, so the old runtime is explicitly not declared removed.
- [x] Commit `feat(slot): inventory legacy strut signals` (`f2622d3`).

## Task 6: Review, backup and controlled deployment

- [x] Run GitNexus change detection and direct impact review. Exact symbol impact is LOW: `reconcileProgramsForWorld` has one direct production caller and `routeSlotTagPackets` has one direct scheduler caller. Change-count classification is broad because the feature necessarily crosses registry, worker, scheduler and engine; the identified execution paths are covered by the `48/48` direct set and the earlier `218/219` run whose sole failure was reproduced on the baseline.
- [x] Reuse the affected evidence for unchanged revisions; do not run whole-software full tests.
- [x] Create a private hashed production backup, deploy through the existing Runtime/Watchdog tasks, and verify health, projection status, source hash conservation, `$act` ingress, one plant provider, one line Program and one matching receiver through formal entry points. Backup `migration-backups/slot-tag-strut-runtime/20260907-094106` verifies 442 files; production `atom.json` remains `3a9e51cb…afcbb`. The disposable public CLI journey proves the complete plant chain and cold-start persistence without inserting test facts into production. Formal 4784 exposes registry v8 with both Slot tag functions, accepts a no-fact `$act`, exact-reads the current Agent, and reports projection `published`.
- [x] Update the unique ledger by user-visible capability/bug axes and commit. Attempt the already-authorized remote safety push after this closure commit; a remote approval failure remains local to that push and cannot suspend product work.
