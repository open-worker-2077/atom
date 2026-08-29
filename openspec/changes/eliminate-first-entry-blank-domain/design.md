## Context

See `proposal.md` for motivation. The current server filters scoped state to one exact path. The browser changes its current path synchronously, then emits a view event that fetches the target path asynchronously. This ordering guarantees a temporary empty projection even when the target contains authoritative nodes.

The browser must continue loading progressively; returning the complete world would increase startup cost and expose unrelated scopes. Child-domain paths already have one canonical derivation shared by the store and graph probe.

## Goals / Non-Goals

**Goals:**

- Make the data needed by the next direct navigation available before that navigation.
- Preserve exact child-path identity and all scoped node/edge state.
- Keep every response bounded to the requested scope plus one direct lookahead level.

**Non-Goals:**

- Preload the complete Atom world or recursively traverse descendants.
- Add timers, polling, placeholder business nodes, or a second browser cache.
- Change Atom facts, containment, permissions, locks, or user-authored paths.

## Decisions

### Project one child level at the server boundary

The scoped response builds a path set containing the requested path and the canonical child-domain path of each portal on that path, then filters nodes, patches, deletion keys, and edges against the set. The response keeps `scope.path` equal to the explicitly requested path.

This is preferred over delaying the browser's route transition because the latter would require a new asynchronous navigation state machine across search, pointer, keyboard, history, and cluster entry. It is preferred over recursive preload because only the next direct action needs to be instant.

### Keep the prefetched child eligible for its normal request

The bridge marks only the explicitly requested path as loaded. On entry, the child is already renderable, while its normal scoped request still runs and obtains the following lookahead level. This preserves progressive deep navigation without a special prefetch queue.

### Test the externally visible frame

The server contract proves exact scope bounds. A Chromium journey inspects the next animation frame after the entry action and requires all authoritative direct-child labels. This closes the gap left by the old unit test that only proved an eventual request.

## Risks / Trade-offs

- **Larger scoped responses** → Bound growth to one child level and keep deeper descendants excluded by contract tests.
- **Path algorithm drift** → Reuse the existing canonical `childDomainPath` helper rather than duplicating hashing.
- **Cross-domain edges with an unloaded remote endpoint** → Preserve the existing rule of including an edge touching a visible path; the renderer already handles remote endpoints.
- **Performance-test variance** → Treat the first-frame contract separately from raster backdrop thresholds and rerun a lone threshold miss before classifying regression.

## Migration Plan

1. Deploy the server projection and browser acceptance test together.
2. Restart the local Atom service on the exact merged revision.
3. Verify health and projection publication, then measure a cold first entry in the real Web runtime.
4. Roll back the single server projection change if response size or navigation behavior regresses; no Atom facts or persistent schema require migration.
