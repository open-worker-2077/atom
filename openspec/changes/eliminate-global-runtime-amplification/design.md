## Context

See `proposal.md` for motivation. The current 4784 path rereads a roughly 15 MB authoritative JSON world, rebuilds Program records and hashes, and then replaces a roughly 16 MB spatial store after every command. Transaction persistence rewrites a roughly 53 MB legacy journal at prepare and commit. Existing CLI, Web, Program, recovery, and rollback contracts must remain usable during migration.

## Goals / Non-Goals

**Goals:**

- Bind reusable world, query, Program, and projection indexes to one authoritative revision.
- Make unchanged reads free of projection writes and allow them to overlap safely.
- Persist future transactions as compact append events referencing immutable compressed snapshot objects.
- Preserve legacy files as readable compatibility inputs and make rollback safe across the boundary.

**Non-Goals:**

- Redefining Atom language, Graph-JSON, trigger syntax, or user-visible work-order behavior.
- Implementing the future semantic XYZ projection language in this change.
- Deleting legacy projection or journal files.

## Decisions

### Revision snapshot owned by the runtime composition

The service will cache the authoritative facts, revision, prepared query world, Program records, and derived projection input together. A successful commit invalidates and replaces the bundle; reads never mutate it. This is preferred over scattered module caches because a single revision boundary prevents stale combinations.

### Read/write scheduling by intent

The server will stop placing all `/__atom/api/command` traffic on one tail. Read-only commands run against the immutable current bundle; mutating commands and recovery remain serialized. A read that discovers a required Program reconciliation is promoted through the write path rather than mutating from the read lane.

### Publish only committed changes

Projection replacement and subscriber publication occur only when a command reports an authoritative or explicitly identified view-state change. Existing projection adapters remain available, but unchanged CLI reads do not load or rewrite their complete files.

### Incremental journal beside the legacy journal

Future transactions use a sibling journal directory containing an append-only event log and immutable gzip-compressed snapshot objects named by revision. The repository reads new events first and falls back to the untouched legacy JSON journal for historical lookups. This avoids an irreversible in-place migration and provides a simple rollback to the old code.

### Program indexes live in the revision bundle

Program records and trigger contracts are prepared once per revision. Indexed events select candidate Program paths before Python execution. Effect application shares one exact-selector index and produces one projection/commit at the end of the accepted set.

## Risks / Trade-offs

- **Concurrent reads expose hidden mutation** → Freeze shared snapshots at module boundaries and promote reconciliation to the serialized lane.
- **Append interruption leaves a partial final line** → Validate newline-delimited events, ignore only an incomplete trailing event, and fsync before acknowledging prepare/commit.
- **Snapshot objects increase disk usage** → Gzip and content-address them; reuse revisions and retain them because rollback/recovery depends on them. Garbage collection is deliberately separate.
- **Legacy and incremental histories disagree** → New-format command IDs take precedence; duplicate IDs with different receipts fail closed.
- **Large architectural change regresses consumers** → Land behind unchanged public interfaces with focused CLI, Web, restart, rollback, and performance tests.

## Migration Plan

1. Deploy dual-read transaction repository and create incremental storage only on the first new write.
2. Deploy revision caching and change-driven projection publication while retaining legacy projection generation after commits.
3. Enable concurrent read scheduling after read paths prove immutable.
4. Verify restart recovery and rollback across legacy and new-format receipts.
5. Keep legacy files recoverable; rollback is the previous binary plus untouched legacy inputs.
