## 1. Contracts and authority

- [x] 1.1 Add a versioned night-watch capability manifest plus external explicit scenario/case catalog, with fail-closed validation tests for required case IDs, coverage, dependency order, and cycles.
- [x] 1.2 Add a bounded authority receipt schema covering exact Agent, test domain, synthetic cleanup, restart, GitHub publication, expiry, and unattended execution.
- [x] 1.3 Add redaction tests proving reports exclude command bodies, Program source, business facts, credentials, and unapproved identities.
- [x] 1.4 Add an Issue-rooted, redacted GitHub Markdown status-graph generator with per-case state validation, stable IssueNode/TestCase/Evidence triples, managed backlinks, and first-open-node selection.
- [x] 1.5 Attach bidirectionally mapped typed evidence to every status-graph node and compute delivery gates fail-closed from node status and evidence validity.

## 2. Runner and evidence

- [x] 2.1 Add the external night-watch runner with dry-run, ordered execution, per-step timing, first-blocker containment, and `finally` service recovery.
- [x] 2.2 Add append-safe local report/checkpoint persistence and prerequisite revalidation for resume.
- [x] 2.3 Expose a package command and document authority receipt creation, dry-run, live run, resume, and rollback.

## 3. CLI-driven complete journey

- [x] 3.1 Read and validate `atom.cmd --help`, resolve one exact approved test Agent, and execute CLI commands through stdin without internal runtime imports.
- [ ] 3.2 Implement small synthetic CLI steps for Program, Explore/Transform, path-label authorization and locks, jump, shortcut, slot body, and work order; keep approved BusinessCase scenarios as external pending application-side cases until their live adapters and evidence exist.
- [ ] 3.3 Verify persistence with an authorized bounded runtime restart and exact CLI read-back, restoring service health on every exit path.

  - Local checkpoint (not complete): `TC-ESG-ACTIVITY-001-POS-01` resumed from exact-read committed state only. After a bounded 4784 task restart loaded the candidate, the missing temporary `^` result lock compiled through the live exact-path resolver and ran without replaying the deterministic Program or receipt. Final result exact-read preserved all six deterministic fields; Structure/Quantity/Conservation/Semantic gates passed. Evidence is local candidate `0.3.0`, run `nw-pos01-20260829-1750`, commit binding pending. Issue #1 now maps the five closed synthetic business scenarios `POS` / `REJECT` / `PENDING` / `REMAP` / `RESUME`; this audit did not rerun them. The full 3.2 synthetic CLI journey remains incomplete until its independently valid live adapters and evidence are attached.

## 4. Supporting entry and delivery checks

- [x] 4.1 Integrate Chromium Web and mobile control journeys plus private gateway initial-navigation recovery without replacing the live CLI lane; retain real-phone acceptance as `pending-user-acceptance` until the user's manual check.
- [ ] 4.2 Run the authorized shared-runtime night watch under `test`, inspect every step independently, and retain the redacted report.
- [ ] 4.3 Run focused and full regression gates, validate OpenSpec strictly, review the diff, then push, merge, deploy, and update the authorized GitHub delivery records.
