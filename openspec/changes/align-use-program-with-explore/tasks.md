## 1. Contract and RED baseline

- [ ] 1.1 Add failing Program-reference tests for inline `use_program({"ref": explore(...)[0].ref, ...})`, JSON-compatible return data and omitted runtime input.
- [ ] 1.2 Add failing tests proving non-Program, missing and foreign/stale refs are rejected without name/path fallback or published effects.
- [ ] 1.3 Add compatibility tests preserving existing `{name, arguments}` callers and Explore-consistent ambiguity rejection.

## 2. Unified Program target resolution

- [ ] 2.1 Implement one ref/type validator for current-revision Program targets and route the standard ref form through it.
- [ ] 2.2 Route the legacy name form through the existing Explore selection path, then through the same ref/type validator, while preserving optional arguments and JSON return validation.
- [ ] 2.3 Preserve recursion/depth checks, shared effects and conservative Program dependency invalidation; add or adjust lifecycle regression coverage where required.

## 3. Public contract and verification

- [ ] 3.1 Update CLI Help and Program runtime documentation to present concise inline Explore-ref invocation as standard and label the name form compatibility-only.
- [ ] 3.2 Run Program reference, lifecycle, sandbox, lock, transaction and CLI contract suites and resolve regressions within this change's scope.
- [ ] 3.3 Run strict OpenSpec validation and record the final focused verification result without claiming unrelated repository-wide completion.
