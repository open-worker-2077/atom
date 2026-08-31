## 1. Contract tests

- [x] 1.1 Add RED support-runtime tests for true-only typed deliveries, exact payloads, and one delivery per normalized clause/consequent.
- [x] 1.2 Add RED Program trigger tests proving exact support subscription, false/no-subscription inactivity, and argument delivery without changing Transform ABI.
- [x] 1.3 Add one RED synthetic slot acceptance covering seal, two prints, owner-local true, consequent-owned action, automatic node lock, sibling isolation, and Agent allow/deny.

## 2. Minimal implementation

- [x] 2.1 Build immutable typed support deliveries beside projection consumption without mutating ordinary Things.
- [x] 2.2 Extend Program trigger discovery and invocation with explicit `support` mode and one typed argument object.
- [x] 2.3 Dispatch candidate-revision deliveries through exact subscriptions with revision-bound prepared graphs, replay-safe execution gates, and slot-relative binding.
- [x] 2.4 Update CLI Help for the support subscription boundary without weakening the no-implicit-execution rule.

## 3. Focused verification and delivery

- [x] 3.1 Run only the support delivery, slot chain, node-lock, and Agent-lock affected tests plus syntax and strict OpenSpec validation.
- [ ] 3.2 Commit, push, open and merge one PR, deploy the merged runtime, and run the same focused synthetic chain against the formal local service.
- [ ] 3.3 Write TestCase→Evidence→Issue backlinks to the instance issue and Issue #1, then update the sole state machine from the verified result.
