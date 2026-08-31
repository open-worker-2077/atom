## Context

Atom already has two independent fact layers: an Agent declaration carries key labels, while Graph paths carry contain and node lock labels. The access controller can compare those labels, and Agent replacement already has a delegation validator that prevents a replacement from exceeding the caller's authority.

Two additional gates currently interfere with that model. The ordinary Transform window rejects the current Agent before its node lock is evaluated, and passive Program preparation requires a persisted context-free projection even when the projection can be computed from current facts. The result is both a second authorization channel and a disposable-cache availability dependency.

This change spans the access controller, registered Agent replacement, scheduler reuse, runtime startup, persistence warnings, CLI Help, and contract tests. The user-visible contract therefore belongs in OpenSpec, while the concrete acceleration data structure remains an implementation choice.

## Goals / Non-Goals

**Goals**

- Make Agent keys and applicable path locks the single user-visible authorization rule for Explore and Transform.
- Let an Agent reconfigure itself or a descendant through the ordinary Transform path when locks match and the replacement does not escalate authority.
- Preserve correct service on cache miss, stale cache, unreadable cache, or cache persistence failure.
- Allow on-demand evaluation, incremental indexes, precomputation, caches, or a combination when they are observationally equivalent.

**Non-Goals**

- Introduce a parent-only, maintenance, or daily-management authorization channel.
- Change lock declaration syntax, Graph axes, Agent fact formats, or transaction authority.
- Require one permanent permission index layout or eliminate useful caching.
- Permit a replacement Agent declaration to acquire authority the caller does not already hold.

## Decisions

### Use ordinary path authorization for Agent replacement

The default Transform window will admit the current Agent as well as descendants to the generic Graph path authorization stage. Applicable contain and node locks then decide access through the existing label matcher. Replacement source still passes the existing delegation validation before the transaction commits.

This preserves the separation between keys and locks: being the current Agent is neither an automatic allow nor an automatic deny. No special management contract is registered or exposed in Help.

Alternatives rejected:

- A parent-only maintenance channel duplicates authority already represented by locks and prevents a correctly keyed Agent from using its own node lock.
- An unconditional self-edit allowance would bypass locks and is therefore not equivalent to path-label authorization.

### Treat acceleration as a replaceable derived layer

The runtime may retain its current scheduler fast paths: in-memory completed results, reusable dependency-valid results, and persisted projections. On a miss or unusable persisted result, it computes from current facts instead of returning a cache-specific authorization or startup error.

An implementation may later replace or augment these paths with a more efficient dependency index. Such a change does not alter the specification if authorization remains equivalent and relevant fact changes cannot leave stale results authoritative.

Alternatives rejected:

- Requiring a persisted context-free projection at startup turns storage health into authority and availability.
- Removing all caches discards useful acceleration without improving the authorization contract.

### Publish from current in-memory results

Runtime initialization and request preparation use current facts and successfully computed results as the correctness source. Persisting a reusable projection is best-effort: a write failure produces a recoverable operational warning, while normal Graph and spatial publications continue.

Cold-start context-free preparation is also fault-isolated per Program. A Program that needs request context or fails its own fact validation remains explicitly unavailable, but does not prevent the world and unrelated projections from publishing. The same failure remains authoritative when that Program is actually invoked; startup isolation does not convert an invalid Program result into a valid one.

## Risks / Trade-offs

- **Stale accelerated allow:** A cache or index could outlive a relevant key, lock, or path change. Reuse must validate dependency or revision identity; otherwise the runtime falls back to current-fact evaluation.
- **Self-edit escalation:** A valid node key could be mistaken for permission to grant new capabilities. Replacement validation remains mandatory and occurs before commit, preserving the original Agent on failure.
- **Cold-path cost:** Computing on a miss may cost more than a hit. Existing in-memory and persisted fast paths remain available, and future incremental indexing can optimize the same contract.
- **Warning volume:** Repeated persistence failures could generate noise. Warnings should identify the acceleration failure without converting it into a request failure; operational deduplication can be added independently.

## Migration Plan

1. Add contract tests for self-reconfiguration through a matching node lock, denial of authority escalation, cache-miss equivalence, and cold startup under persistence failure.
2. Change the access boundary and runtime fallback while preserving existing Atom facts and persisted formats.
3. Run focused permission, projection lifecycle, legacy runtime composition, CLI contract, and adjacent regression tests.
4. Deploy the exact verified revision and exercise a cold start with unavailable acceleration persistence plus positive and negative Agent reconfiguration cases.
5. If verification fails, roll back the code revision; no Atom data migration or cache conversion is required.
