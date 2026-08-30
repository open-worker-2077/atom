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
