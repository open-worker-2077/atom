## 1. Boundary contract and RED baseline

- [x] 1.1 Add failing query tests for updated up/down/left/right boundary counts, character estimates and re-anchoring.
- [x] 1.2 Add failing access tests proving protected continuation is not reported as zero and does not expose exact counts or content.
- [x] 1.3 Add failing CLI and Program compatibility tests for `boundary~preview` projection and the unchanged Program Atom-view list.

## 2. Shared query implementation

- [x] 2.1 Compute unreturned directional candidates from the exact anchor and selected coordinate scope.
- [x] 2.2 Produce complete or protected direction summaries using field-level access checks and Program-source character exclusion.
- [x] 2.3 Attach the boundary to the shared Explore item and render it through CLI Graph-JSON without altering matched Atom data.

## 3. Operational contract and delivery

- [x] 3.1 Update CLI Help and runtime documentation so every Explore movement reports a refreshed boundary owned by Explore.
- [x] 3.2 Run focused query, access, CLI, Program and performance tests plus strict OpenSpec validation.
- [x] 3.3 Run GitNexus impact/change checks, review scope and data safety, and commit only change-owned files.
