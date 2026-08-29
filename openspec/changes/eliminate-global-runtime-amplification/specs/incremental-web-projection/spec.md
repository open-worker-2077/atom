## Purpose

Keep the Web/Graph scene responsive by updating only domains and relationship endpoints affected by an authoritative Patch while retaining correct refresh and restart behavior.

## ADDED Requirements

### Requirement: Web projection consumes affected paths
After a committed Patch, the Web projection SHALL update the current affected domain and any changed relationship endpoints without rebuilding unrelated domains.

#### Scenario: Detail-only local change
- **WHEN** a committed Patch changes one visible node without changing its path or relationships
- **THEN** the current domain updates that node and unrelated domains are not rebuilt

#### Scenario: Cross-domain relationship change
- **WHEN** a committed Patch changes a relationship whose endpoints occupy different domains
- **THEN** only the endpoint domains and their shared relationship projection are invalidated

### Requirement: Authoritative refresh is preserved
Web projection MUST remain disposable; browser refresh and runtime restart SHALL reconstruct the visible result from `atom.json` and committed derived metadata without treating the projection as fact.

#### Scenario: Refresh after local move
- **WHEN** a node is moved through Web or CLI and the browser is refreshed
- **THEN** the node appears at the committed path and does not return to its previous parent

### Requirement: Projection evidence identifies scope
Each local projection publication SHALL expose enough diagnostic evidence to distinguish affected-domain update from whole-world rebuild.

#### Scenario: Acceptance evidence
- **WHEN** the focused Web projection test runs
- **THEN** its evidence identifies affected domains, unrelated domains skipped, publication revision, and elapsed time
