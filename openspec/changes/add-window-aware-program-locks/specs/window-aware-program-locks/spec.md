## Purpose

Lets a Program protect Atom content while admitting only explicitly calculated, exact `@agent` window paths, with lock changes published only through an explicit and auditable recomputation request.

## ADDED Requirements

### Requirement: Program locks can admit exact Agent window paths
The system SHALL accept an optional `allowed_windows` object on a Program lock result. `allowed_windows` SHALL contain exactly one `paths` array whose entries are non-empty, unique, exact full Atom paths that resolve to `@agent` Atoms when the lock snapshot is calculated.

#### Scenario: Valid allowed windows are accepted
- **WHEN** a Program emits a lock whose `allowed_windows.paths` contains exact unique paths to existing `@agent` Atoms
- **THEN** the lock result is valid and records those paths in its calculated snapshot

#### Scenario: Invalid allowed windows fail Program evaluation
- **WHEN** `allowed_windows` has unknown keys, a missing or empty `paths` array, duplicate paths, a non-string path, a non-exact path, an unresolved path, or a path to a non-`@agent` Atom
- **THEN** Program evaluation fails with `INVALID_PROGRAM_LOCK_ALLOWED_WINDOWS` and publishes none of that Program evaluation's effects

### Requirement: Lock enforcement compares the resolved interaction window
For a lock with `allowed_windows`, the system SHALL compare the current interaction's already-resolved exact `@agent` path with the snapshot paths before enforcing the lock. A matching window SHALL bypass that lock for its protected operations and fields; a missing or non-matching window SHALL receive the same protection that the lock would apply without an allowlist.

#### Scenario: Allowed window writes a protected field
- **WHEN** an interaction originates from an exact `@agent` path present in `allowed_windows.paths` and writes a field protected by that lock
- **THEN** that lock allows the write to continue through all remaining authorization and transaction checks

#### Scenario: Other window is denied
- **WHEN** an interaction originates from an exact `@agent` path absent from `allowed_windows.paths` and writes a field protected by that lock
- **THEN** the write is denied with `PROGRAM_LOCK_DENIED`, no fact change is committed, and the receipt identifies the source lock without exposing unrelated protected content

#### Scenario: Other window reads a read-protected field
- **WHEN** an interaction originates from an exact `@agent` path absent from `allowed_windows.paths` and reads a field protected by a `read_write` lock
- **THEN** the protected field is truncated according to existing Program lock read behavior

### Requirement: Existing Program locks remain compatible
The system SHALL preserve existing Program lock semantics when `allowed_windows` and request-driven refresh are omitted.

#### Scenario: Legacy lock omits the new fields
- **WHEN** a Program emits a currently valid lock without `allowed_windows` or `refresh`
- **THEN** all interactions continue to receive the lock's existing read or write protection

### Requirement: Request-driven locks use durable calculated snapshots
The system SHALL accept `refresh: {"policy":"on_request"}` on a Program lock. After its first successful explicit calculation, the active snapshot SHALL remain in force across unrelated world revisions, source Program edits, and dependency edits until another explicit calculation for that source Program succeeds.

#### Scenario: Source edit does not replace the active lock
- **WHEN** an active request-driven lock exists and its source Program or an explored dependency changes without an explicit recomputation request
- **THEN** the previously active target paths, fields, mode, protection flags, reasons, and allowed window paths remain in force

#### Scenario: Snapshot survives unrelated writes
- **WHEN** unrelated Atom facts change after a request-driven lock snapshot is active
- **THEN** the active snapshot continues to authorize by stored exact target paths and allowed window paths without depending on revision-scoped Atom refs

### Requirement: Explicit Program execution recomputes request-driven locks
An explicit `.run.` of one exact lock-producing Program SHALL be the public recomputation trigger. A successful run SHALL atomically replace all request-driven lock snapshots owned by that source Program with the complete validated set emitted by that run; a successful run emitting no request-driven locks SHALL remove that source Program's request-driven snapshots.

#### Scenario: Successful recomputation replaces one source atomically
- **WHEN** an Agent explicitly runs one exact Program and the Program completes with a valid request-driven lock set
- **THEN** the new set replaces that Program's prior request-driven snapshots as one atomic publication

#### Scenario: Failed recomputation retains the prior lock
- **WHEN** explicit execution times out, fails, or emits any invalid request-driven lock
- **THEN** all prior request-driven snapshots for that source Program remain active and the failed result publishes no replacement or unlock

#### Scenario: Window move takes effect only after recomputation
- **WHEN** an allowed `@agent` window moves from an old exact path to a new exact path
- **THEN** the old snapshot does not silently recalculate, and after an explicit successful run emits the new path, the new path is allowed while the old path is no longer allowed

### Requirement: Public Help fully describes window-aware locks
CLI Help and the Program function registry SHALL expose the complete lock argument contract, defaults, request-driven refresh policy, exact `.run.` recomputation syntax, validation errors, enforcement result, and `PROGRAM_LOCK_DENIED` failure behavior from the runtime's authoritative contract.

#### Scenario: Application Agent discovers the contract without source inspection
- **WHEN** an Agent reads `atom.cmd --help` and `atom.cmd --program-function-registry`
- **THEN** it can construct, explicitly recompute, and interpret a window-aware lock without guessing an undocumented key or reading implementation files
