## Why

Atom currently rejects valid Agent reconfiguration before label locks are evaluated and treats a missing disposable Program projection as a startup or request failure. Both behaviors turn a small path-label authorization problem into a second authority and recovery system.

## What Changes

- Make Explore and Transform outcomes consistently reflect the current Agent's key labels and the applicable Graph lock labels.
- Apply the same path-label algorithm to Agent Program reconfiguration; self and descendant targets do not use a separate management channel.
- Keep post-change Agent labels and function scopes bounded by the caller's current authority.
- Permit the implementation to use on-demand evaluation, precomputation, dependency indexes, caches, or a combination, provided the result remains equivalent to current Atom facts.
- Remove cache persistence and context-free Program projection availability as runtime startup, Explore, or Transform gates.

## Capabilities

### New Capabilities

- `path-label-authorization`: User-visible authorization from Agent key labels and applicable Graph lock labels, including bounded Agent reconfiguration.
- `permission-index-cache`: Availability and correctness requirements for any optional permission acceleration mechanism.

### Modified Capabilities

None.

## Impact

- Affects the window Graph access controller, registered Agent source validation, Program scheduler cache lookup/rebuild, runtime initialization, CLI Help, registry metadata, and focused permission/projection tests.
- Does not change Atom facts, Graph axes, lock declaration syntax, function-scope delegation rules, or transaction authority.
