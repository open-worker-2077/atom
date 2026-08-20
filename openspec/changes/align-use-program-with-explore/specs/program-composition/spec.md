## Purpose

让一个 Atom Program 复用另一个 Program 时，直接采用 Explore 已确定的当前世界坐标，并在迁移期间保持既有调用可运行，从而统一游走语义而不破坏正在使用的 Agent。

## ADDED Requirements

### Requirement: Explore result is the authoritative Program target
The system SHALL accept an opaque `ref` obtained from an `explore()` result in the current Program evaluation as the standard `use_program()` target. The standard call SHALL NOT perform its own short-name, path, hierarchy, or partner traversal.

#### Scenario: Invoke an explored Program
- **WHEN** a caller explores one `@program` and passes that result's `ref` to `use_program()` with JSON-compatible runtime input
- **THEN** the selected Program runs once and its JSON-compatible result is returned to the caller

#### Scenario: Invoke without runtime input
- **WHEN** a caller passes a valid explored Program `ref` without runtime input
- **THEN** the selected Program receives an empty input object

### Requirement: Program coordinates remain revision-local and typed
The system SHALL resolve a standard Program call only against the same immutable world revision being evaluated and SHALL require the resolved Atom to have the `@program` type.

#### Scenario: Non-Program result
- **WHEN** a caller passes the `ref` of an explored Atom that is not an `@program`
- **THEN** execution fails explicitly and no effects from a guessed or substituted target are published

#### Scenario: Invalid or foreign result
- **WHEN** a caller passes a missing, stale, or foreign-world `ref`
- **THEN** execution fails explicitly without searching for a replacement by name or path

### Requirement: Legacy name calls remain temporarily compatible
The system SHALL continue to accept the existing `{name, arguments}` `use_program()` form during migration. Legacy target selection SHALL use the same exact selection and ambiguity semantics as Explore rather than an independently defined traversal rule, and Help SHALL identify this form as compatibility-only.

#### Scenario: Existing Agent uses a legacy call
- **WHEN** an existing Program calls `use_program()` with one exact or uniquely resolving legacy name and JSON-compatible arguments
- **THEN** the referenced Program continues to run with the same input and return behavior

#### Scenario: Legacy selector is ambiguous
- **WHEN** a legacy selector matches multiple Programs under Explore semantics
- **THEN** execution reports ambiguity and does not guess, execute, or publish effects for any matching Program

### Requirement: Composition preserves existing execution boundaries
An explored-reference call SHALL preserve the existing JSON-compatible return boundary, shared Program sandbox, recursion rejection, maximum reference depth, effect collection, lock validation, Transform validation, and single central transaction behavior.

#### Scenario: Referenced Program emits effects
- **WHEN** an explored referenced Program returns data and emits allowed effects
- **THEN** its return value reaches the caller and its effects remain part of the caller's existing validated Program result set

#### Scenario: Recursive reference
- **WHEN** an explored referenced Program would call itself directly or indirectly
- **THEN** execution rejects the recursive chain and publishes no partial effects from that failed evaluation
