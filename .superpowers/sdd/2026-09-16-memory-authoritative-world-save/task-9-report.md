# Task 9 — verified immutable interaction version

## Delivered boundary

- `context-store` creates one private-WeakMap-branded committed version from an isolated facts/manifest copy. It verifies the source revision and compatibility manifest, normalizes and validates the Atom context, then deep-freezes and seals the owned facts/context. An unbranded descriptor cannot enter the fast path.
- The legacy adapter retains that derived version for the persistence compatibility generation and invalidates it on an accepted commit. Its internal `readCommittedVersion()` feeds engine, HTTP Agent resolution, runtime Agent resolution and projection. The existing public `readCommittedSnapshot()` still returns an isolated clone.
- The engine and consumers reuse the same Atom-array identity; its existing identity-keyed transform relation index therefore reuses its prepared value. The revision cache now trusts explicit seals only, and sealing traverses an already-frozen outer container to freeze nested values.

## RED evidence

- `node --test --test-isolation=none tests/atom-world-revision.test.mjs`: a shallow-frozen array reused a stale revision after descendant mutation (4 pass, 1 fail before the fix). A later frozen-but-unsealed getter case also reproduced stale hash reuse (0 pass, 1 fail under its name filter).
- `node --test --test-isolation=none --test-name-pattern='one accepted version retains' tests/atom-world-service-contract.test.mjs`: two same-version adapter/context reads had different Atom-array identities (0 pass, 1 fail).
- `node --test --test-isolation=none --test-name-pattern='graph server uses its supplied scheduler' tests/atom-language-graph-server.test.mjs`: across two HTTP requests, the Agent security rebuild received different context arrays (0 pass, 1 fail after correcting the expected three calls).

## GREEN evidence

All test commands set `ATOM_RUNTIME_BACKUP_REPO=''`; temporary-fixture suites ran with approved filesystem escalation. Node's default isolated test runner could not spawn under the sandbox (`EPERM`), so the runs used `--test-isolation=none`.

- Core: `node --test --test-isolation=none tests/atom-world-revision.test.mjs tests/atom-language-context-store.test.mjs tests/atom-world-service-contract.test.mjs tests/atom-language-graph-server.test.mjs tests/atom-language-graph-4d-projection.test.mjs tests/atom-projection-pipeline.test.mjs tests/atom-memory-authoritative-interaction.test.mjs` — 110/110 pass, 0 fail (final run after the manifest-null guard).
- Interaction/Transform: `node --test --test-isolation=none tests/atom-interaction-runtime.test.mjs tests/atom-language-transform-command.test.mjs tests/atom-language-transform-p1.test.mjs tests/atom-language-transform-p2.test.mjs tests/atom-language-transform-batch.test.mjs tests/atom-language-transform-receipt.test.mjs tests/atom-transform-postcommit-boundary.test.mjs` — 138/138 pass, 0 fail (final run after the manifest-null guard).
- `git diff --check` and `node --check` on all eight changed runtime modules exited 0. Git emitted line-ending conversion warnings, not whitespace errors.

## Boundary cases and limits

- Tests cover same-version context/index identity, accepted A→B→A invalidation, public-copy isolation, mutable and shallow-frozen caller input, forged revision, changed/removed manifest, rejected write, simultaneous old/new readers, and real engine Explore/Transform retaining an old immutable context after acceptance.
- An exploratory real-engine test using a memory-authoritative writer without the normal runtime composition produced `WORLD_SAVE_ORDER_CONFLICT` in its teardown. It was replaced by a complete fake persistence port for the real engine integration test; the existing memory-authoritative save/HTTP tests passed in the core group. This isolated test-harness conflict was not treated as a production defect.
- No full-system suite, real-data benchmark, deployment, push, remote operation, or file deletion was performed. End-to-end latency remains for the controller's same-journey measurement.
