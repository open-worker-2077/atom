## Purpose

Provide atomic and reversible local world history using exact Patch records while preserving `atom.json` as the sole authoritative state and avoiding per-edit full-world snapshots.

## ADDED Requirements

### Requirement: Local commits record Patch and inverse Patch
Every successful local Transform SHALL record the exact Patch, its inverse Patch, base revision, committed revision, and integrity metadata without storing a complete before/after world snapshot for that edit.

#### Scenario: Successful local commit
- **WHEN** a local Transform commits
- **THEN** the receipt and history record identify the changed paths, forward Patch, inverse Patch, base revision, and committed revision

### Requirement: Local commits are atomic
A local Transform MUST either update the authoritative world and its commit receipt completely or leave the authoritative world unchanged.

#### Scenario: Failure before authoritative replacement
- **WHEN** validation, history preparation, or authoritative replacement fails
- **THEN** no partial fact change is observable and the prior revision remains authoritative

#### Scenario: Restart after committed replacement
- **WHEN** the process restarts after the authoritative replacement but before optional derived publication finishes
- **THEN** the runtime recovers from authoritative state and the committed Patch metadata without accepting a partial second commit

### Requirement: Existing history remains readable
The runtime SHALL preserve read compatibility with existing full-snapshot history while writing new local commits in Patch form.

#### Scenario: Read legacy transaction
- **WHEN** a user inspects or recovers an older transaction containing complete-world snapshots
- **THEN** the runtime reads it without converting or deleting the historical evidence

### Requirement: Interaction history is append-only on the hot path
The steady commit path SHALL append one compact prepared/committed Patch record and SHALL NOT replay or materialize historical receipts to serve an ordinary interaction.

#### Scenario: Commit after a long history
- **WHEN** an ordinary local Transform commits after many historical transactions
- **THEN** its hot-path history work remains proportional to the new Patch and receipt rather than total history length
