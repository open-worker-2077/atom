## Purpose

Make Program work proportional to the transformed nodes and matched trigger contracts while preserving explicit execution and compatibility behavior.

## ADDED Requirements

### Requirement: Unmatched events do not execute Programs
For an indexed transform event, the runtime SHALL execute only Programs whose declared trigger contract matches an affected node, plus any explicitly requested Program.

#### Scenario: One of many nodes changes
- **WHEN** a transform affects one node monitored by one Program
- **THEN** only that Program is eligible for triggered computation and unrelated Programs emit no effects

### Requirement: Program preparation is revision shared
Program selection, paths, references, and dependency indexes SHALL reuse the current revision-bound world preparation rather than reconstructing and hashing the complete world separately for each read or Program.

#### Scenario: Cached read with active Programs
- **WHEN** a read occurs without a revision change
- **THEN** Program lock and trigger state is obtained from the current prepared revision without launching Python workers or rebuilding complete records

### Requirement: One matched effect set uses one prepared revision
All effects emitted by one Program cycle SHALL be validated and applied against one prepared revision, with structural indexes rebuilt only when an accepted structural effect requires it.

#### Scenario: Program emits many field updates
- **WHEN** a matched Program emits multiple non-structural updates
- **THEN** the runtime applies them as one bounded effect set without cloning or projecting the complete world per update

### Requirement: Explicit execution remains available
Trigger indexing SHALL NOT prevent an explicit `.run.` request from executing its uniquely selected Program under the existing timeout and safety contract.

#### Scenario: Agent explicitly runs an untriggered Program
- **WHEN** the Agent submits a valid `.run.` request
- **THEN** the selected Program executes even when no transform trigger matched
