# Task 22 report — proven archive Program declarations

Base: `95f6461dc7d830af99a3b3f59b659493b5819599`. Scope: `default-backup-boundary.mjs`, `query-capability.mjs`, `engine.mjs`, one focused test. The root-owned plan and ledger were not edited or staged by this task. All test commands used `$env:ATOM_RUNTIME_BACKUP_REPO=''`; new fixtures were retained.

## Change and proof boundary

`programDeclarationSurface` now walks active nodes freshly and splices one private, immutable archived declaration summary at the archive root's DFS position. That summary is built once from the original `walkAtoms([root])` semantics, including the root if it is a Program, nested declarations, duplicate/missing `thing` fields, `[index]` placeholders, keys, situations and order. Output declarations are fresh objects; no archived `Match`, parent, Map or ACL escapes. A hit requires the *same root object* already registered by `default-backup-boundary` after its sealed-world boundary validation, with every `pathParts` component equal. A different archive root, a changed location (even if its joined path string collides), a second typed default backup or absent proof falls back to the original full traversal. The outer COW candidate is neither sealed nor trusted; its active nodes are reread for each comparison. `preparedBoundary`'s unsealed guard is unchanged. Normal, relocation and restore comparisons all call this same surface.

## RED → GREEN

- RED command: `node --test --test-isolation=none tests/atom-program-archive-declaration-summary.test.mjs` → 0/1, exit 1. A real memory-authoritative ordinary COW Transform, following a warm write and with a proven archive root, made **602** declaration-path visits to the archive `slot` children (301 children × two comparisons), rather than zero. The accepted write and old-reader/archive-object identity assertions passed before the count failure. This original RED fixture had 300 ordinary archived children plus one Program.
- GREEN focused command on the expanded fixture → 3/3, exit 0. The warm repeated declaration comparison visited **0** archived children and made **0** public parsed-field detach operations. The expanded fixture includes a typed backup root that is also a Program, nested Program, duplicate `thing` fields, and a missing-`thing` parent whose Program descendant has a `[303]` path component. The real validator's compared declaration arrays were captured and checked against literal expected paths, keys, source values and DFS order; old reader and archive identity stayed intact. A separate operation-count RED for accidentally reintroduced public detach was 2 calls; the private descriptor gate returned it to 0.
- Proof tests check exact full topology versus equal joined path text, changed root identity, and a shallow-frozen getter receiving no proof. Existing backup-boundary tests also cover multiple typed roots, active identity collisions, restore and equal-string/different-topology selector resolution.

## Final affected verification

- `node --test --test-isolation=none tests/atom-program-archive-declaration-summary.test.mjs tests/atom-default-backup-active-boundary.test.mjs tests/atom-program-declaration-private-fields.test.mjs tests/atom-agent-program-runtime.test.mjs` → **29/29**, exit 0.
- Selected restore/parallel-rename cases in `tests/atom-rename-sealed-descendants.test.mjs` → **4/4**, exit 0.
- Selected Agent move and delegation-denial cases in `tests/atom-legacy-runtime-composition.test.mjs` → **2/2**, exit 0.
- Selected discard/restore, Program children, explicit archived selection and public Transform/Explore cases in `tests/atom-program-interaction-e2e.test.mjs` → **6/6**, exit 0.
- Real engine memory/old-reader case in `tests/atom-memory-authoritative-interaction.test.mjs` → **1/1**, exit 0.
- Scoped `git diff --check` passed. No full suite, production or real-copy timing was run in this lane.

## Residual cost and limits

The first summary construction still walks the archive once; any cold/unproven or structurally changed archive falls back to a complete walk. Each candidate still walks active nodes and materializes declaration output for the existing equality/relocation logic. This does not accelerate Explore/Transform indexes, Program runtime derivation, legacy manifest scans, public clone boundaries or the exact flat SHA-256 revision; it does not establish end-to-end latency acceptance. Root owns independent review and same-baseline real-copy measurement.
