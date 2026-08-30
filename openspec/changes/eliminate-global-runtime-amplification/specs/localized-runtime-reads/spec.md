## Purpose

Ensure that a local Atom read or Transform performs work proportional to its affected path closure instead of silently expanding into unrelated whole-world processing.

## ADDED Requirements

### Requirement: Cold preparation is process-scoped
The 4784 runtime SHALL complete one full authoritative read, validation, revision calculation, and derived-index preparation before reporting ready. A steady CLI or Web interaction MUST consume the retained prepared state and MUST NOT perform whole-world warm-up because a revision changed.

#### Scenario: First CLI request after service readiness
- **WHEN** the runtime has reported ready and the first exact CLI request arrives
- **THEN** the request uses the already prepared path, Agent, lock, Program, support, shortcut, and descendant indexes without a full-world scan

#### Scenario: Startup recovery backup
- **WHEN** the runtime is configured with a private recovery backup
- **THEN** its initial copy/push finishes before 4784 reports ready, and later authoritative writes join the delayed backup window instead of competing with the next CLI interaction

#### Scenario: Windows runtime supervisor priority
- **WHEN** the 4784 runtime is installed or repaired as an Atom-owned Windows scheduled task
- **THEN** it runs at normal scheduler priority so ready-state commits are not throttled below an equivalent foreground runtime

#### Scenario: Unrelated local commit
- **WHEN** a Patch changes an ordinary node outside Agent, lock, Program, trigger, support, shortcut, or descendant-index definitions
- **THEN** those prepared indexes remain valid and only the affected fact/path entries advance

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

### Requirement: One interaction computes and persists each authoritative concern once
A steady Transform SHALL reuse one prepared snapshot and one computed revision through authorization, local validation, Patch history, compare-and-swap, receipt, and in-memory adoption. It MUST NOT reread, reclone, rehash, or rebuild the complete world in multiple layers.

#### Scenario: Ordinary detail replacement work count
- **WHEN** a detail-only Transform commits
- **THEN** diagnostics show zero whole-world warm-ups, zero historical replay, one canonical revision computation, one authoritative `atom.json` replacement, and only affected-index updates

### Requirement: Public CLI entry consumes the resident runtime context
The public interactive CLI SHALL obtain Agent resolution and its entry-context projection from the configured 4784 command endpoint. It MUST NOT reopen or project the backing `atom.json` inside the CLI process after the runtime has accepted the Agent.

#### Scenario: Interactive entry on a versioned compatibility world
- **WHEN** `atom.cmd --agent AGENT` enters an interactive session against a world whose legacy support provenance is authorized only by the resident runtime manifest
- **THEN** the CLI renders the runtime-provided bounded Agent context and reaches its prompt without directly parsing backing facts or requiring a second compatibility authority
