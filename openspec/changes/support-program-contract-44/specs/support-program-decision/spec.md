## Purpose

Defines how an independent Program referenced by a support condition decides an ordinary Thing-to-Thing support relation without becoming either endpoint or causing unrelated execution.

## ADDED Requirements

### Requirement: Support decision roles remain distinct
The system SHALL distinguish the ordinary antecedent Thing, the independent `thing@program` support-decision Program referenced by that antecedent's support condition, and the ordinary consequent Thing. The ordinary antecedent SHALL remain the support relation's antecedent and SHALL NOT be evaluated, defaulted, or recorded as a boolean operand; only the referenced support-decision Program SHALL provide the boolean decision and appear in the decision trace.

#### Scenario: Synthetic three-role support clause
- **WHEN** an ordinary antecedent Thing declares `if@current: true`, references one independent `thing@program` in the same condition, and names an ordinary consequent Thing
- **THEN** the system treats the ordinary antecedent, support-decision Program, and ordinary consequent as three distinct roles
- **AND** it obtains the boolean decision only from the support-decision Program
- **AND** the decision trace contains the support-decision Program but not the ordinary antecedent

#### Scenario: Static support has no boolean producer
- **WHEN** a valid support clause contains only ordinary antecedent and consequent Things and references no support-decision Program
- **THEN** the clause is unconditionally established without querying Thing existence as a boolean
- **AND** its decision trace is empty

#### Scenario: Decision Program cannot own the current support endpoint
- **WHEN** a `thing@program` node attempts to declare itself as the current antecedent or current consequent of the same support rule
- **THEN** Graph rejects the rule with `SUPPORT_DECISION_PROGRAM_MUST_BE_INDEPENDENT`
- **AND** the rule must instead be owned by an ordinary fact endpoint and reference the independent Program only inside `if`

#### Scenario: Program-only condition cannot replace the ordinary fact antecedent
- **WHEN** a rule targets an ordinary current consequent but its `if` expression contains only `thing@program` selectors
- **THEN** Graph rejects the rule with `SUPPORT_FACT_ANTECEDENT_REQUIRED`
- **AND** the owner must add at least one ordinary fact antecedent while keeping each Program only as a decision dependency

#### Scenario: Decision Program cannot replace an ordinary consequent
- **WHEN** a rule names a `thing@program` selector in `then`
- **THEN** Graph rejects the rule with `SUPPORT_FACT_CONSEQUENT_REQUIRED`
- **AND** the rule must name an ordinary consequent Thing while keeping the Program only inside `if` as a decision dependency

### Requirement: Boolean decision gates support establishment
The system SHALL establish the declared ordinary Thing-to-Thing support only when the referenced support-decision Program returns strict boolean `true`. It SHALL leave the support unestablished when that Program returns strict boolean `false`, and SHALL reject a non-boolean result.

#### Scenario: False decision with ordinary antecedent present
- **WHEN** the ordinary antecedent and consequent exist and the support-decision Program returns `false`
- **THEN** the declared support is not established

#### Scenario: True decision with ordinary antecedent present
- **WHEN** the same synthetic relation is evaluated and the support-decision Program returns `true`
- **THEN** the declared support is established from the ordinary antecedent to the ordinary consequent

#### Scenario: Non-boolean decision
- **WHEN** the support-decision Program returns a value other than strict boolean `true` or `false`
- **THEN** evaluation fails with `INVALID_PROGRAM_SUPPORT_RESULT`

### Requirement: Changed-path evaluation is local
When a Transform reports the ordinary antecedent in `changedPaths`, the system SHALL reevaluate only support clauses indexed by that changed path. Within the selected clause, it SHALL execute only the referenced support-decision Program needed to obtain the decision.

#### Scenario: Antecedent Transform selects one decision
- **WHEN** a synthetic graph contains the three-role relation plus unrelated support clauses and Programs, and a Transform reports only the ordinary antecedent path as changed
- **THEN** only the support clause owned by that antecedent is reevaluated
- **AND** only its referenced support-decision Program is invoked

### Requirement: Support evaluation does not execute consequents
Evaluating a support condition SHALL NOT implicitly execute the ordinary consequent or any Program referenced as, contained by, or otherwise associated with the consequent side.

#### Scenario: Consequent execution remains absent
- **WHEN** the selected support-decision Program returns either `false` or `true`
- **THEN** the ordinary consequent is not executed
- **AND** no consequent-side Program is invoked as a consequence of support evaluation

### Requirement: Support decisions are effect free
A support-decision Program SHALL be evaluated in a mode that forbids externally observable Program effects. If it attempts any effect, the system SHALL reject the decision and SHALL preserve the evaluated world unchanged.

#### Scenario: Decision Program attempts a Transform
- **WHEN** a support-decision Program attempts to mutate a Thing and then returns `true`
- **THEN** evaluation fails with `PROGRAM_SUPPORT_EFFECT_FORBIDDEN`
- **AND** the target Thing retains its pre-evaluation state

### Requirement: Archived support is preserved but inactive
The system SHALL preserve support declarations stored below the typed default backup subtree as recoverable Atom facts, but SHALL exclude those declarations from the active Graph projection, validation, indexing, and Program execution. When an archived subtree is restored outside the typed default backup, its support declarations SHALL re-enter normal active validation before use.

#### Scenario: Legacy support remains recoverable in the default backup
- **WHEN** a typed default backup contains a support declaration that is invalid under the current active support contract
- **THEN** Atom context projection preserves the archived Thing and its original support declaration in the authoritative Atom facts
- **AND** the active Graph receives no support clause from that archived subtree
- **AND** the archived declaration cannot block cold start or execute a Program

#### Scenario: Restored support returns to active validation
- **WHEN** the archived subtree is restored outside the typed default backup
- **THEN** its support declaration is projected and validated under the current active support contract before it can participate in Graph or Program execution

### Requirement: Slot model revision and reseal are one bounded Program transaction
The system SHALL allow a Program to transform mapped nodes under one slot model only when that same Program seals that exact slot body in the same central transaction. It SHALL keep direct model edits locked, SHALL NOT transfer the capability across Programs or slot bodies, and SHALL roll back the complete transaction if reseal fails.

#### Scenario: Same Program revises and reseals one model
- **WHEN** one Program transforms a mapped model node and emits `slot_body(action=seal)` for that exact body
- **THEN** the model revision and every derived instance update commit atomically
- **AND** unmapped instance-local material remains byte-for-byte unchanged

#### Scenario: Direct or cross-body revision remains denied
- **WHEN** a caller directly transforms a mapped model node, or a Program transforms one model while sealing another body
- **THEN** the structure lock rejects the model transform
- **AND** no partial model or instance revision is committed
