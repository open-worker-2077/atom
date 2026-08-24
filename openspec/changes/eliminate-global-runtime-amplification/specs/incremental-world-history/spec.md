## Purpose

Preserve durable recovery and rollback while ensuring that one world transition appends bounded history instead of rewriting all prior transactions.

## ADDED Requirements

### Requirement: New history records are append-oriented
The transaction journal SHALL persist each prepared and committed transition as bounded new data and SHALL NOT rewrite the complete accumulated receipt history for a normal commit.

#### Scenario: Commit after a long history
- **WHEN** a world with many historical receipts commits one new transition
- **THEN** persistence cost is bounded by the new transition and its referenced snapshots rather than total receipt count

### Requirement: World snapshots are content addressed
The journal SHALL reference immutable world snapshots by verified revision and SHALL reuse an existing snapshot object when the same revision is referenced again.

#### Scenario: Before revision already exists
- **WHEN** a new transaction references a previously persisted before revision
- **THEN** the journal reuses that snapshot object rather than writing another complete copy

### Requirement: Recovery and rollback remain durable
Prepared transitions SHALL recover after interruption, and the latest committed transition SHALL remain rollback-capable with the same conflict protections as the existing transaction contract.

#### Scenario: Interruption after prepare
- **WHEN** the process stops after the prepared event and snapshot objects are durable but before the world commit completes
- **THEN** restart recovery completes or safely rejects the transition according to the authoritative revision

#### Scenario: Latest transition is rolled back
- **WHEN** rollback targets the latest compatible committed transition
- **THEN** the journal supplies its verified before snapshot and records the rollback as a new transition

### Requirement: Existing journals remain readable
The runtime SHALL read receipts and recoverable snapshots from the existing monolithic journal while writing new transitions to the incremental format.

#### Scenario: Upgrade with historical receipts
- **WHEN** Atom starts with an existing version-one monolithic transaction journal
- **THEN** historical receipt lookup and supported rollback continue without rewriting that legacy file
