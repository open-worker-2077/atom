## Context

See `proposal.md`. Agent directory construction currently treats any `agent` type marker as a selectable context, while security reconstruction only processes nodes that are also Programs. The deployed projection contains 66 pure legacy Agent markers, all beneath `默认备份仓`, and 14 registered Agent Programs; the active world contains no pure legacy Agent after `🧊manage` was upgraded.

## Goals / Non-Goals

**Goals:**

- Make Agent selection and security reconstruction consume the same registered-Program predicate.
- Preserve all archived facts while removing their obsolete executable type.
- Keep the migration atomic, reversible from transaction history, and independently verifiable after restart.

**Non-Goals:**

- Retire the separately versioned legacy-support compatibility manifest.
- Rewrite archived business prose into executable Programs.
- Change path-label authorization, function delegation, locks, jump, slots, or Graph axes.

## Decisions

### One shared registered-Agent predicate

Introduce one predicate for `program && agent` and use it in directory construction, direct context resolution, security rebuild, and related projections. A pure `agent` marker is classified as retired rather than silently accepted.

Alternative rejected: keep directory compatibility and attach empty labels. That recreates the exact mismatch this change removes.

### Validate registration at the selection boundary

Resolving an Agent SHALL verify that the selected registered Program is represented in the reconstructed security map. This catches marker forgery and invalid literal declarations before an interaction starts.

Alternative rejected: rely only on startup validation. Direct file-backed CLI tests and bounded maintenance readers can construct resolution paths outside a long-running server.

### Demote archived legacy windows instead of activating them

The 66 deployed pure legacy Agent facts are all under `默认备份仓`. Their `agent` marker is removed in one maintenance Transform batch; situation, contain and support remain unchanged. Converting them to Programs would reactivate obsolete windows and reinterpret arbitrary prose as code.

Alternative rejected: leave markers in backup because the runtime ignores them. The requested migrated fact source must contain no retired Agent representation, and future tooling must not need location-based exceptions.

### Separate code rollback from fact rollback

Deploy code only after a temporary-world migration and cold-start test pass. The real-world migration is then committed once, followed by projection recovery and restart. Code rollback may restore the previous revision without requiring a data rollback because ordinary facts remain readable; a transaction rollback is retained if the migration itself fails acceptance.

## Risks / Trade-offs

- **Old tests depend on pure `thing@agent` fixtures** → Replace only fixtures that represent active Agents with minimal registered Program sources; retain explicit negative fixtures for the retired format.
- **Archived facts may contain references to their old type** → Type removal does not change path or support selectors; verify node count, paths, situation digests, contain edges and support edges before and after.
- **Agent validation may add repeated Program work** → Reuse the cold-start reconstructed security map; resolution performs a map membership check, not Program execution.
- **A migration-time projection error can follow a committed world transaction** → Use the existing `PROJECTION_RECOVERY_PENDING` contract, never replay the mutation, recover by exact revision, then cold restart.

## Migration Plan

1. Add red tests for pure legacy rejection, valid registered resolution, forged registration rejection, and archived demotion conservation.
2. Implement the shared registered-Agent predicate and resolution/security consistency check.
3. Convert active test fixtures to registered Program Agents and retain explicit legacy-negative fixtures.
4. Run a maintenance migration against an isolated copy of the current world; prove 66 legacy markers become ordinary facts, 14 registered Agents remain, and all fact content/relations are conserved.
5. Apply the same bounded central Transform batch to the deployed world, recover projection, restart 4784, and verify zero pure legacy markers plus ordinary CLI behavior.
6. Roll back the migration transaction and code revision if the real-world conservation or cold-start gate fails.
