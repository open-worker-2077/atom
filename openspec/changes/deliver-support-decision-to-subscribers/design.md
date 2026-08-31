## Context

The support evaluator already computes a clause decision map, while Spatial consumes it only to filter and annotate visible relations. The Program scheduler currently accepts only path-based Transform trigger events and invokes zero-argument entrypoints. See `proposal.md` and the delta spec for the missing handoff contract.

## Goals / Non-Goals

**Goals:**

- Preserve support evaluation as a pure strict-bool operation.
- Convert committed true decisions into a small typed delivery set.
- Execute only Programs with an explicit exact support subscription.
- Bind slot-model subscribers to the owning slot-example relative domain.

**Non-Goals:**

- Do not execute ordinary consequents.
- Do not discover subscribers through contain/support traversal.
- Do not encode delivery as a fake Transform or persist bool on ordinary Things.
- Do not introduce queues, retries across revisions, or scale optimization in this change.

## Decisions

### Keep projection and delivery as separate consumers

The projection adapter will continue using support decisions for visual relations. A separate delivery builder will normalize only true decisions into immutable records. This avoids making rendering responsible for workflow execution; one evaluation walks each normalized clause/consequent once.

Alternative rejected: synthesize a Transform on the consequent. It would mutate or misrepresent ordinary facts, enter existing Transform trigger loops, and violate the rule that ordinary Things do not carry bool.

### Add an explicit support trigger mode

`trigger("support", {"nodes":["./ordinary-consequent"]}, entrypoint)` declares an exact subscription. Transform trigger behavior remains unchanged. A support entrypoint receives one argument object with the typed delivery; Transform entrypoints remain zero-argument for compatibility.

Alternative rejected: automatically run a Program contained by the consequent. Containment is data structure, not execution authorization, and would reintroduce the implicit execution contract the user rejected.

### Dispatch inside the same central candidate transaction

Delivery is derived after the user's Transform has formed a candidate revision and before that candidate commits. It is passed to the scheduler with the normal Agent origin and slot relative-domain binding; the subscribed action's effects join the same bounded reconciliation transaction. A subscriber failure rolls back the complete candidate, while the support evaluator remains effect-free.

Successful subscriber execution is idempotent for the tuple of Program, slot scope, candidate
revision, clause, and consequent. Repeated or concurrent refreshes share one execution gate. Worker
completion only claims the delivery; the central world commit confirms it. Reconcile, effect
application, validation, another subscriber, or commit failure releases every claim in that candidate
so a later source retry is not silently treated as delivered. A successful interaction with no fact
change confirms its consumed claims at the interaction boundary; a context-dependent result filtered
because no Agent scope exists is not consumed and releases its claim immediately.

### Select support work from prepared exact-path indexes

Cold preparation retains parsed support clauses and dependency indexes by exact world revision. A Transform event supplies exact affected paths separately from legacy trigger aliases; the scheduler expands only those exact paths through their local ancestor chain, selects the matching clauses from the prepared index, and evaluates only that set. A situation-only edit may reuse only the graph identified by its explicit base revision, then aliases that unchanged structure to the candidate revision. A structural support edit reparses and caches the candidate under its own revision. Bare result names remain available to legacy Transform triggers but never participate in support selection.

## Risks / Trade-offs

- **[Duplicate dependency hits]** Multiple changed paths may select the same clause → evaluate the normalized clause once and emit once per consequent.
- **[Delivery replay]** Repeated or concurrent refreshes may carry the same typed delivery → gate successful subscriber execution by Program, slot scope, revision, clause, and consequent; release the gate on failure.
- **[Trigger loops]** A subscriber may Transform a dependency that causes a later support delivery → retain existing revision/cycle bounds; never manufacture Transform from delivery itself.
- **[Compatibility]** Existing trigger parser assumes transform and zero arguments → add the mode branch without changing Transform ABI or existing contracts.
- **[Slot ambiguity]** Model paths differ from example paths → reuse the existing slot relative-domain resolver and require exactly one owner-local consequent match.
- **[Partial commit]** A subscriber can fail after the source edit has formed a candidate → mark delivery-backed failures as blocking and roll back the whole candidate.
