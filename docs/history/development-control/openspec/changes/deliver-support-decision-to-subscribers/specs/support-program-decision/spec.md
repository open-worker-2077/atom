## ADDED Requirements

### Requirement: True support decisions produce typed deliveries
For each ordinary consequent of a support clause that evaluates to strict boolean `true`, the system SHALL produce one candidate-revision-bound support delivery containing the clause identity, the strict `true` decision, ordinary antecedent paths, and that consequent path. The subscribed action and its source Transform SHALL commit atomically. The system SHALL NOT produce a delivery for `false`, failed, or unevaluated clauses, and SHALL NOT store the boolean on either ordinary Thing.

#### Scenario: True clause produces one delivery per consequent
- **WHEN** one support clause evaluates to strict boolean `true` for one candidate revision and names two ordinary consequents
- **THEN** the system produces two typed deliveries carrying `decision: true`, one for each consequent
- **AND** each delivery identifies the same clause and antecedents but its own consequent

#### Scenario: False clause produces no delivery
- **WHEN** the same clause evaluates to strict boolean `false`
- **THEN** no support delivery is produced
- **AND** neither ordinary endpoint is changed

#### Scenario: One evaluation emits one delivery per consequent
- **WHEN** one evaluation observes the same true clause and consequent through multiple dependency paths
- **THEN** the system exposes only one delivery for that evaluation, clause, and consequent

#### Scenario: Replayed delivery executes one successful subscriber invocation
- **WHEN** sequential or concurrent refreshes expose the same delivery revision, clause, and consequent to the same Program and slot scope
- **THEN** that subscriber executes successfully at most once
- **AND** worker completion alone does not confirm delivery before the central candidate commits
- **AND** any reconcile, effect-application, validation, subscriber, or commit failure releases all candidate claims so a later source retry executes every required action again

#### Scenario: Every claim reaches one terminal state
- **WHEN** a support subscriber succeeds but produces no persistent fact change
- **THEN** the successful interaction boundary confirms the consumed delivery
- **AND WHEN** a context-dependent subscriber result is filtered because no Agent scope exists
- **THEN** the unconsumed delivery is released immediately rather than left pending

### Requirement: Consequent-owned Programs opt into support delivery
A Program SHALL execute from a support delivery only when its own trigger contract explicitly subscribes to the delivery mode and names the ordinary consequent as its target. The invocation SHALL receive the strict boolean and delivery coordinates as Program arguments. Merely being related to, contained by, or named similarly to the consequent SHALL NOT subscribe a Program.

#### Scenario: Exact subscriber receives true
- **WHEN** a true delivery targets one ordinary consequent and that consequent's own action Program explicitly subscribes to support delivery for that path
- **THEN** only that Program runs
- **AND** its invocation arguments contain `decision: true`, clause identity, antecedent paths, consequent path, and revision

#### Scenario: No subscriber means no execution
- **WHEN** a true delivery targets an ordinary consequent with no explicit support subscription
- **THEN** no Program executes

#### Scenario: Related and contained Programs stay idle
- **WHEN** Programs are contained by or related to the consequent but do not explicitly subscribe to its support delivery
- **THEN** those Programs do not execute

### Requirement: Prepared support graphs are revision-bound
The scheduler SHALL reuse a prepared support graph only when a localized Transform identifies the
exact base revision that owns that graph. Structural support edits SHALL project the candidate graph
and cache it only under the candidate revision; no refresh SHALL consume a graph from another
revision merely because a prepared-index flag is present.

#### Scenario: Structural edit followed by localized fact edit
- **WHEN** one committed structural edit replaces, moves, adds, or removes a support clause
- **AND** a later situation-only Transform names that committed revision as its base
- **THEN** support selection uses only the clauses and paths from that exact base revision
- **AND** no deleted or superseded clause is evaluated

## MODIFIED Requirements

### Requirement: Support evaluation does not execute consequents
Evaluating a support condition SHALL NOT directly execute the ordinary consequent or any Program referenced as, contained by, or otherwise associated with the consequent side. After evaluation and before candidate commit, a typed true delivery MAY invoke only a consequent-owned Program that independently declared an exact support trigger; that invocation is subscriber execution, not implicit consequent execution.

#### Scenario: Consequent execution remains absent
- **WHEN** the selected support-decision Program returns either `false` or `true` and no consequent-owned Program explicitly subscribes
- **THEN** the ordinary consequent is not executed
- **AND** no consequent-side Program is invoked as a consequence of support evaluation

#### Scenario: Explicit subscription remains separate from evaluation
- **WHEN** the selected support-decision Program returns `true` and one consequent-owned Program explicitly subscribes to that consequent's typed support delivery
- **THEN** support evaluation completes without executing the subscriber
- **AND** the candidate delivery invokes only that subscriber with the typed decision arguments before the source Transform commits
