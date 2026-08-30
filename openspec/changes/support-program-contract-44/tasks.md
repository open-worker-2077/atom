## 1. Contract Regression

- [x] 1.1 Add one synthetic three-role fixture with an ordinary antecedent, an independent support-decision `thing@program`, an ordinary consequent, unrelated sentinels, and no boolean value on the antecedent.
- [x] 1.2 Assert antecedent-only `changedPaths` selects only that clause and invokes only its support-decision Program.
- [x] 1.3 Assert strict `false` leaves support unestablished and strict `true` establishes the ordinary antecedent-to-consequent support, without executing the consequent or any consequent-side Program.
- [x] 1.4 Assert a non-boolean result and an attempted Program effect are rejected with their stable error codes, and assert the synthetic world remains unchanged after the effect attempt.

## 2. Test-Driven Decision

- [x] 2.1 Run the focused regression against the current branch and record whether the kernel already satisfies every contract assertion.
- [x] 2.2 Prove the regression is sensitive by temporarily inverting or mutating one required behavior, observe the expected RED, restore it, and rerun GREEN.
- [x] 2.3 If and only if the unmodified kernel fails a contract assertion, make the smallest runtime correction at the failing seam and rerun the focused regression.
- [x] 2.4 Replace “antecedent Program” wording where it incorrectly names the independent support-decision Program, while preserving antecedent/consequent terminology for real support endpoints.

## 3. Verification

- [x] 3.1 Run the focused support endpoint test and the nearest projection integration regression with zero failures.
- [x] 3.2 Run strict OpenSpec validation, inspect the final diff for scope, and confirm no `atom.json`, business fact, external state, or unrelated production file changed.
- [x] 3.3 Commit the verified local candidate on `fix/support-program-contract-44` and report the SHA, exact test evidence, and the actual kernel-behavior verdict.

## 4. Review Follow-up

- [x] 4.1 Add a synchronous regression proving ordinary static support is unconditional and has an empty boolean decision trace.
- [x] 4.2 Remove ordinary Thing existence from synchronous boolean evaluation while preserving parser-valid static support propagation.
- [x] 4.3 Rerun the affected support and projection regressions, validate OpenSpec, and commit the review correction.

## 5. Latest-decision correction

- [x] 5.1 Add RED parser coverage proving a `thing@program` owner cannot use `if@current` or `then@current` as a fact endpoint and Program-only conditions cannot replace ordinary facts.
- [x] 5.2 Reject Program-owned and Program-only fact support rules while retaining ordinary static support as unconditional and Program-backed support as strict bool.
- [x] 5.3 Inspect and migrate the current allowed DataFlow wiring through the public Atom interface; publish only sanitized counts/contracts.
- [ ] 5.4 Re-run focused kernel, projection, current DataFlow readback and same-version deployment evidence; bind it to #44/#10/#1.

## 6. Default-backup active boundary

- [x] 6.1 Add RED coverage proving invalid historical support below the typed default backup is preserved in Atom facts but excluded from active Graph validation.
- [x] 6.2 Project empty support arrays only inside the typed default backup while preserving its complete Thing, contain, and situation facts.
- [x] 6.3 Verify the affected context, Graph projection, and Program scheduling chain, including inactive Program and restoration behavior.
- [ ] 6.4 Validate OpenSpec, run release regression, deploy the same merged version, and bind cold-start evidence to #44/#10/#1.

## 7. Ordinary consequent closure

- [x] 7.1 Add RED coverage for `thing@program` consequents at Graph parser, Program form, and slot-plan compilation boundaries.
- [x] 7.2 Reject Program consequents consistently while keeping Program selectors valid only as `if` decision dependencies.
- [x] 7.3 Count only ordinary fact antecedents for N/M arity and preserve valid Program-gated one-to-many rules.
- [x] 7.4 Migrate slot fixtures and night-watch synthetic scripts from `then → Program` to ordinary consequents plus independent decision/trigger Programs.
- [ ] 7.5 Run the precise Graph/Form/slot/night-watch chain, deploy the merged version, and bind current evidence to #4/#10/#1.
