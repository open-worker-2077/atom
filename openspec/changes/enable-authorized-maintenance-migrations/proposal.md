## Why

The maintenance-token CLI authenticates a trusted local operator but currently drops that trust before world authorization, so an explicitly approved atomic recovery or migration is incorrectly evaluated as an ordinary Agent-window write and fails on Program or slot locks. This blocks safe hierarchy recovery while encouraging unsafe out-of-band data edits.

## What Changes

- Carry a non-user-settable trusted-maintenance capability from the token-authenticated admin/global CLI through the interaction runtime into the Atom engine.
- Let only that trusted path bypass ordinary Agent-window, Program Graph, and slot-structure authorization during an atomic Transform.
- Preserve parsing, exact target resolution, collision/cycle checks, relation and shortcut path rewrites, world revision checks, transactional commit, projection publication, and rollback behavior.
- Keep the public CLI, Web endpoints, Agent sessions, and ordinary runtime requests unable to request or forge trusted maintenance.

## Capabilities

### New Capabilities

- `authorized-maintenance-migrations`: Token-authenticated, local maintenance operations can perform explicitly approved atomic recovery or hierarchy migration without weakening ordinary Agent authorization.

### Modified Capabilities

None.

## Impact

- `work-engine/atom-language/admin-cli.mjs` and `global-cli.mjs`
- `src/atom-system/adapters/runtime-cli-executor.mjs`
- `src/atom-system/public/interaction-runtime.mjs`
- `work-engine/atom-language/query-capability.mjs`
- Maintenance/runtime composition tests; no public API or stored-world schema change
