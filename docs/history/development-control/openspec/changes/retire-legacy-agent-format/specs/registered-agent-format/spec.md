## Purpose

Define one auditable persisted Agent format whose authority can always be reconstructed from current Atom facts, while preserving archived legacy content without treating it as an executable window.

## ADDED Requirements

### Requirement: Agent contexts use registered Program facts
The system SHALL recognize a persisted Atom as an Agent context only when its thing axis contains both `program` and `agent` type markers and its situation contains exactly one valid literal `agent({...})` declaration.

#### Scenario: Registered Agent resolves
- **WHEN** a caller selects an exact `thing@program@agent` whose Program declares one valid literal Agent registration
- **THEN** the system resolves the Agent and reconstructs its labels and function scopes from that declaration

#### Scenario: Pure legacy Agent is rejected
- **WHEN** a caller selects an exact Atom carrying `thing@agent` without the `program` marker and valid registration source
- **THEN** the system rejects the selector with a stable retired-format error and does not create an empty-authority Agent

#### Scenario: Forged marker pair is rejected
- **WHEN** an Atom carries `program` and `agent` markers but its Program has zero, multiple, dynamic, or invalid Agent declarations
- **THEN** cold start and direct Agent resolution reject that Atom as an invalid registered Agent

### Requirement: Deployed legacy Agent facts migrate without data loss
The deployed world migration SHALL leave no pure `thing@agent` facts while preserving every node, situation, containment subtree, and support relation.

#### Scenario: Active legacy Agent is upgraded
- **WHEN** a retained active legacy Agent has an approved label and function-scope contract
- **THEN** one central atomic migration converts it to `thing@program@agent` with a reconstructible literal declaration and preserves its prior prose as non-executing source comments or an explicitly linked fact

#### Scenario: Archived legacy Agent is demoted
- **WHEN** a pure legacy Agent exists only beneath the default backup repository and is not an approved active window
- **THEN** one central atomic migration removes only its `agent` type marker and preserves all other fact content and relations byte-for-byte in meaning

#### Scenario: Migration fails atomically
- **WHEN** any target is ambiguous, missing, concurrently changed, or cannot be projected after preparation
- **THEN** the authoritative world remains at the pre-migration revision and no subset is presented as migrated

### Requirement: Cold start derives authority only from current facts
The system MUST rebuild the Agent directory and Agent security state from valid registered Agent Programs in the current world and MUST NOT use legacy Agent markers or retired sidecars as authority.

#### Scenario: Restart preserves registered authority
- **WHEN** the service restarts after migration
- **THEN** every approved active Agent resolves with the same declared labels and function scopes and ordinary CLI operations use those reconstructed values

#### Scenario: Archived legacy names are not selectable
- **WHEN** a caller supplies the former name or exact path of an archived legacy Agent after migration
- **THEN** the node remains readable as an ordinary fact from an authorized active Agent but cannot be used as the `--agent` context origin

