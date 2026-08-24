## Context

See `proposal.md` for motivation and the two capability specs for observable behavior. Atom already has authoritative Graph axes, subtree copy, `use_program()` composition, event-indexed Program execution, window-aware locks and one central transaction boundary. The missing part is a small runtime that turns an explicitly modeled槽体 into repeatable槽例 without duplicating Program code or forcing application Agents to assemble nested Graphs manually.

The existing window lock admits exact `@agent` paths. The revised requirement is additive: exact paths remain compatible, while new policies can match Graph types and independently gate target state and interaction action. ChatGPT and Claude are the current trusted callers; this design is operational isolation, not a new Internet identity system.

## Goals / Non-Goals

**Goals:**

- Keep `槽体 → 槽模／槽例 → 空槽例／业务槽例` visible in ordinary Graph data.
- Make seal, named print and structure sync one public Program kernel with atomic effects.
- Keep料 in each槽例, keep shared Program in槽模, and assemble context only through explicit local relations.
- Extend locks with generic Graph-type predicates without hard-coding business window categories or schedules.
- Prove the capability on one real ESG activity work-order context, including both over-expansion and missing-context checks.

**Non-Goals:**

- Adding a new persistent Graph axis, executable Atom type, hidden template database or Graph version tree.
- Encoding one fixed form, workflow, lifecycle, window category taxonomy or controller policy in the kernel.
- Copying shared Program source into every槽例.
- Replacing `.cpy.`, `instantiate()`, `form()`, `work_order()` or existing exact-path locks.
- Editing ESG source workbooks or the activity task's production files during runtime acceptance.

## Decisions

### Use ordinary nodes and three reserved direct-child names

The runtime recognizes one target槽体 by three names: direct children `槽模` and `槽例`, plus `槽例/空槽例`. No “槽域”, “球”, new type axis or hidden catalog is introduced. A business author remains free to name the parent `订单槽体`, `审核槽体` or another domain term.

Alternative considered: a dedicated slot-domain type and backing registry. It would duplicate facts already expressible in Graph and make the user inspect two representations.

### Add `slot_body()` as a deferred Program effect

`slot_body(spec)` is exposed in the Python safe namespace and appends a validated deferred effect. Its first public actions are:

- `seal`: validate the layout and establish model-to-example mappings.
- `print`: atomically clone `空槽例` under `槽例` with a caller-supplied new root name.
- `sync`: apply current槽模 structure to `空槽例` and existing business槽例.

Node validates and applies each effect against the current in-memory candidate world; the world is committed once after all authorization and validation pass. The function returns only a planned receipt during Program evaluation, and Help requires a post-commit readback.

Alternative considered: expose a new `.cpyas.` Graph command. Copy-as is needed specifically as a safe higher-level operation here; adding parallel roaming syntax would widen the language surface and still leave layout and sync unresolved.

### Represent stable correspondence with an explicit partner relation

`seal` adds one reserved `槽模映照` relation from each non-Program槽例 node to its corresponding槽模 node. Existing rename and move logic already rewrites incoming partner targets, so the relation survives model path changes. Printed copies retain these external relations while their internal relations are redirected by the existing subtree-copy law.

The relation is visible and auditable in Graph rather than embedded in detail. `detail` remains料 for槽例 and definition text for槽模. The runtime never treats `槽模映照` as a business推线.

Alternative considered: pair nodes only by relative path. That cannot distinguish a rename from deletion plus addition and would risk moving料 to the wrong slot.

### Reuse the authoritative subtree copier for named print

The existing copy executor is factored so the same implementation can accept an internal root-name override. `print` performs validation, clone, root rename, internal partner redirection and insertion as one candidate-world operation. A sibling collision rejects before mutation. External relations to槽模 Programs remain external and are not copied.

Alternative considered: let `slot_body()` emit copy followed by rename transforms. Because `空槽例` and printed槽例 share one parent, the intermediate copy would collide before rename and would not be atomic.

### Sync by mapping, preserve detail byte-for-byte

Within one target槽体, `sync` indexes `槽模映照` relations and processes only槽模,槽例 and explicit relation endpoints. It mirrors names, containment, Graph types and model relations; it creates missing empty槽例 slots and keeps槽例 `detail` unchanged. Shared `@program` nodes are never materialized inside槽例.

An obsolete mapped slot with non-empty料 causes `SLOT_BODY_SYNC_CONFLICT` and aborts the whole sync. Empty obsolete slots can be moved through the existing recoverable discard path. Unmapped business-only nodes and relations are preserved; the runtime changes only structures it owns through `槽模映照`.

Alternative considered: rebuild every槽例 from the new model. It is simpler but cannot guarantee料 and local business additions remain attached to the same object.

### Shared Program receives one exact槽例 path

Reusable logic remains a normal `@program` below槽模 with `main(arguments)`. A controller calls it through `use_program({"name":"...","arguments":{"example":"exact/path"}})`. The shared Program explores only that槽例, explicit partner dependencies and shared references. This avoids full-session inheritance and repeated common catalogs while making missing dependencies observable before main computation.

The kernel does not prescribe ESG fields, process stages, terminology, payload-size thresholds or judgment chains. The acceptance Program and fixture remain outside runtime modules and use the real activity-axis material only as evidence that the general mechanism carries enough context.

Alternative considered: copy one caller Program into every槽例. That restores duplicated maintenance and Program scheduling costs the design is meant to remove.

### Match window and target types from existing Graph `@type` sets

`allowed_windows` accepts exactly one selector form: legacy `paths` or new `types`. `types` and `when.target_types` use the same predicate object with non-empty `all`, `any` and `none` arrays. Runtime derives the current window's types from the resolved world record at its exact path; it does not trust caller-supplied type claims. `when.actions` contains `explore`, `transform`, or both.

A selector passes when every `all` type exists, at least one `any` type exists when present, and no `none` type exists. The target-state and action conditions determine whether the lock is active; the window condition determines whether that active lock admits the caller. Omitted new keys retain old behavior.

Alternative considered: hard-code “研发／总控／执行”. Those are useful application labels but are not universal kernel categories and must remain user-defined Graph types.

### Keep scheduling in controller Programs

The lock runtime does not decide which concrete window is currently assigned to which槽例. Controller Programs continue to invoke guard-window, jump-window, close-window and explicit lock recomputation based on actual business state. Changing a binding does not rewrite every node lock. This keeps the kernel reusable and prevents one workflow from becoming mandatory.

### Project Program contracts at startup without replaying effects

Service startup validates Program contracts and rebuilds the current lock/projection view, but it does not replay messages, transforms or槽体 effects. Slot-body changes run only through an explicit Program run or a matching transform trigger and still enter the central transaction once. This prevents a restart from printing or synchronizing槽例 merely because the Program exists.

Alternative considered: reuse the ordinary reconciliation mode at startup. That can execute non-idempotent application effects before any caller has requested them and makes service recovery alter business data.

## Risks / Trade-offs

- **[A model and empty example cannot be paired unambiguously during first seal]** → Reject with exact unmatched paths; require the authoring Agent to make the visible structures correspond before sealing.
- **[A model deletion would strand non-empty料]** → Abort sync and report each conflicting槽例 path; never silently discard characters.
- **[A type predicate is too broad]** → Require explicit non-empty arrays, publish the normalized condition in Help/readback, and retain all other locks and transaction checks.
- **[Shared Program follows an accidental broad explore]** → ESG acceptance records every explored dependency and fails if the Program reads outside the槽例 relation closure.
- **[A compact ESG context omits a necessary semantic fact]** → Negative acceptance removes one dependency and requires an exact missing-path result before calculation.
- **[New slot-body effects bypass ordinary locks]** → The executor authorizes every affected existing node and parent with the same central controller before producing the candidate world.

## Migration Plan

1. Add red tests for layout validation, mapping, named nested print, partner redirection, Program non-copy, sync/data preservation, local traversal and error atomicity.
2. Add red tests for window-type predicates, target-state/action separation, exact-path compatibility, durable snapshot persistence and Help.
3. Implement the pure槽体 planner/executor, Python effect, Node transaction integration and registry/Help contract.
4. Run targeted suites, then the nearest Program, transform, lock, CLI, server and projection regressions.
5. Restart the hidden 4784 runtime and prove Help plus isolated `test` positive/negative cases.
6. In an acceptance-only fixture outside runtime code, read one real `ESG计划_活动轴` work-order input without modifying ESG files; materialize an isolated `test/ESG活动轴槽体试点-*`, print one槽例, assemble only explicit necessary context, run the instance-defined result, and verify:
   - no inherited session history or duplicated full catalog;
   - necessary source, relevant lane profile, reality facts, terminology and output contract are present;
   - the assembled payload stays below the acceptance fixture's prior compact 10 KB target where the real material permits; this number is not a kernel limit or default;
   - removing one required relation stops computation with an exact missing dependency;
   - readback proves no production ESG node was changed.
7. Commit only coherent Atom/OpenSpec changes, exclude the pre-existing `AGENTS.md` edit, push the branch, and retain the prior remote commit as rollback point.

Rollback restores the previous code and restarts 4784. The new test subtree is recoverably discarded only after its acceptance evidence is recorded; no production workbook or ESG business node is part of rollback.
