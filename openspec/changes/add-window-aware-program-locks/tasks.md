## 1. Contract and Validation Tests

- [x] 1.1 Add failing Program-result tests for valid exact `allowed_windows.paths` and `refresh.policy = on_request` normalization.
- [x] 1.2 Add failing validation tests for malformed, duplicate, unresolved, non-exact, and non-`@agent` allowed paths with `INVALID_PROGRAM_LOCK_ALLOWED_WINDOWS`.
- [x] 1.3 Add failing registry and CLI Help tests for the complete lock, recomputation, defaults, and denial contracts.

## 2. Window-Aware Enforcement

- [x] 2.1 Add failing authorization tests proving an allowed resolved `@agent` path bypasses only the matching Program lock.
- [x] 2.2 Add failing write and read tests proving a non-allowed window receives `PROGRAM_LOCK_DENIED` or existing protected-read truncation without fact leakage.
- [x] 2.3 Implement lock normalization, exact Agent-path validation, interaction-path propagation, and allowlist-aware authorization while retaining legacy lock behavior.

## 3. Request-Driven Snapshot Lifecycle

- [x] 3.1 Add failing repository tests for atomic load/save and fail-closed validation of path-based request-driven lock snapshots.
- [x] 3.2 Add failing runtime tests proving ordinary Program/dependency/world changes do not replace an active request-driven snapshot.
- [x] 3.3 Add failing explicit `.run.` tests for atomic source-Program replacement, successful empty-set removal, and failed-recompute retention.
- [x] 3.4 Implement the independent snapshot repository and merge active snapshots with automatic Program locks during authorization.
- [x] 3.5 Wire exact selected `.run.` as the only publication trigger for request-driven snapshots.

## 4. Movement and Public Contract

- [x] 4.1 Add a failing end-to-end test that moves an allowed `@agent`, proves the old snapshot remains, explicitly recomputes, then proves only the new path is allowed.
- [x] 4.2 Add the authoritative lock contract to the Program function registry and render the same contract in CLI Help, including exact JSON and `.run.` syntax.
- [x] 4.3 Verify existing lock Programs and existing Program projection behavior remain compatible through the nearest regression suites.

## 5. Running Runtime Acceptance and Delivery

- [x] 5.1 Restart the hidden 4784 runtime and verify its Help and registry expose the newly committed contract.
- [x] 5.2 In the Atom `test` domain only, create an isolated lock Program, protected target, allowed window, and denied window; verify allowed write and denied write with exact read-back.
- [x] 5.3 In the same isolated test fixture, move the allowed window, verify the stale snapshot behavior, explicitly `.run.` the lock Program, and verify the new path behavior.
- [x] 5.4 Record the test paths and results, commit and push the coherent implementation, and return the commit, exact lock JSON, recomputation call, denial code, and acceptance evidence to the ESG task.
