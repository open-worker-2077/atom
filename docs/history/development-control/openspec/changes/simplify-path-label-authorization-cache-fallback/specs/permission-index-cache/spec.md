## Purpose

Defines correctness and availability boundaries for any internal permission acceleration mechanism without prescribing one mandatory algorithm or data structure.

## ADDED Requirements

### Requirement: Authorization acceleration remains derived
The implementation MAY use on-demand evaluation, precomputation, dependency indexes, caches, or a combination. Any accelerated result SHALL remain derived from current Agent declarations, key labels, lock declarations, and Graph paths.

#### Scenario: Relevant fact change cannot leave an authoritative stale result
- **WHEN** an Agent key, applicable lock, or path segment changes
- **THEN** subsequent authorization reflects the new facts without requiring a full-world permission rebuild

### Requirement: Accelerated and non-accelerated results are equivalent
When the implementation uses an acceleration structure, its authorization result SHALL be equivalent to evaluation from current Agent and Graph facts. Missing, incomplete, stale, or unreadable acceleration state SHALL fall back to a correct available evaluation path.

#### Scenario: Valid acceleration serves the request
- **WHEN** valid accelerated state covers the current Agent, action, target, and relevant dependencies
- **THEN** the system may use that accelerated result

#### Scenario: Acceleration miss uses an available correct path
- **WHEN** no valid accelerated state exists for a request
- **THEN** the system evaluates from current facts or another equivalent source and returns the same authorization outcome

### Requirement: Permission acceleration is never an authority or availability gate
The system SHALL NOT reject runtime initialization, Explore, or Transform solely because a permission or Program projection acceleration artifact is absent, stale, unreadable, or cannot be persisted. Acceleration failures MAY produce an operational warning but MUST use another correct evaluation path.

#### Scenario: Cold startup without a persisted cache
- **WHEN** the runtime starts with current Atom facts and no consumable persisted permission index
- **THEN** the runtime becomes available using computed in-memory authorization and may rebuild the disposable index

#### Scenario: Persistence failure does not block service
- **WHEN** current permission results are computed but the disposable index cannot be saved
- **THEN** the runtime publishes its normal projections, serves requests from current facts or memory, and reports only a recoverable warning

### Requirement: Context-free preparation isolates Program-local failures
The runtime SHALL NOT require every Program to produce a context-free result before the world becomes available. A Program that cannot run without request context or whose own facts fail validation SHALL remain unavailable and explicitly reported without preventing valid current facts and other derived results from being published. Invoking that Program SHALL still enforce its normal execution and validation failures.

#### Scenario: One Program cannot form a context-free projection
- **WHEN** cold-start preparation encounters a Program-local context or fact-validation failure
- **THEN** the runtime publishes the world and reports that Program as unavailable without treating its failed result as authoritative
