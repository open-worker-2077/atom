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
