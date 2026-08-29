## Context

See `proposal.md`. The token is currently validated in the admin/global CLI process, but `createRuntimeCliExecutor` submits an ordinary interaction. With no Agent path, fixed-window checks disappear, yet compiled Program and slot locks remain active; therefore an approved recovery migration still returns `WINDOW_ACCESS_DENIED`.

## Goals / Non-Goals

**Goals:**

- Preserve a single interaction runtime, transactional persistence path, and projection lifecycle.
- Make trusted maintenance explicit, internal, and capability-based after token validation.
- Prove both the positive maintenance path and the unchanged public denial path.

**Non-Goals:**

- No routine Agent administration bypass.
- No HTTP maintenance endpoint, token transport, stored-world schema change, or direct JSON editing.
- No weakening of collision, cycle, type, relation, revision, commit, or projection checks.

## Decisions

- The token-authenticated entry constructs `createRuntimeCliExecutor({ trustedMaintenance: true })`; callers cannot encode the flag in Atom source or Graph-JSON. This keeps trust at composition time rather than in user input.
- The trusted executor omits the business Program scheduler for the bounded structural interaction and invokes the interaction runtime with a private execution option. The interaction runtime forwards the option only to the world port; it is absent from validated intent and history so it cannot be replayed or persisted. Graph/Spatial projection still follows the committed world, while the normal service restart cold-compiles Program locks against the new paths.
- `createAccessController` returns an unrestricted authorization controller for trusted maintenance. Structural and transactional validators remain outside that controller and therefore continue to run.
- Both `admin-cli` and `global-cli` opt in only after `assertMaintenanceToken` succeeds. All other runtime construction remains ordinary by default.

Alternatives rejected:

- Passing a synthetic Agent or labels would create a second permission identity and still misrepresent recovery authority.
- Directly editing backing JSON would bypass revision, path rewrite, projection, and rollback guarantees.
- Adding a public request field would make authority forgeable.

## Risks / Trade-offs

- **Trusted CLI process compromise** → Keep the flag construct-only, require the existing local token, and expose no network route.
- **Over-broad authorized command** → Require explicit human scope before invocation; retain exact selectors and atomic batch validation.
- **Regression in ordinary locks** → Add paired tests showing the identical batch is denied without the trusted option and succeeds with it.

## Migration Plan

1. Add failing composition tests for locked atomic moves and untrusted denial.
2. Thread the internal capability through the authenticated CLI composition.
3. Run focused, system, and full regression suites plus strict OpenSpec validation.
4. Stop the supervised 4784 task, execute the approved transaction, restart it, and verify public read-back.
5. Roll back code normally if tests fail; transactional world commit already leaves facts unchanged when a batch fails.
