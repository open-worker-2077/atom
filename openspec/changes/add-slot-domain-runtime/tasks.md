## 1. Contract Tests

- [x] 1.1 Add failing pure runtime tests for槽体 layout, seal mappings and exact errors.
- [x] 1.2 Add failing tests for atomic named print, nested descendants, internal partner redirection, external shared Program retention and duplicate rejection.
- [x] 1.3 Add failing tests for localized sync, add/rename/move/type/relation mapping, detail preservation and non-empty removal conflict.
- [x] 1.4 Add failing Program effect, registry and CLI Help tests for `slot_body()`.
- [x] 1.5 Add failing lock tests for window type predicates, target type state, explore/transform actions, invalid contracts and legacy path compatibility.
- [x] 1.6 Add a failing integration test proving unrelated Program creation must not replay an existing non-idempotent slot-body print.

## 2. Slot Body Runtime

- [x] 2.1 Implement a pure槽体 layout reader and stable `槽模映照` mapping planner without ESG-specific names or rules.
- [x] 2.2 Factor the authoritative subtree copier to support one internal atomic root-name override and use it for槽例 print.
- [x] 2.3 Implement localized sync with mapped structural changes, shared Program references, unmapped local preservation and byte-for-byte detail safety.
- [x] 2.4 Add `slot_body()` to the Python safe namespace, validate deferred effects in Node and commit them through the central transaction and lock boundary.
- [x] 2.5 Publish authoritative registry and CLI Help contracts, errors and readback instructions.
- [x] 2.6 Make Program-structure Transform dispatch skip unrelated legacy Programs even when the trigger index is empty or the available Program catalog changes, while retaining ordinary data-Transform compatibility.

## 3. Window Type Lock Conditions

- [x] 3.1 Implement reusable `all`/`any`/`none` Graph-type predicate validation and evaluation.
- [x] 3.2 Extend Program lock normalization, durable snapshots and indexes with either legacy window paths or new window types plus optional target types and actions.
- [x] 3.3 Resolve current window and target types from authoritative world records and enforce explore/transform conditions without hard-coded window categories.
- [x] 3.4 Publish the separated window-type, target-state and action contract in registry and CLI Help while retaining old exact-path behavior.

## 4. Automated Verification

- [x] 4.1 Run targeted槽体, Program, transform and lock tests and repair every regression.
- [x] 4.2 Run the nearest full CLI, graph-server, projection, transaction and performance suites.
- [x] 4.3 Run strict OpenSpec validation and verify no runtime module contains ESG field names, workflow constants or payload thresholds.
- [x] 4.4 Run the scheduler and槽体 integration regressions, then the complete Atom suite after repairing event selection.

## 5. Running Runtime Acceptance

- [x] 5.1 Restart the hidden 4784 runtime and verify its live Help and function registry expose the new contracts.
- [x] 5.2 In Atom `test`, prove seal, named print, shared Program non-copy, sync/detail preservation, duplicate rejection and window-type allow/deny with exact readback.
- [x] 5.3 Build an acceptance-only槽体 from one real `ESG计划_活动轴` input without editing ESG files or production Atom nodes.
- [x] 5.4 Prove the ESG槽例 reads only explicit necessary relations, avoids repeated shared context, stays within the fixture target where material permits, and still supports an independently checked semantic result.
- [x] 5.5 Remove one necessary ESG test relation and prove calculation stops with an exact missing-context result rather than inferred completion.
- [x] 5.6 Resume the isolated ACT-022 trial and prove both the compact positive result and exact missing-relation negative result without unrelated Program warnings blocking the transaction.

## 6. Delivery

- [x] 6.1 Review the complete diff against both specs and the original user conclusions; keep the pre-existing `AGENTS.md` change out of the commit.
- [ ] 6.2 Commit the coherent implementation and OpenSpec artifacts, push the branch, and record commit, live test paths, results and rollback point.
- [x] 6.3 Review and commit the user-trial regression repair without including the pre-existing `AGENTS.md` change.

### Delivery evidence

- Implementation commit: `0a0093d` (`feat(atom): add generic slot body runtime`).
- User-trial regression repair commit: the commit containing this evidence (`fix(atom): isolate program structure transforms`).
- Rollback point before this change: `515bb152697831f699985c0535642c61f4b1bf0a` (local and remote branch matched before commit).
- Live generic path: `test/槽体内核验收-20260825-01`; after the user simulation, `订单槽体/槽例` contains exactly one each of `空槽例`, `订单001` and `用户模拟001`.
- Live ESG acceptance-only path: `test/ESG活动轴槽体验收-20260825-01`; `完整结果` remains `ready` after reading exactly five explicit relations, while `缺项结果` remains `missing` with `relation:泳道依据`.
- Event-selection regression: red integration test reproduced `SLOT_BODY_EXAMPLE_EXISTS` from an unrelated `订单001`; the repaired scheduler and every previously regressed functional suite pass `76/76`.
- Live ACT-022 path: `test/ESG活动轴-槽体实用试跑-20260825-01`; positive result is `computed:true` with 234 read characters, negative result is `computed:false` with exact missing path `关系｜责任泳道.partners[依据]` and 169 read characters. Creating `调度隔离验收-20260825-02` succeeded without unrelated Program warnings or duplicate槽例.
- Verification: the EPIPE fault-injection test keeps the intended 150ms cut-off for the deliberately slow Program, then gives the same scheduler a separate 2-second recovery budget; its focused run passed `1/1`. Browser build plus the complete suite then passed `1007/1007`. Strict OpenSpec validation passed; runtime instance-term scan found no ACT-022 or ESG field constants in `work-engine`.
- Push status: pending. A fresh read-only `git ls-remote` confirms the target branch still points to rollback commit `515bb152697831f699985c0535642c61f4b1bf0a`, so local `9d8b246` remains a clean fast-forward with no remote divergence. GitHub authentication has since recovered and `gh auth status` verifies the active `open-worker-2077` account with `repo` scope, but the normal push approval gate still rejects code export until a new trusted user message explicitly authorizes this exact remote. No alternate upload path was used.
