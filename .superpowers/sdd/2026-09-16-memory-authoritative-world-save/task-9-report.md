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
- The discarded real-memory test registered `t.after(fs.rm(directory))` before `t.after(service.closeSaves())`. Its only retained error was `WORLD_SAVE_ORDER_CONFLICT` from the durable writer's accepted-base comparison; it did not capture expected/current revisions. The controller reproduced that error by renaming the fixture to a retained path in the first after hook and closing the pending saver in the second, while the same real sequence with files present and explicit close succeeded. This is evidence for teardown order, not evidence that the runtime save failed. The new real-memory regression retains its fixture and closes explicitly before cold durable-writer recovery.
- After accepted Transform, the physical `atom.json` remains the baseline by design. The restored regression verifies that explicit close publishes the local commit and a cold durable-writer initialize returns the accepted revision and changed facts. A prior assertion that the baseline file itself must change was incorrect.
- No full-system suite, real-data benchmark, deployment, push, or remote operation was performed. End-to-end latency remains for the controller's same-journey measurement.

## Test-only fix round 1

- Removed the newly introduced `fs.rm` cleanup from the real-engine adapter test; it now reports and retains the temporary fixture path. The restored real-memory owner + actual engine test also retains its fixture, performs two Explore calls, accepts a Transform, verifies old/new context isolation, closes saving while files remain present, and verifies the cold durable writer's recovered revision/facts.
- Minimal restored regression: `node --test --test-isolation=none --test-name-pattern='real engine reuses an accepted memory version' tests/atom-memory-authoritative-interaction.test.mjs` — 1/1 pass, 0 fail, 385 ms total. The first version of this assertion failed because it incorrectly expected the baseline `atom.json` to change; the retained artifact showed the changed fact in a published local commit.
- Affected service/context command: `node --test --test-isolation=none tests/atom-memory-authoritative-interaction.test.mjs tests/atom-world-service-contract.test.mjs tests/atom-language-context-store.test.mjs` — 48/48 pass, 0 fail, 1.17 s total. `ATOM_RUNTIME_BACKUP_REPO=''` for both commands. No runtime modules changed in this fix round.
