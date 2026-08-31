## 1. Contract Tests

- [ ] 1.1 Add a failing Agent-resolution test that rejects pure `thing@agent` with a stable retired-format error.
- [ ] 1.2 Add positive and forged-source tests proving only valid `thing@program@agent` declarations resolve and rebuild authority.
- [ ] 1.3 Add a migration conservation test proving archived legacy Agent demotion preserves paths, situations, containment and support.

## 2. Runtime Contract

- [ ] 2.1 Introduce and apply one registered-Agent predicate across Agent directory construction and Program security reconstruction.
- [ ] 2.2 Make direct Agent resolution require a reconstructed registration and return the retired-format or invalid-registration error precisely.
- [ ] 2.3 Update CLI Help, registry metadata and active test fixtures so no documented path relies on pure `thing@agent`.

## 3. Migration

- [ ] 3.1 Implement or reuse a bounded central migration that removes only the `agent` type from archived pure legacy Agent facts.
- [ ] 3.2 Run the migration against an isolated copy of the deployed world and verify node/content/relation conservation plus zero pure legacy Agent markers.
- [ ] 3.3 Apply the authorized migration to the deployed world, recover projections and cold restart the 4784 runtime.

## 4. Verification and Delivery

- [ ] 4.1 Run focused Agent, permission, CLI, runtime initialization and migration tests.
- [ ] 4.2 Verify the deployed world has zero pure legacy Agent markers, valid registered Agents, stable top-level structure and ordinary CLI access.
- [ ] 4.3 Validate OpenSpec strictly and map TestCase, evidence, commit, deployment revision and Issue #13 back to GitHub Issue #1.
