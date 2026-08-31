## Why

Atom still accepts a persisted `thing@agent` node with arbitrary prose as an Agent context even though labels and function scopes can only be reconstructed from a literal `agent({...})` declaration. This leaves a second, authority-less Agent format in the runtime and allowed the deployed `🧊manage` window to appear usable while lacking its intended keys.

## What Changes

- **BREAKING**: recognize an Agent context only when the node is both `@program` and `@agent` and its Program contains exactly one valid literal `agent({...})` declaration.
- Reject pure `thing@agent` selectors with an explicit retired-format error instead of silently creating an empty-authority window.
- Remove pure `thing@agent` fixtures and compatibility assumptions from runtime, CLI, deployment and acceptance tests.
- Migrate the deployed world without deleting content: active Agents remain or become `thing@program@agent`; archived legacy Agent markers are removed so archived nodes remain ordinary facts.
- Preserve the existing versioned legacy-support compatibility manifest; this change retires only the legacy Agent format, not separately authorized legacy support relations.

## Capabilities

### New Capabilities

- `registered-agent-format`: Defines the sole persisted Agent representation, retired-format rejection, and lossless deployed-world migration.

### Modified Capabilities

None.

## Impact

- Affects Agent directory construction, CLI context resolution, cold-start security reconstruction, Graph server initialization, fixtures, focused permission tests, and the deployed Atom world.
- Does not change Graph axes, path/lock matching, label semantics, Program ABI, support compatibility, or maintenance authorization.
- Requires one bounded central maintenance transaction for the deployed world and a cold-start verification after migration.
