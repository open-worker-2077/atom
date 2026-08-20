## 1. Contract and regression baseline

- [x] 1.1 Add failing contract tests proving form definitions compile only to `name`, `detail`, `children`, and `partners`.
- [x] 1.2 Add failing tests for exact template versioning, idempotent creation, stale-revision rejection, and no partial commit.
- [x] 1.3 Add failing tests for sibling, ancestor, descendant, and partner Program reads, including ambiguous-name rejection.

## 2. Protected form kernel

- [x] 2.1 Implement the protected `form()` definition validator and Graph-native compiler without adding a new storage axis.
- [x] 2.2 Register stable template identity and exact version selection, and persist provenance on generated ordinary Atoms.
- [x] 2.3 Implement child outcome reporting and root-level state coordination with one declared writer per mutable fact.
- [x] 2.4 Route every form effect through the existing Program intent, Transform validation, revision, and commit boundary.

## 3. Work-order outer library

- [x] 3.1 Define `work_order()` version 1 with Output, Step, Criteria and the necessary result, evidence, acceptance, status, and exception slots.
- [x] 3.2 Implement create, fill, validate, submit, reject, revise, and read-back actions using the shared form kernel.
- [x] 3.3 Provide concise instance guidance and next-action output without exposing template internals as form content.
- [x] 3.4 Verify unsupported dispatch or multi-order requests fail cleanly without partial data.

## 4. Atom year-ring records

- [x] 4.1 Extend committed receipts with affected Atom linkage and changed Graph-axis metadata while keeping old receipts readable.
- [x] 4.2 Add bounded read and Program diagnostics containing timing, fingerprint, outcome, failure, and affected references without full-detail duplication.
- [x] 4.3 Build a rebuildable per-Atom year-ring index over receipts and diagnostics, with retention and compaction tests.

## 5. Shared interfaces and acceptance

- [x] 5.1 Expose identical work-order registry metadata, actions, errors, and receipts to CLI and Web.
- [x] 5.2 Create a dedicated top-level test Atom and run the real create → fill → validate → submit → read-back workflow without modifying business data.
- [x] 5.3 Run focused unit, integration, transaction, Program-runtime, CLI, Web, and end-to-end suites and record acceptance evidence.
- [x] 5.4 Update Help and architecture documentation with only the public contract and operational guidance.
