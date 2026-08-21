## Context

See `proposal.md` for motivation and `specs/program-runtime-effects/spec.md` for behavior. The Python worker currently records every `transform(spec)` as an untyped deferred effect and returns `None`. The engine later compiles every effect as an ordinary update, while external `transform new` follows a separate creation branch. The scheduler also derives executable Programs from every `@program` record without considering ancestry, even though the Graph projection already treats the unique default backup subtree as non-active spatial content.

The incident evidence shows both consequences directly: the valid four-axis probe was rejected because its target did not exist, and runtime diagnostics show multiple historical routing Programs below the default backup Atom consuming the shared ten-second cycle budget.

## Goals / Non-Goals

**Goals:**

- Give one existing world function, `transform(spec)`, a deterministic create-or-update discriminator.
- Reuse one authoritative creation executor for CLI-originated and Program-originated creation.
- Keep Program effects deferred until engine authorization, reconciliation and commit.
- Derive one active Program set and use it consistently for scheduling and `use_program` availability.
- Make the contract discoverable in both prose Help and the structured public registry.

**Non-Goals:**

- Do not add `create()` or a Program-only `transform new` language form.
- Do not make backed-up facts unreadable or unrestorable.
- Do not redesign Program time budgets, worker concurrency, `explore`, `use_program`, or work-order semantics beyond the activation boundary required here.
- Do not write or replay ESG business data during implementation.

## Decisions

### 1. Infer creation only from a complete persistent four-axis item

The compiler will first parse the JSON through the existing Transform parser. An item is a creation candidate only when its parsed fields contain exactly one field for each base axis `name`, `detail`, `children`, and `partners`, no field carries a dot command, and parsing otherwise succeeds. The compiled Program effect carries this mode to execution.

This preserves every dot-command update, including `detail.rep.`, and leaves partial plain-axis objects on the existing update path. A separate `create()` function was rejected because it would split Graph mutation vocabulary. An explicit Program-only mode key was rejected because it would add a non-Graph field and break the already deployed four-axis probe.

### 2. Extract and share the Atom creation executor

The engine will isolate the current `transform new` mutation core into one local executor that accepts the current world, parsed item, authorization capability and matcher registry. It will return either a changed candidate world with an exact result path or a typed diagnostic. Both the CLI creation branch and Program effect application will call it.

Program reconciliation will continue to plan all deferred effects first and persist only the validated final candidate world. Creation candidates will additionally pass Program-source validation when they introduce executable content; the final Graph projection and central commit remain the authoritative all-or-nothing gates.

Duplicating the external creation block inside Program reconciliation was rejected because validation and collision behavior would drift. Calling the public CLI recursively was rejected because it would create nested transactions and bypass the effect-set reconciliation boundary.

### 3. Keep `transform()` return value as `None`

The worker will not manufacture a success object before authorization and commit. Assignment therefore continues to receive `None`; Help will tell callers to use the interaction receipt and exact read-back as proof.

Returning the submitted object was rejected because it would look like a committed receipt. Blocking the Python worker until commit was rejected because Program evaluation must finish before the engine can reconcile the complete effect set.

### 4. Determine Program activation from default-backup ancestry

After world records are built, the scheduler will identify the unique record carrying both `backup` and `default` types and mark its entire descendant closure inactive for Program execution. `programRecords()` will select only active Programs. The same active set will be sent to the worker as the callable `use_program` catalog, while ordinary world records remain available to authorized `explore`.

Filtering by a localized name such as `默认备份仓` was rejected because type annotations are the stable semantic identity. Filtering only top-level children was rejected because Programs can be nested arbitrarily deep. Filtering only scheduler roots was rejected because `use_program` would still execute backed-up code indirectly.

### 5. Expose one structured Transform contract

The existing registry entry for `transform` will gain JSON-compatible contract metadata describing its create form, update form, deferred result and confirmation rule. CLI Help will render the same semantics in concise examples. The registry family hierarchy and public scope model remain unchanged.

## Risks / Trade-offs

- **[Previously undocumented full-four-axis updates become creation attempts]** → Plain full-axis replacement is already outside the documented update contract; retain every documented dot-command update and add a regression test.
- **[Creation and update effects in one cycle can target each other]** → Apply effects deterministically in emitted order against one candidate world, then validate and commit the final world atomically.
- **[Backup identification fails in a malformed world]** → Do not guess by name; existing world validation remains responsible for enforcing the unique default backup. With no valid default-backup record, the scheduler performs no ancestry exclusion and the interaction surfaces the existing world-validation failure at its normal gate.
- **[Registry metadata surprises older readers]** → Add optional fields without changing contract version 2 or existing required fields; existing readers that select known keys remain compatible.

## Migration Plan

1. Land failing tests that capture the probe creation and backed-up Program execution.
2. Add the shared creation path and active Program selection behind existing interfaces.
3. Update Help and registry metadata, then run focused Program, Transform, scheduler, CLI and service tests followed by the full suite.
4. Restart the local 4784 service so CLI and Web use the new runtime.
5. Re-run only the existing `test/ESG工单生成-transform创建探针`, confirm the new test child by exact read, and report the result to the source task. Do not replay the 39 business work orders.

Rollback is one code commit: revert the runtime commit and restart the service. The test-created Atom remains ordinary user-world data and can be reversibly moved to the default backup through the public Transform contract if cleanup is later authorized.
