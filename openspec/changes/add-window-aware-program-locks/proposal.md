## Why

Program locks currently protect Atom fields without considering the resolved `@agent` window that originated an interaction. Application Programs therefore cannot express the narrow rule “permit these exact windows inside this protected region and apply the normal lock to every other window,” and the public Help exposes no safe contract for doing so.

## What Changes

- Extend Program lock results with an explicit `allowed_windows.paths` list computed by the calling Program.
- Compare the current CLI interaction's already-resolved exact `@agent` path with that list whenever an operation reaches a protected target.
- Preserve existing lock behavior for locks that omit `allowed_windows`, so current Programs remain compatible.
- Add an explicit request-driven recomputation operation that atomically replaces a stored lock snapshot only after successful evaluation and validation.
- Stop source Program or dependency changes from implicitly replacing request-driven lock snapshots.
- Publish the complete lock and recomputation contracts, validation errors, and denial receipt through CLI Help and the Program function registry.
- Verify allowed-window access, non-allowed-window denial, failed-recompute retention, and window-move-then-recompute behavior in code tests and the Atom `test` domain only.

## Capabilities

### New Capabilities

- `window-aware-program-locks`: Window-path-aware Program lock evaluation, request-driven lock snapshot recomputation, public contracts, and enforcement receipts.

### Modified Capabilities

None.

## Impact

- Program result validation and lock indexing in `work-engine/atom-language/program-runtime.mjs` and `program-locks.mjs`.
- Interaction-context propagation and read/write authorization in the Atom language engine.
- Persisted Program lock projection lifecycle and targeted explicit Program execution.
- Public CLI Help and `atom-program-function-registry` JSON.
- Program lock, interaction, registry, and end-to-end tests.
- The 4784 Atom Graph service must be restarted after delivery so the verified contract is actually loaded.
