## 1. Contract and RED baseline

- [x] 1.1 Add failing Form tests for explicit required, optional and disabled components, exact missing key paths, recursive nesting and zero/one-component scale.
- [x] 1.2 Add failing compatibility tests proving direct four-axis compilation is unchanged and application-specific stages are never synthesized.
- [x] 1.3 Add failing registry tests for complete unique classification, `explore`/`transform` grouping, `@program` kernel-type metadata and hierarchical public constraint inheritance.
- [x] 1.4 Add failing Program/CLI/Web parity tests for catalog filtering, Help grouping and no-Agent read access.

## 2. Adaptive Form kernel

- [x] 2.1 Implement a pure recursive component evaluator with explicit activation and JSON key-path requirements.
- [x] 2.2 Route only `form({"action":"evaluate",...})` to evaluation while preserving the existing direct compile branch and deterministic input errors.
- [x] 2.3 Verify disabled subtrees, unused optional subtrees and active optional subtrees without emitting effects or mutating world status.

## 3. Program function registry

- [x] 3.1 Add the authoritative versioned registry with separate layer, category, scope and kernel-type metadata plus hierarchical public constraints.
- [x] 3.2 Load the registry in JavaScript and Python, derive registered Atom function names, and fail closed on duplicate, invalid or unimplemented entries.
- [x] 3.3 Register read-only `function_catalog()` filtering without granting Programs registry mutation or automatic local-Program promotion.

## 4. Shared interfaces and architecture boundary

- [x] 4.1 Expose equivalent function-registry payloads through CLI and Web without requiring an Agent context.
- [x] 4.2 Render CLI Help classification from the registry and keep existing function call contracts and work-order registry output compatible.
- [x] 4.3 Document the usage-side/backend boundary, Atom/public scope model, public inheritance, local material pipeline and deferred application-type decision.

## 5. Verification and delivery

- [x] 5.1 Run focused Form, Program standard-library, work-order, advancement-flow, CLI/Web and architecture suites; resolve regressions within scope.
- [x] 5.2 Run strict OpenSpec validation and relevant repository-wide regression, recording exact unrelated baseline failures without overstating completion.
- [x] 5.3 Run GitNexus change detection, review the final diff for scope and data safety, then commit only the change-owned files.
