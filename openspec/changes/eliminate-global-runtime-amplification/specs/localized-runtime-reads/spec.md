## Purpose

Ensure that a local Atom read or Transform performs work proportional to its affected path closure instead of silently expanding into unrelated whole-world processing.

## ADDED Requirements

### Requirement: Local operations expose an affected closure
The runtime SHALL derive an affected-path closure from the requested path, operation, ancestors required for authorization, descendants changed by path mutation, and relationship endpoints whose observable result can change.

#### Scenario: Local detail replacement
- **WHEN** a Transform replaces the detail of one node
- **THEN** the affected closure contains that node and only the ancestors or relationship endpoints required to validate and publish the change

#### Scenario: Descendant path mutation
- **WHEN** a Transform moves or renames a node with descendants
- **THEN** the affected closure contains the old and new descendant paths without including unrelated sibling subtrees

### Requirement: Missing derived state does not authorize global fallback
When an index or cache required by a local operation is absent or stale, the runtime MUST compute the missing information from the affected closure and backfill the derived state without scanning unrelated domains.

#### Scenario: Cold local index entry
- **WHEN** the requested path has no current derived index entry
- **THEN** the runtime completes the operation from authoritative local facts, backfills the entry, and does not perform a whole-world fallback

### Requirement: Local operation latency is bounded on the acceptance world
Steady exact Explore and each local `.rep/.ren/.mov/.dsc/.rst` Transform SHALL complete in less than five seconds on the shared local acceptance world.

#### Scenario: Focused local acceptance run
- **WHEN** the acceptance chain executes each supported local operation against its isolated test path
- **THEN** every measured operation completes in less than five seconds and reports its affected closure
