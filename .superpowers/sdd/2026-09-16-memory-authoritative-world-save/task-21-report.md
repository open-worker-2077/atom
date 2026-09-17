# Task 21 report — private Program declaration fields

Base: `da53e557dc67a77755a1b54f3fd4444fb510f9ce`. Scope: `query-capability.mjs`, `engine.mjs`, one focused test file. All test commands set `$env:ATOM_RUNTIME_BACKUP_REPO=''`; new temporary fixtures were retained. Root-owned plan and ledger were not staged.

## Change and boundary

`programDeclarationSurface` now reads Program key/type/situation metadata through one narrow read-only lookup backed by Task19's existing private Atom field descriptions. Non-Program Atoms produce no detached public field view. The lookup exposes only a frozen object of scalar declaration values; it never returns a Map, parsed metadata, or a mutable fact object. Unsealed/getter input is still parsed afresh. An unusual object-valued situation returns a fallback signal so the previous public-field path retains its behavior. Public `fieldsByBase` and `oneStoredField` remain detached and mutable. No second cache, early seal, disk/schema, revision, authorization, or Program effect change was made.

## RED → GREEN and verification

- RED: `$env:ATOM_RUNTIME_BACKUP_REPO=''; node --test --test-isolation=none tests/atom-program-declaration-private-fields.test.mjs` → 0/1, exit 1. In a real memory-authoritative ordinary Transform with 96 archived ordinary Atoms and one archived Program, `programDeclarationSurface` detached parsed metadata through `structuredClone` **200 times / 49,404 JSON bytes**. The accepted write, old-reader value, and unchanged archive identity assertions passed before the count failure.
- GREEN: same focused command → 4/4, exit 0. The exact journey reports **0 declaration-specific detached metadata operations / 0 bytes**. Additional focused assertions cover frozen internal output, public Map/wrapper/parsed mutation isolation, an unsealed COW node before/after seal, shallow-frozen getter freshness, mutable-object fallback, and literal cold/sealed-COW active-plus-archived declaration order and situation values.
- Directly affected chain, all exit 0:
  - `node --test --test-isolation=none tests/atom-agent-program-runtime.test.mjs` → 8/8 (source/type edits, rejection, dispatch).
  - `--test-name-pattern='discard deactivates nested Program indexes|Program children are data|thing.run cannot select a Program below the typed default backup' tests/atom-program-interaction-e2e.test.mjs` → 3/3.
  - `--test-name-pattern='trusted restore preserves historical authority|trusted restore permits independently authorized declaration changes|atomic sibling name swaps preserve existing descendant Agent declarations|batch rename records external references' tests/atom-rename-sealed-descendants.test.mjs` → 4/4.
  - `--test-name-pattern='an upper Agent window moves a descendant subtree|Agent self-reconfiguration reaches delegation validation' tests/atom-legacy-runtime-composition.test.mjs` → 2/2.
  - `--test-name-pattern='external transform refreshes Python Program|Program transform uses the normal Transform executor|renaming an Agent Program ignores uses on Program data children' tests/atom-program-interaction-e2e.test.mjs` → 3/3 (public Program Transform/Explore and permission journey).
  - `--test-name-pattern='real engine reuses an accepted memory version and preserves old readers through save' tests/atom-memory-authoritative-interaction.test.mjs` → 1/1.

This removes public metadata-copy work inside Program declaration extraction only. `walkAtoms` still traverses the complete world including archived declarations; Explore/Transform preparation, legacy manifest scans, local patch copying, and the exact flat SHA-256 remain. No real-copy latency or E3 completion claim is made; root owns the same-sample benchmark and Task22's separately proven archive declaration summary.
