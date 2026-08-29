## Purpose

Select Program, support, authorization, lock, shortcut, and path-rewrite work from maintained reverse dependencies so unrelated runtime behavior cannot amplify a local event.

## ADDED Requirements

### Requirement: Runtime effects are selected by reverse dependency
The runtime SHALL maintain reverse indexes for Program triggers and reads, support endpoints, path and subtree locks, shortcut targets, and descendant paths affected by move or rename.

#### Scenario: Unrelated Programs remain idle
- **WHEN** a local Transform changes a path outside a Program's trigger and read dependencies
- **THEN** that Program is not selected as a candidate and is not executed

#### Scenario: Cross-domain support endpoint is selected
- **WHEN** a local Transform changes one endpoint of a support relationship whose other endpoint is in another domain
- **THEN** both affected endpoints are selected without scanning unrelated relationships or domains

#### Scenario: Ancestor lock is selected
- **WHEN** a Transform targets a descendant governed by an ancestor or subtree lock
- **THEN** the governing lock is selected and evaluated before commit

#### Scenario: Shortcut target changes
- **WHEN** a Transform moves or renames a shortcut target
- **THEN** shortcuts that reference the changed target are selected and updated or rejected according to their contract

### Requirement: Reverse indexes are disposable and incrementally maintained
Reverse indexes MUST remain derived from `atom.json`, SHALL update with each committed Patch, and MUST be safely rebuildable without becoming an authoritative fact source.

#### Scenario: Commit updates dependency entries
- **WHEN** a committed Patch creates, changes, moves, renames, discards, or restores an indexed node
- **THEN** only dependency entries intersecting the Patch are added, removed, or rewritten

#### Scenario: Restart rebuilds derived indexes
- **WHEN** the runtime restarts with missing derived indexes
- **THEN** authoritative behavior is preserved and indexes are rebuilt or locally backfilled without changing facts
