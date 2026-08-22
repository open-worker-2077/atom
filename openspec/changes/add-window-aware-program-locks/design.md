## Context

See `proposal.md` for motivation and `specs/window-aware-program-locks/spec.md` for observable behavior. Current Program locks are recalculated as part of the Program projection for a world revision, target revision-scoped refs, and authorize only by target path, operation, and field. The interaction already carries one exact resolved `@agent` `{ref, path}`, but the Program lock evaluator does not receive it. Public `.run.` already selects and forces one exact Program, making it the smallest coherent recomputation trigger.

## Goals / Non-Goals

**Goals:**

- Add one narrow allowlist comparison based on the resolved interaction window path.
- Let a Program perform arbitrary prior computation and pass only a validated JSON list to `lock()`.
- Preserve a request-driven lock as a durable snapshot until explicit `.run.` successfully replaces it.
- Keep current locks and current `.run.` syntax compatible.
- Make the running 4784 Help contract sufficient for application Agents.

**Non-Goals:**

- Treating `@agent` as user identity, authentication, a permission grant, or a cryptographic principal.
- Adding general policy languages, roles, groups, wildcard paths, fuzzy selectors, or cross-Atom identity.
- Allowing Program code to edit the registered function catalog or persistent lock storage directly.
- Creating or modifying ESG business nodes during development.

## Decisions

### Use exact paths as the only window selector

`allowed_windows` is exactly `{"paths":["full/path/to/@agent"]}`. Full paths match the exact path already returned by CLI Agent resolution and avoid inventing identity semantics. Short names, patterns, and refs are rejected: short names can become ambiguous, patterns widen authority unexpectedly, and current refs change with every world revision.

Alternative considered: persistent window IDs. That would require a new Atom identity model and migration, which is outside this narrow capability.

### Separate automatic locks from request-driven snapshots

Locks that omit `refresh` stay in the existing per-cycle projection. Locks with `refresh.policy == "on_request"` publish only during an explicit selected Program run. Their normalized snapshot stores target paths and allowed window paths, not revision-scoped refs, and is merged with automatic locks during authorization.

Alternative considered: disable all automatic Program recomputation. That would change unrelated Program effects and violate compatibility.

### Reuse explicit `.run.` as the recomputation request

`transform {"name.run.":"exact/program/path"}` already represents an intentional, exact Program execution. The engine will mark that selected execution as allowed to publish request-driven locks. No second roaming syntax or redundant registered function is added.

Alternative considered: a new `recompute_lock()` registered function. It would itself require another Program execution and create nested scheduling semantics without adding user value.

### Replace snapshots by source Program path

A successful explicit run replaces the complete request-driven lock set owned by that exact source Program path. Emitting no request-driven locks is an intentional unlock. A failed or invalid run changes nothing. Replacement by source keeps the public contract small and makes multiple locks from one Program atomic.

Alternative considered: require a public lock ID for item-by-item replacement. It adds lifecycle and uniqueness rules that are unnecessary for the requested whole-Program recalculation model.

### Persist request-driven snapshots independently from disposable Program projections

Request-driven lock snapshots need a small authoritative runtime repository because ordinary Program projections are discarded when their world revision changes. The repository records normalized source path, targets, mode, fields, protection flags, reason, and allowed paths. It never stores Atom content. Publication uses the existing atomic JSON write discipline; load validation fails closed for malformed snapshots.

Alternative considered: embed snapshots in `program-projection.json`. Its current world-revision invalidation would either discard locks or require weakening projection validation, coupling two different lifecycles.

### Keep the existing denial code

Non-allowed windows receive `PROGRAM_LOCK_DENIED` for writes and existing truncation for protected reads. This is “normal lock” behavior as requested and avoids splitting caller handling across two denial families. The diagnostic identifies the source lock and reason but does not disclose the allowlist or protected content.

## Risks / Trade-offs

- **[A window move changes its exact path]** → The old snapshot intentionally remains until the scheduler explicitly runs the lock Program after the move; the move/recompute acceptance test proves this sequence.
- **[A source Program is deleted or broken]** → Its last valid request-driven snapshot remains active; restoring or recreating the exact Program path and explicitly running it is required to replace or remove the snapshot.
- **[Persistent snapshot file is unreadable or malformed]** → Initialization fails closed for protected writes and reports a maintenance error rather than silently dropping locks.
- **[An allowed window path is visible in public Help examples]** → Help uses placeholders only; runtime denial receipts never expose the configured list.
- **[Explicit unlock by emitting no locks is powerful]** → It requires exact `.run.` of the owning Program and only takes effect after a fully successful evaluation.

## Migration Plan

1. Add failing unit and end-to-end tests for validation, allow/deny, snapshot persistence, explicit replacement, failed replacement retention, and move/recompute.
2. Add snapshot normalization, persistence, merge, and interaction-path enforcement while preserving existing lock behavior.
3. Publish registry and CLI Help contracts from one authoritative definition.
4. Run targeted and nearest regression suites.
5. Restart the hidden 4784 runtime, verify its registry and Help, then perform an isolated real `test`-domain positive/negative/move/recompute acceptance.
6. Commit and push the coherent change. Rollback restores the previous code and runtime; existing automatic locks remain compatible, while request-driven snapshots must be retained until the prior runtime is intentionally restored or their protected test targets are removed through the documented recovery procedure.
