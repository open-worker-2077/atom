## Why

Atom has broad unit and subsystem coverage, but delivery still depends on manually stitching together separate acceptance steps. A night-watch mode is needed to prove one ordinary, end-to-end usage path with complete functional coverage and small synthetic data, rather than substituting scale tests or many work orders for workflow completeness.

## What Changes

- Add one operator-facing night-watch command that drives the documented public CLI through a fixed, versioned acceptance manifest against isolated `test` data.
- Keep a separate versioned scenario/case catalog: every required capability names its explicit stable case IDs and each case declares its prerequisites, operation, expected result, rejection, read-back, redacted evidence policy, IssueNode/TestCase mapping, and pending state when live evidence is not yet available.
- Project the approved desensitized `BC-ESG-ACTIVITY-001@v1` contract only into an external application-side catalog: its five synthetic business scenarios belong to Issue #3, while dependent generic mechanism cases belong to Issue #10; no referenced business file or factual baseline enters Atom or the runner.
- Cover service health, Web and private-mobile entry, Agent and Program use, Explore and Transform, authorization and locks, jump, shortcut, slot body, work order, persistence restart, and read-back.
- Emit one machine-readable report with ordered step start/result/duration evidence, the first blocking step, and a resumable checkpoint.
- Stop dependent writes at the first failure, preserve the evidence directory, and never use or publish business-world content.
- Declare success only when every required manifest step passes; test count or data volume cannot replace a missing capability step.
- Generate a redacted GitHub Markdown control graph rooted uniquely at Issue #1 (`https://github.com/open-worker-2077/atom/issues/1`): root Issue → child Issue instance → OpenSpec requirement → test case → latest evidence; delivery gates aggregate only at the root. Stable `IssueNode ID ↔ TestCase ID ↔ Evidence ID` triples are bidirectional; the root renders the full graph and an instance may render a managed backlink block to #1. Each wake-up resumes from its first non-closed node.
- Attach evidence to every control and test-chain node with run id, candidate commit/version, timestamp, scope, redacted command classification, result, and validity; gates are computed only from current, matching, conclusive, bidirectionally mapped evidence.

## Capabilities

### New Capabilities

- `night-watch-acceptance`: Complete low-volume operational acceptance, evidence, failure containment, and resumable execution.

### Modified Capabilities

None.

## Impact

- Adds a package command and acceptance orchestrator under `scripts/`; application-specific journeys remain outside the Atom kernel.
- Reuses existing synthetic Node and Chromium journeys plus an isolated Atom runtime copy; it does not add a second runtime or persistence authority.
- Produces local evidence under an ignored runtime/output location and exposes only redacted summaries suitable for CI or GitHub.
- Extends release acceptance without changing ordinary Atom, CLI, Web, permission, or business-data contracts.
- Treats real-phone acceptance as a separately visible user gate: local private-gateway, mobile viewport/control-panel, and entry-recovery checks can pass independently, while physical-device acceptance remains `pending-user-acceptance`.
