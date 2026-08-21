## Purpose

为使用方 `@program` 提供可判定、可回滚并与 Graph 持久化契约一致的 Transform 效果，同时确保备份中的历史 Program 不影响活动世界运行。

## ADDED Requirements

### Requirement: Program Transform shall distinguish creation from update without a second Graph syntax
The runtime SHALL interpret a Program `transform(spec)` effect as creation only when `spec` contains one persistent field for each Graph base axis `name`, `detail`, `children`, and `partners`, and contains no dot-command field. Every other valid Program Transform specification SHALL retain the existing update interpretation.

#### Scenario: Complete persistent Atom becomes a creation effect
- **WHEN** an active Program calls `transform()` with all four persistent Graph axes and no dot command
- **THEN** the runtime treats the effect as creation rather than attempting to select an existing Atom

#### Scenario: Dot-command Transform remains an update effect
- **WHEN** an active Program calls `transform()` with an exact selector and a supported dot command such as `detail.rep.`
- **THEN** the runtime applies the existing update contract without requiring four persistent axes

#### Scenario: Partial plain axes do not silently create
- **WHEN** a Program Transform contains plain persistent fields but not all four Graph axes
- **THEN** the runtime does not infer creation and validates it under the existing update contract

### Requirement: Program creation shall use the authoritative Atom creation contract
Program-originated creation SHALL enforce the same complete-axis validation, exact parent resolution, duplicate-name rejection, access control, Program validation, Graph projection validation, revision check, and central transaction boundary as external `transform new`.

#### Scenario: Create a nested Atom
- **WHEN** a Program emits a valid complete four-axis Atom whose exact parent exists and whose exact target does not exist
- **THEN** the new Atom is committed beneath that parent and is observable through a subsequent exact `explore`

#### Scenario: Reject a missing parent
- **WHEN** a Program emits a valid complete four-axis Atom whose exact parent path does not exist
- **THEN** no Atom is created and the interaction reports a Program Transform rejection whose cause identifies the missing parent

#### Scenario: Reject a duplicate exact target
- **WHEN** a Program emits a valid complete four-axis Atom whose exact target already exists
- **THEN** the existing Atom is not overwritten and the interaction reports a Program Transform rejection whose cause identifies the duplicate name

#### Scenario: Commit Program creation and triggering interaction together
- **WHEN** a Program creation effect and its triggering world interaction change the authoritative world
- **THEN** the resulting world is persisted through one revision-checked central commit and no partial creation is exposed

### Requirement: Program Transform shall remain an effect declaration
`transform(spec)` SHALL return `None` to the executing Program because the requested effect is compiled, authorized, reconciled, and committed only after Program evaluation. Callers SHALL confirm committed creation from the interaction receipt or a subsequent exact read.

#### Scenario: Assignment observes no premature result
- **WHEN** Program code assigns the value returned by `transform(spec)`
- **THEN** the assigned value is `None` and is not presented as proof that the effect committed

### Requirement: Programs in the default backup subtree shall be inactive
The runtime SHALL exclude every `@program` located at or below the unique `name@backup@default` Atom from the executable Program set. Exclusion SHALL affect Program evaluation and all effects while preserving the backed-up facts for read and restore operations.

#### Scenario: Backed-up Program does not execute
- **WHEN** a world contains an active Program and a Program below the default backup Atom
- **THEN** only the active Program is evaluated and only its messages, choices, locks, and Transform effects enter the interaction

#### Scenario: Nested backed-up Program does not consume runtime budget
- **WHEN** a non-terminating or otherwise slow Program is nested anywhere below the default backup Atom
- **THEN** it is not started and cannot cause a Program timeout for an ordinary activity-world interaction

#### Scenario: Restored Program becomes active again
- **WHEN** a backed-up Program is restored outside the default backup subtree
- **THEN** it becomes eligible for evaluation under the same rules as any other active Program

### Requirement: Help shall expose the Program Transform contract
Human-readable Help SHALL state the creation discriminator, update compatibility, deferred-effect return value, and read-back requirement. The public Program function registry SHALL expose equivalent structured Transform contract metadata without requiring an Agent context.

#### Scenario: Agent discovers creation syntax from Help
- **WHEN** an Agent reads Atom CLI Help
- **THEN** it can construct a valid Program creation effect without inferring undocumented parameters

#### Scenario: Tooling reads structured Transform metadata
- **WHEN** tooling reads the public Program function registry
- **THEN** the `transform` entry distinguishes create and update forms and identifies the deferred `None` result
