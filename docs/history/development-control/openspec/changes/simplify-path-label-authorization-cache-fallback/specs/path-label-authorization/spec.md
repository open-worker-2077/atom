## Purpose

Defines the user-visible authorization contract in which Agent key labels satisfy applicable Graph lock labels consistently for every protected operation.

## ADDED Requirements

### Requirement: Actual-path label authorization
The system SHALL make Explore and Transform authorization outcomes reflect the current Agent's key labels and every applicable contain and node lock label. All applicable locks SHALL be satisfied for the action to proceed, regardless of whether the implementation evaluates them on demand or through an equivalent acceleration structure.

#### Scenario: Matching keys authorize a path
- **WHEN** the current Agent's key labels satisfy every contain and target-node lock applicable to the requested action
- **THEN** the system permits the action without consulting a separate management authority

#### Scenario: A missing key denies without disclosure or mutation
- **WHEN** at least one applicable path lock requires a label the current Agent does not hold
- **THEN** the system denies the action before revealing protected content or committing a mutation

### Requirement: Caret labels compare by jurisdiction level
The system SHALL treat a caret-only key as a jurisdiction level and SHALL satisfy a caret-only lock when the held caret count is greater than or equal to the required caret count. Business labels SHALL match by exact label value.

#### Scenario: Higher jurisdiction opens a lower lock
- **WHEN** an Agent with key `^^` reaches a node whose applicable lock requires `^`
- **THEN** the caret lock is satisfied

#### Scenario: Lower jurisdiction cannot open a higher lock
- **WHEN** an Agent with key `^` reaches a node whose applicable lock requires `^^`
- **THEN** the system denies the protected action

### Requirement: Agent reconfiguration uses the ordinary authorization path
The system SHALL apply ordinary Transform path-label authorization when replacing a registered Agent Program's situation. It SHALL NOT reject the Transform solely because the target is the current Agent, and it SHALL NOT require a separate daily-management or maintenance channel.

#### Scenario: Agent modifies itself through its node lock
- **WHEN** the current Agent's keys satisfy its own Agent-node Transform lock and the replacement declaration stays within its existing authority
- **THEN** the system atomically replaces the Agent Program situation and rebuilds its effective registration

#### Scenario: Reconfiguration cannot escalate authority
- **WHEN** a replacement Agent declaration requests a jurisdiction level, business label, function group, or function name outside the caller's current authority
- **THEN** the system rejects the entire Transform and preserves the original Agent Program
