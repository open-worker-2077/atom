## Purpose

Ensure that local Atom reads remain local, concurrent, and free of persistent projection writes as the authoritative world grows.

## ADDED Requirements

### Requirement: Read-only commands do not publish projections
The runtime SHALL complete an Atom command whose result reports no fact change without writing Graph, spatial knowledge, view-state, or other derived projection persistence.

#### Scenario: Local explore leaves projections untouched
- **WHEN** an Agent executes `explore` and no Program effect changes authoritative facts
- **THEN** the runtime returns the requested Graph-JSON without replacing or persisting a complete projection

### Requirement: Reads use a revision-bound shared snapshot
The runtime SHALL serve reads from one immutable snapshot and its reusable indexes for the current authoritative revision, and SHALL replace that snapshot only after a committed revision change.

#### Scenario: Repeated reads reuse the same revision
- **WHEN** multiple reads occur without an intervening committed write
- **THEN** they use the same revision-bound prepared world rather than rebuilding records and hashes from the complete source for each request

### Requirement: Independent reads are concurrent
The runtime SHALL permit independent read-only interactions against the same immutable revision to execute concurrently while preserving exclusive serialization for commits.

#### Scenario: Two reads do not queue behind each other
- **WHEN** two read-only requests arrive against the same revision
- **THEN** neither request waits for the other request's projection publication or write lock

### Requirement: Projection state remains derived
The runtime SHALL treat complete Graph and spatial scene representations as replaceable derived state and SHALL allow CLI and Web consumers to obtain only the required local view.

#### Scenario: Derived state is missing
- **WHEN** a persisted derived projection is absent or stale
- **THEN** the runtime reconstructs the requested view from authoritative facts without changing those facts
