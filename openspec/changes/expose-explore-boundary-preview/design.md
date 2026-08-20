## Context

See `proposal.md` for motivation and `specs/explore-boundary-preview/spec.md` for observable behavior. Coordinate selection already runs in the shared query capability, while `formatAgentEntryContext()` separately computes an entry-only preview from the backing context projection. Ordinary Explore results expose `matches` and optional presentation metadata; CLI then renders those matches as Graph-JSON. Access protection can remove a target or individual read fields from the visible world.

## Goals / Non-Goals

**Goals:**

- Calculate the boundary once in the shared query layer after coordinate selection.
- Keep the estimate aligned with the actual latitude and longitude semantics.
- Preserve existing Atom matches and Program `explore()` list behavior.
- Fail closed when a count would reveal protected names, details, or quantities.

**Non-Goals:**

- Add a new roaming command, cursor, pagination protocol, or query-budget confirmation.
- Make `use_program()`, Form, or application functions define movement syntax.
- Expand longitude into sibling descendant branches; callers re-anchor and then inspect latitude.
- Replace the existing interactive entry presentation in this change.

## Decisions

### 1. Boundary metadata belongs to the query item, not an Atom match

`executeExploreItem()` will return a `boundary` object alongside `matches` and `presentation` for ordinary Explore. This records facts about the response window rather than pretending the preview is persisted Atom data. CLI projects the same object as `boundary~preview`; Web consumers already receive the query item. Program Explore shares the selector implementation but explicitly skips boundary calculation and continues returning `result.matches`, because its list contract discards query-item metadata and dependency revalidation must not pay for unused world-wide estimates.

Alternative rejected: append a synthetic boundary row to `matches`. Helpers and Programs legitimately treat every row as a real Atom with a stable ref, so a synthetic row would corrupt the Graph contract.

### 2. Direction candidates follow the existing coordinate operators

The query layer derives four candidate sets from the exact anchor:

- `up`: ancestors outside the returned set;
- `down`: descendants outside the returned set;
- `left`: preceding direct siblings outside the returned set;
- `right`: following direct siblings outside the returned set.

This makes the preview answer “what can further movement on this axis reveal?” A sibling's descendants are not counted under longitude because reaching them requires re-anchoring on that sibling and moving down.

### 3. Counts describe the current readable snapshot

For a fully readable direction, `nodes` is the number of unreturned candidates and `characters` is the sum of each name plus readable detail. Program source contributes zero detail characters, matching the entry-preview safety rule. `hasMore` is derived from whether the candidate set is non-empty; it is explicit so callers do not infer continuation from numeric fields.

### 4. Any protected candidate makes the direction non-numeric

Boundary estimation requires permission to read the candidate name and, except for Program source, its detail. If any candidate fails those checks, the direction becomes `{state: "protected", hasMore: true}` and omits `nodes` and `characters`. This avoids both content leakage and the false claim that a protected direction is empty.

Alternative rejected: return visible counts as lower bounds. A numeric value would be easy for Agents to mistake for the total and would reintroduce the same false-completeness problem.

## Risks / Trade-offs

- **Every ordinary Explore performs extra directional classification and access checks** → reuse the already prepared world walk and keep calculations linear in the current snapshot; Program Explore skips the unused calculation, and performance tests cover the declared 10k-world budget.
- **Interactive entry and ordinary Explore keep separate presentation code temporarily** → test their common field semantics and defer unification until it can be done without changing the entry layout.
- **Protected state reveals that continuation exists** → expose no name, content, or quantity; this is the minimum signal needed to avoid falsely reporting an empty boundary.

## Migration Plan

Additive query metadata requires no Atom data migration. Rollback reverts the query, CLI, Help, tests, and OpenSpec commit; persisted worlds remain unchanged.
