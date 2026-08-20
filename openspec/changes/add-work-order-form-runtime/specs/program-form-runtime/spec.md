## Purpose

让 Program 通过受保护的统一契约定义、生成和运行 Graph 原生单子，同时保持 Atom 的既有语法、事务边界和跨层关系能力。

## ADDED Requirements

### Requirement: Form definition remains native Atom Graph
The system SHALL accept a form definition only as ordinary `name`, `detail`, `children`, and `partners` content invoked from an executable Program, and SHALL NOT persist a parallel `fields`, `form`, or table-only hierarchy.

#### Scenario: Compile a form definition
- **WHEN** a Program invokes the form capability with a valid Graph-JSON definition
- **THEN** the generated instance is readable and editable as an ordinary Atom subtree with unchanged Graph semantics

#### Scenario: Reject conflicting structure
- **WHEN** a definition introduces a second hierarchy that conflicts with `children`
- **THEN** the operation fails before any world fact is committed

### Requirement: Instance creation is versioned and idempotent
The system SHALL create a complete instance from one exact template version, record the template identity and version, and SHALL NOT duplicate an already-created instance when the same creation identity is replayed.

#### Scenario: Replay instance creation
- **WHEN** the same creation identity is submitted twice
- **THEN** only one complete instance exists and both calls return a determinate receipt

### Requirement: Child Programs are autonomous but composable
Each executable child SHALL evaluate its own local rules and report a structured outcome. Programs SHALL be allowed to read explicitly selected siblings, ancestors, descendants, and partner targets within the interaction scope.

#### Scenario: Criteria reads Step through an explicit relation
- **WHEN** a Criteria Program selects its sibling Step by exact path or explicit partner relation
- **THEN** it receives the selected immutable facts and reports its own validation result

#### Scenario: Ambiguous short reference
- **WHEN** a Program uses a short reference that resolves to multiple Atoms
- **THEN** execution fails with an ambiguity result and commits no guessed target

### Requirement: Form actions use the existing transaction boundary
All create, fill, validate, submit, reject, and revise actions SHALL produce existing Atom intents, validation, revision checks, and receipts. A stale or conflicting action SHALL NOT silently overwrite a newer value.

#### Scenario: Concurrent edits target one value
- **WHEN** two actions are based on the same old world revision
- **THEN** at most one commits and the other receives a revision conflict
