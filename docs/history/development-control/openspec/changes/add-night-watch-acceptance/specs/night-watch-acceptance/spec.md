## Purpose

Provide a complete, low-volume, CLI-driven proof that ordinary Atom usage works across every required delivery capability without embedding application behavior in the runtime kernel.

## ADDED Requirements

### Requirement: Complete manifest coverage
The night-watch mode SHALL execute every capability named by its versioned acceptance manifest and SHALL fail when a required capability is absent, skipped, or inconclusive; data volume and repeated work orders MUST NOT substitute for a missing workflow step.

The manifest SHALL reference a separately versioned external scenario/case catalog. For every required capability, the catalog SHALL name the exact required case IDs rather than derive cases from capability/category templates. Each case SHALL map to an IssueNode and TestCase ID and declare concrete prerequisites, public operation, expected assertion, negative assertion, authoritative read-back, and redacted evidence policy. A missing case, duplicate case ID, incomplete contract, or case belonging to another capability SHALL fail validation before a run. Automated mobile and physical-device cases SHALL remain separate; the latter SHALL stay `pending-user-acceptance` until user evidence exists. An approved desensitized BusinessCase MAY be projected into its own external application-side catalog, but SHALL NOT import the BusinessCase's referenced Excel, factual baseline, or other business files into Atom or the runner.

#### Scenario: One small complete journey passes
- **WHEN** an operator runs night-watch with a compatible healthy Atom service and an authorized test Agent
- **THEN** it executes health, entry, Agent and Program, Explore and Transform, authorization and locks, jump, shortcut, slot body, work order, persistence restart, and read-back steps with small synthetic data

#### Scenario: A required step is missing
- **WHEN** the selected manifest omits or cannot execute one required capability
- **THEN** the run is unsuccessful and identifies that capability as the first incomplete delivery gate

#### Scenario: Catalog contract is incomplete
- **WHEN** a required capability has no declared stable case ID, a duplicated case ID, or a case without concrete precondition, operation, assertion, rejection, read-back, or evidence policy
- **THEN** validation fails closed before adapters or runtime actions execute

#### Scenario: Desensitized ESG BusinessCase is projected
- **WHEN** `BC-ESG-ACTIVITY-001@v1` is accepted as a desensitized application-side contract
- **THEN** its POS-01, REJECT-02, PENDING-03, REMAP-04, and RESUME-05 cases map to Issue #3 with pending evidence, and only dependent Explore/Transform/Program/Form/slot/jump/authorization/cold-start/CLI-Web mechanism cases map to Issue #10

#### Scenario: Pending semantic decision remains a business state
- **WHEN** PENDING-03 returns the precise missing fact `具体审核分工` and does not select a role
- **THEN** Structure, Quantity, and Conservation remain passed, SemanticGate remains `pending`, and the runner does not treat that declared business pending state as a mechanism failure

#### Scenario: BusinessCase resume preserves prior conservation
- **WHEN** RESUME-05 receives only the missing responsibility fact
- **THEN** it recalculates only responsibility relation, icon, and SemanticGate, while source fragments, anchored object, matter chain, and ConservationGate evidence remain unchanged

### Requirement: Public CLI is the usage boundary
The night-watch mode SHALL obtain the current command contract from `atom.cmd --help` and SHALL perform Atom fact reads and writes through the public CLI with one exact authorized Agent context. Application-specific acceptance logic MUST remain in the external manifest or synthetic test Programs and MUST NOT be added to the Atom kernel.

#### Scenario: CLI contract is incompatible
- **WHEN** Help lacks a command or contract required by the manifest
- **THEN** night-watch stops before that operation and reports a CLI contract blocker instead of invoking an internal runtime shortcut

#### Scenario: Application journey changes
- **WHEN** a slot, work-order, or other application journey is revised
- **THEN** its external acceptance step can change without changing the generic Atom authorization, persistence, Program, or Graph kernel

### Requirement: Isolated authorized facts
The night-watch mode SHALL preserve exactly two approved top-level Atoms: `🧊manage` and the default backup warehouse. It SHALL write only uniquely named synthetic facts below the approved `🧊manage/工务/work/test/<run-id>` domain and SHALL require an explicit authority record for shared-runtime writes, synthetic cleanup, service restart, and external GitHub publication.

#### Scenario: Authority is incomplete
- **WHEN** any required live action is outside the recorded authority envelope
- **THEN** night-watch stops before that action and reports the exact missing authorization

#### Scenario: Business facts remain outside scope
- **WHEN** a manifest step needs representative input
- **THEN** it uses synthetic test facts and does not read, copy, modify, or publish ESG, Excel, credentials, or other business-world content

### Requirement: Ordered evidence and resume
The night-watch mode SHALL record each step's identifier, start time, end time, duration, result, redacted evidence, and dependency status in one machine-readable local report. It SHALL stop dependent writes at the first failure and SHALL support resuming from the first unaccepted step after revalidating its prerequisites.

#### Scenario: Mid-run failure
- **WHEN** a step fails or returns an unknown commit state
- **THEN** dependent writes do not run, completed evidence remains intact, and the report identifies the safe resume checkpoint

#### Scenario: Successful completion
- **WHEN** every required step passes and final read-back matches the expected synthetic state after restart
- **THEN** the report declares the manifest version Accepted and contains no business payloads

### Requirement: Normal-use reliability
The night-watch mode SHALL exercise one ordinary end-to-end path, including a bounded service restart and same-entry recovery, and SHALL restore a healthy service before terminating even when the run fails. HTTP health SHALL NOT by itself constitute readiness: the first public Agent command and an exact read-back SHALL also complete. Readiness SHALL preserve required Agent-context lock compilation and SHALL NOT report isolated unrelated Program failures as command results.

#### Scenario: Restart recovery passes
- **WHEN** the persistence phase temporarily restarts the authorized local runtime
- **THEN** the same public entry becomes healthy, the first public Agent command succeeds without unrelated Program execution, the synthetic committed facts remain readable, and the final service state is running

#### Scenario: Health precedes command readiness
- **WHEN** HTTP health is green but the first public Agent command has not yet completed
- **THEN** the restart gate remains pending and no dependent night-watch step starts

#### Scenario: Recovery fails
- **WHEN** the runtime does not recover within the bounded deadline
- **THEN** night-watch records the recovery blocker, attempts the authorized rollback or service start once, and terminates without continuing dependent writes

### Requirement: Issue-rooted delivery control graph
The night-watch mode SHALL generate a redacted GitHub Markdown state graph rooted uniquely at Issue #1 (`https://github.com/open-worker-2077/atom/issues/1`). Concrete Issues such as #10, #13, and #17 SHALL be child Issue instance nodes, not peer roots. Each instance owns its OpenSpec requirements, test cases, and evidence; delivery gates SHALL aggregate only at Issue #1. Every node SHALL use exactly one of `pending`, `passed`, `failed`, `blocked`, `revalidation-required`, or `pending-user-acceptance`. A wake-up SHALL re-read the graph and resume from its first non-closed node. Test totals SHALL NOT replace individual case state.

Evidence attachments MAY exist independently, but SHALL participate only through bidirectional stable triples of `IssueNode ID ↔ TestCase ID ↔ Evidence ID`: an Issue instance lists its test-case and evidence refs, each test case points back to its owning Issue and evidence refs, and every attachment lists both Issue and test-case refs plus a proof statement for each proven node. Root Issue #1 SHALL render the complete graph; any concrete Issue instance MAY render a managed backlink block that points to #1 and lists only its own test cases and evidence. Attachments and mappings SHALL contain run id, candidate commit and version, timestamp, scope, redacted command classification, result, and validity. A delivery gate SHALL be computed from required node states and evidence validity, and SHALL not pass when required evidence is missing, one-sided, expired, version-mismatched, or inconclusive. Unmapped information or attachments SHALL NOT enter night-watch execution context or change the delivery decision.

#### Scenario: Local mobile checks complete before physical-device acceptance
- **WHEN** private gateway, mobile viewport/control-panel, and same-tab entry recovery checks pass locally while physical-device acceptance has not occurred
- **THEN** the local cases are `passed`, the physical-device gate is `pending-user-acceptance`, and independent local delivery checks continue

#### Scenario: Existing Issue is refreshed
- **WHEN** new redacted evidence is generated for the night-watch change
- **THEN** its Markdown state graph updates the existing Issue anchor and does not create a duplicate Issue

#### Scenario: Stale evidence cannot pass a gate
- **WHEN** a required test case is marked passed but its evidence has a mismatched version, expired timestamp, or inconclusive result
- **THEN** its gate is `revalidation-required` and night-watch resumes from that case rather than declaring delivery passed
