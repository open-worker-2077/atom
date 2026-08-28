## 1. Authorization Contract Tests

- [x] 1.1 Add a failing contract test proving an Agent whose key satisfies its own node Transform lock can replace its declaration within existing authority.
- [x] 1.2 Add or retain negative tests proving unmatched locks and replacement authority escalation deny atomically without disclosure or mutation.
- [x] 1.3 Add caret-level and exact business-label cases that exercise the same ordinary path matcher for Agent targets.

## 2. Path-Label Authorization

- [x] 2.1 Change the ordinary Transform window boundary so self and descendant Agent targets reach generic path-lock evaluation instead of a current-Agent rejection.
- [x] 2.2 Keep replacement delegation validation before commit and verify failed validation preserves the original registered Agent.
- [x] 2.3 Remove the special management authority contract and update CLI Help to describe ordinary key-to-lock authorization without a separate management channel.

## 3. Acceleration Fallback Tests

- [x] 3.1 Add a failing lifecycle test proving a passive preparation computes from current facts on an acceleration miss and reuses a valid computed result afterward.
- [x] 3.2 Add a failing cold-start test proving normal publications and request availability survive an acceleration persistence failure with a recoverable warning.
- [x] 3.3 Retain or add stale-dependency coverage proving key, lock, or path changes cannot reuse an invalid authoritative result.

## 4. Runtime and Scheduler Fallback

- [x] 4.1 Make scheduler cache misses compute from current facts while preserving valid in-memory, dependency-valid, and persisted fast paths.
- [x] 4.2 Make optional projection persistence failure warning-only after a correct in-memory result exists.
- [x] 4.3 Remove persisted context-free projection availability as a runtime startup, Explore, or Transform gate while preserving genuine computation and fact-validation failures.

## 5. Verification and Delivery

- [x] 5.1 Run focused window-lock, projection lifecycle, legacy runtime composition, and CLI contract tests, then run the adjacent regression suite.
- [x] 5.2 Validate this OpenSpec change strictly and reconcile implementation, tests, Help, and registry metadata with its requirements.
- [ ] 5.3 Deploy the exact verified revision, exercise cold startup with unavailable acceleration persistence plus positive and escalation-negative Agent replacement, and record the evidence on GitHub Issue #13.
