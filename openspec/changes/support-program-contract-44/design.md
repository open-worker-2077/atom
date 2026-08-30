## Context

See `proposal.md` for motivation and `specs/support-program-decision/spec.md` for the normative role and execution contract. The parser already represents `if@current: true` plus an additional Program condition as an `and` root containing an implicit ordinary current antecedent and an explicit Program leaf. The support runtime has both synchronous static evaluation and asynchronous Program-backed evaluation; both must keep ordinary Things outside boolean evaluation. The Program scheduler has a support-evaluation entry point with strict-result and effect checks. Existing tests cover these pieces separately but call the Program an “antecedent Program” and do not exercise the complete three-role Transform contract.

## Goals / Non-Goals

**Goals:**

- Make one synthetic regression the executable decision boundary for Issue #44.
- Prove the ordinary antecedent remains a structural endpoint while the independent Program alone supplies the boolean gate.
- Prove changed-path locality, false/true support outcomes, consequent non-execution, and effect rejection together without production fixtures.
- Let a failing characterization identify the smallest runtime seam that actually violates the contract.

**Non-Goals:**

- Redesign the support AST, Graph schema, Program language, or general reconcile scheduler.
- Execute consequent-side Programs, introduce a propagation workflow, or make ordinary Things return booleans.
- Modify real `atom.json`, business facts, projection stores, GitHub state, or deployment state.

## Decisions

### Use one explicit three-role fixture

The regression will construct an ordinary antecedent with `if@current: true`, add the independent support-decision Program as the second condition, and target an ordinary consequent. This preserves the actual support direction while exposing the Program as a decision dependency rather than renaming it as the antecedent. The decision trace must contain only Program operands; treating an ordinary Thing as an implicit `true` is a contract failure, not a neutral implementation detail.

Alternative considered: test a Program-only antecedent with `then@current`. Rejected because it collapses the decision Program into the support antecedent and cannot prove the terminology or ordinary-Thing boundary required by Issue #44.

### Characterize before editing runtime code

The first implementation action will add the complete focused regression against the current main-based branch. If it passes, the change will be limited to the regression and terminology corrections. If it fails for a contract reason, the failure will define the minimal runtime edit.

Alternative considered: alter `support-runtime.mjs` preemptively. Rejected because the existing parser, evaluator, and scheduler may already compose into the required behavior.

### Observe calls and projected relations, not implementation branches

The test will record Program selectors passed to the real support-evaluation boundary and assert the returned decisions/propagated support relations. A separate effectful Program case will use the real scheduler support entry point and verify both the error code and unchanged world state.

Alternative considered: mock internal parser or scheduler helpers. Rejected because that would prove call wiring rather than the public support contract.

### Keep Transform scope synthetic and path-indexed

The Transform acceptance will use its reported `changedPaths` as the support evaluator's selection input. Unrelated clauses and a consequent-side Program will be present as sentinels so an accidental global evaluation is observable.

Alternative considered: run a full deployment or business graph. Rejected because it would add unrelated persistence and business-data risk without improving the contract evidence.

### Treat Program-free support as unconditional

The synchronous static evaluator will treat a parser-valid clause with only ordinary Thing endpoints as established without consulting a node-presence lookup. Parser validation already guarantees every selector resolves, so checking existence again produces no new fact and incorrectly turns a Thing into a boolean operand. Both synchronous and asynchronous traces therefore record only actual decision Programs.

Alternative considered: keep the node lookup but hide it from trace. Rejected because that preserves the forbidden boolean source and can still turn a valid clause false when a partial view is supplied.

## Risks / Trade-offs

- [A unit-level composition could miss projection orchestration behavior] → Run the nearest existing projection integration test after the focused regression, and add kernel code only if the focused failure identifies an orchestration gap.
- [A passing characterization does not provide a conventional RED] → Demonstrate test sensitivity with a temporary mutation or assertion inversion, restore immediately, and record the expected failure before the final green run.
- [Terminology changes could obscure established parser field names such as `antecedent`] → Correct only references that wrongly name the decision Program itself; retain `antecedent` and `consequent` for the actual support endpoints.
- [A side-effect rejection test could accidentally write persistent state] → Use an in-memory synthetic world and the scheduler's support-evaluation mode only.

## Migration Plan

No data or deployment migration is required. Apply by adding the focused regression first, then make a minimal runtime change only if the regression proves one is necessary. Rollback is the local commit reversal; no persisted world state is touched.
