## Purpose

把现有事务回执与 Program 诊断整理成可按 Atom 查询的紧凑运行轨迹，为排错、审计、回读和未来年轮视图提供同一事实来源。

## ADDED Requirements

### Requirement: Mutations have durable Atom-linked receipts
Every committed mutation SHALL retain its time, command and correlation identifiers, source channel, before and after revisions, affected Atom references or paths, affected Graph axes, outcome, and rollback relationship.

#### Scenario: Query one Atom's mutation history
- **WHEN** a caller requests the history of one exact Atom
- **THEN** the system returns only receipts that affected that Atom, ordered deterministically, with links to the authoritative transaction records

### Requirement: Diagnostics are detailed but bounded
Read and Program execution diagnostics SHALL record timing, selected Program identity and version fingerprint, outcome, failure, and affected references for a bounded retention period. They SHALL NOT duplicate unchanged world snapshots or full private detail by default.

#### Scenario: Program fails
- **WHEN** one Program execution fails or times out
- **THEN** its diagnostic record identifies that Program and failure without installing a logger Program on the target Atom or blocking unrelated Programs

### Requirement: Year ring is a projection, not world truth
The per-Atom year ring SHALL be rebuilt from central receipts and diagnostics and SHALL NOT become another writable source of Atom facts.

#### Scenario: Rebuild the year-ring index
- **WHEN** the derived index is absent or stale
- **THEN** it can be reconstructed without changing `atom.json` or the transaction history

### Requirement: Log compaction preserves audit meaning
Compaction SHALL retain durable receipt identity, revisions, affected Atom linkage, outcomes, and the latest safe rollback snapshot while removing redundant old world copies and expired diagnostic detail.

#### Scenario: Repeated high-frequency edits
- **WHEN** many edits affect the same Atom
- **THEN** storage growth remains proportional to compact receipts rather than repeated full-world snapshots
