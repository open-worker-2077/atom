## 1. Baseline and Impact Gates

- [x] 1.1 Confirm branch/worktree/`ed64e2d`, preserve the no-ESG/no-4784/no-formal-data boundary, and record the focused baseline test commands without running the full suite early.
- [x] 1.2 Read the TDD good-test rules and run GitNexus upstream impact analysis before editing every affected Program worker/runtime, scheduler/index, authorization, transaction, slot-body, registry and Help symbol; surface any HIGH/CRITICAL blast radius before edits.
- [x] 1.3 Map each delta-spec scenario to a named test file and the production change that would make that test fail.

## 2. Coordinate, Registry and Validation TDD

- [x] 2.1 Add red tests for a shared Thing-coordinate adapter accepting absolute/current-relative exact `explore()[0]` results and rejecting strings, refs, zero/multiple/non-Thing results without redefining the four Graph axes.
- [x] 2.2 Add red Program-result tests for `jump`'s exact four keys, boolean when/recycle returns, coordinate where return, evaluation order and stable invalid-contract/destination errors.
- [x] 2.3 Add red tests for `changed(things)` exact arrays, dependency metadata, invalid inputs, indexed hit and no-hit short circuit before complex Program work.
- [x] 2.4 Add red registry/CLI Help tests for `jump`, `changed`, `ThingCoordinate`, exact Program examples using `explore({...})[0]` without `.ref`, self-lock rules/defaults/errors and `slot_body seal lock` risk/examples.
- [x] 2.5 Implement the minimal coordinate adapter, worker functions, result normalization and authoritative registry/Help definitions to make section 2 tests green.

## 3. Indexed Jump and Atomic Transaction TDD

- [x] 3.1 Add red scheduler tests proving jump/changed reuse the existing Transform/support reverse index, misses do not enumerate or execute unrelated Programs, and where runs only after a true when.
- [x] 3.2 Add red candidate-transaction tests for no-when guard, when-false guard, recycle-first direct recycle, successful one-revision move, invalid/ambiguous/cyclic/locked destination rollback and downstream Program failure rollback.
- [x] 3.3 Implement indexed nested Program evaluation and jump/recycle candidate effects through the existing scheduler, bounded invocation and Transform authorization path.
- [x] 3.4 Add red slot-instance tests proving a move from instance A to B atomically replaces scope/support/changed bindings, B triggers once, A no longer triggers, the shared template support is byte-identical and invented slots are not monitored.
- [x] 3.5 Implement stable-role scope rebinding and old-index removal inside the same candidate commit without adding a scheduler or world scan.

## 4. Window Self-Lock TDD

- [x] 4.1 Add red default-read tests for current, all descendants, same-parent peers and the unique direct parent, plus denials for the parent's peers, higher ancestors, other branches and exact-path bypass attempts.
- [x] 4.2 Add red default-write tests allowing descendant material creation/modification while denying current self, peers, direct parent, ancestors and other branches.
- [x] 4.3 Add red rule-validation tests for independent read/write allow+deny arrays; `current`, absolute explore and current-relative explore starts; exact/parent/peers/descendant depth; positive integer priorities; and rejection of fuzzy/ref/invalid starts.
- [x] 4.4 Add red precedence tests proving highest priority wins, same-priority allow/deny resolves deny, parent means one unique node, unmatched targets fall back to defaults and read/write never leak into each other.
- [x] 4.5 Implement self-lock normalization/evaluation as an independent authorization decision intersected with existing node locks for every CLI/Program read/write after exact resolution.
- [x] 4.6 Add red snapshot tests for atomic install/move/recycle, same-window effective-set subset-only tightening, self-expansion rejection, different reachable-window replacement/removal to defaults, lock-intersection denial and failed-recompute retention.
- [x] 4.7 Implement request-driven explicit override snapshots and the non-role-based external recovery path without any active-window no-lock state or hidden bypass.

## 5. Slot Structural Lock TDD

- [x] 5.1 Add red validation/plan tests for `seal lock:true|false`, default false, deterministic visible plan projection, existing/new instance coverage and invalid non-boolean rollback.
- [x] 5.2 Add red Transform tests proving mapped-slot self name/type/role/position/move/delete/support/Program/contract changes are denied while authorized unmapped descendant material create/update/move remains allowed.
- [x] 5.3 Add red forgery tests rejecting new/copied/moved/fake `槽模角色` mappings without inferring roles from names, types or positions; prove ordinary nested subtrees remain material and stay outside structure monitoring.
- [x] 5.4 Add red reseal tests proving an above-positioned window succeeds only through the node/self-lock intersection, updates mapped self/lock projections atomically, preserves local material, and fully rolls back on any denial/conflict.
- [x] 5.5 Implement plan-owned structural projections and pre/post candidate role classification, retaining existing material-conflict, support, revision and central transaction semantics.

## 6. Integration and Regression

- [x] 6.1 Run focused red-green-refactor cycles for worker/runtime, scheduler, transaction, interaction access, Program locks, slot body, function registry and CLI Help; keep the exact failing/passing evidence.
- [x] 6.2 Add/verify end-to-end CLI and Program tests for central commit/rollback, existing node locks, existing slot fill/reseal/support, full exact-path enforcement and no unrelated world scan.
- [x] 6.3 Verify Help describes lock priority/tie/default fallback, direct absolute/current-relative `explore()[0]` objects, slot lock-off risk, allowed material fill and denied slot-self/forgery examples.

## 7. Local Candidate Verification and Commit

- [x] 7.1 Run `openspec validate add-window-jump-self-lock --strict`, forbidden-contract scans, formatting/static checks and focused nearest regressions; fix each real failure and rerun only the failed gate once after correction.
- [x] 7.2 Run the complete automated suite once for the final candidate; if it genuinely fails, diagnose/fix and perform at most one complete rerun.
- [x] 7.3 Run GitNexus `detect_changes` against the candidate baseline, inspect the complete diff, audit every spec scenario and confirm no ESG/shared-4784/formal-data or four-axis redirection entered the change.
- [x] 7.4 Create one explicit local commit containing only the authorized source, tests and OpenSpec artifacts; report commit, exact JSON contracts, test totals, risks and remaining external gates without merge or push.

## 8. Total-Control External Gates

- [ ] 8.1 Total control merges the independent four-axis adapter seam, resolves integration conflicts and reruns combined automated verification.
- [ ] 8.2 Total control loads the candidate into the exclusive shared 4784 runtime and verifies its live Help/registry contract.
- [ ] 8.3 Total control performs isolated Atom `test`/ESG acceptance and human review, then alone decides merge and push; this branch does not modify formal Atom or ESG data.
