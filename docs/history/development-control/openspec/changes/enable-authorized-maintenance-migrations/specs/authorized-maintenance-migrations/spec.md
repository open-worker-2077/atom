## Purpose

Provide a narrowly authenticated local recovery and migration path that can atomically repair world hierarchy while leaving every ordinary Agent, Web, and public CLI permission boundary unchanged.

## ADDED Requirements

### Requirement: Token-authenticated maintenance authority
The system SHALL grant trusted-maintenance authority only after the local maintenance token has been validated by a dedicated maintenance entry point. Public CLI, Web, Agent sessions, request payloads, and environment-independent callers MUST NOT be able to request or forge this authority.

#### Scenario: Valid maintenance entry
- **WHEN** the dedicated local maintenance entry validates the configured maintenance token and submits a command
- **THEN** the command executes with trusted-maintenance authority

#### Scenario: Public caller attempts escalation
- **WHEN** an ordinary caller supplies maintenance-like fields or invokes a public command endpoint
- **THEN** the request remains subject to ordinary Agent, Program, and Graph authorization

### Requirement: Atomic authorized hierarchy migration
An explicitly authorized trusted-maintenance Transform SHALL bypass ordinary Agent-window, Program Graph, and slot-structure authorization only for that internal interaction. The migration MUST rebuild Program projections without executing business Program effects as part of the structural transaction. It MUST retain command validation, exact target resolution, collision and cycle rejection, path and relation rewriting, world revision checks, one atomic commit, projection publication, and failure rollback.

#### Scenario: Locked subtree migration succeeds
- **WHEN** a token-authenticated maintenance interaction moves multiple locked subtrees in one valid Transform batch
- **THEN** all moves and dependent path rewrites commit once as one world revision

#### Scenario: One batch item is invalid
- **WHEN** any target, destination, collision, cycle, or revision condition in the maintenance batch is invalid
- **THEN** no item in that batch is persisted

#### Scenario: Existing Program references an old absolute path
- **WHEN** a structural migration changes that path under trusted maintenance
- **THEN** the migration does not replay the business Program as a side effect, commits the valid structure once, and rebuilds the projection against the new world

### Requirement: Ordinary permission behavior remains unchanged
The system SHALL continue to enforce current label, caret, fixed-window, Program lock, and slot-structure rules for all interactions without trusted-maintenance authority.

#### Scenario: Ordinary Agent meets the same lock
- **WHEN** an ordinary Agent attempts the same locked subtree move
- **THEN** the operation is denied with the existing authorization error and the world remains unchanged
