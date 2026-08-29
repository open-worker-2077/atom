## Why

Atom currently amplifies small local reads and transforms into unrelated whole-world parsing, cloning, hashing, Program scanning, history snapshots, and Web projection. This makes ordinary local operations take tens of seconds despite no matching business Program executing, so the local product cannot remain in Delivered state.

## What Changes

- Establish an affected-path closure for every read and Transform and carry it through authorization, Program selection, persistence, history, and projection.
- Maintain disposable reverse indexes for Program dependencies and triggers, support endpoints, locks, shortcuts, and descendant path rewrites; missing entries may be backfilled from the local closure only.
- Persist local Transform commits atomically as Patch/inverse Patch history while keeping `atom.json` as the sole authoritative fact source.
- Invalidate derived state by affected paths rather than by treating every revision change as a whole-world invalidation.
- Update only the affected Web domain and related endpoints, while retaining authoritative refresh and restart behavior.
- Add focused correctness, rollback, work-count, and shared-local-world latency evidence mapped to GitHub Issue #29.

## Capabilities

### New Capabilities

- `localized-runtime-reads`: Runtime reads and transforms operate on an explicit affected-path closure without unrelated whole-world fallback.
- `event-indexed-program-runtime`: Program, support, lock, shortcut, and descendant-path dependencies are selected through incrementally maintained reverse indexes.
- `incremental-world-history`: Atomic local commits emit Patch/inverse Patch history and recover without per-edit complete-world before/after snapshots.
- `incremental-web-projection`: Web read models update only affected domains and relationship endpoints while `atom.json` remains authoritative.

### Modified Capabilities

None.

## Impact

- Runtime language engine and context cache.
- Program dependency selection, permission/lock evaluation, support and shortcut resolution.
- JSON world repository, commit coordinator, revision invalidation, and transaction history compatibility.
- Graph/Web projection pipeline and current-domain cache publication.
- Focused tests, performance diagnostics, acceptance evidence, and GitHub Issue #1/#29 status.
