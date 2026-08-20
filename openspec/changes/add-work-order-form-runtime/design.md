## Context

Atom already has four authoritative Graph axes, Python-backed `@program`, reusable Program composition, planning helpers, serialized commits, revision conflicts, receipts, rollback, and compacted transaction history. The missing seam is a protected form contract that composes these capabilities without making daily Agents rewrite internals. See `proposal.md` and the three capability specs.

## Goals / Non-Goals

**Goals:**

- Add a small protected form kernel and one editable outer work-order template library.
- Keep generated definitions and instances as ordinary Atom Graph data.
- Let child Programs own local behavior while the root coordinates order-level state.
- Reuse transaction facts for per-Atom history instead of adding per-node log Programs.

**Non-Goals:**

- Merge `@agent` into `@program` in this change.
- Build PM forms, organizational dispatch, multi-order workflow, complex routes, formulas, or a general table clone.
- Add a second field hierarchy or write directly to backing JSON.

## Decisions

### 1. `form()` is a protected runtime capability, not a new Graph key

A Program's Python `detail` invokes `form()` with a JSON-shaped definition. The definition uses `name`, `detail`, `children`, and `partners`; compilation produces ordinary Atoms. This preserves Graph tooling and prevents Web, CLI, and Python from inventing separate schemas.

Alternative rejected: persist `fields` beside `children`. It duplicates containment and creates irreconcilable sources of truth.

### 2. Outer libraries compose the kernel

`work_order()` is a versioned outer-library capability implemented through `form()`. Future ESG, procurement, or PM libraries may compose the same kernel without entering the protected core. Registry names remain stable; callers select an exact version.

### 3. Local execution, structured upward reporting

Output, Step, Criteria and their child Programs evaluate local data themselves. The root consumes their structured reports to derive the work-order state. Exact paths and `partners` remain valid dependency selectors across sibling, upward, and downward directions; short ambiguous names are rejected.

### 4. One interaction, one transactional result set

All effects remain intents under the current immutable revision. They are validated together and committed once. No form helper writes storage, launches CLI, or silently retries an unknown commit.

### 5. Year rings project central logs

Durable write receipts gain affected-Atom linkage and compact changed-axis metadata. Read and Program traces use a separate bounded diagnostic stream. A rebuildable index maps Atom references/paths to both streams. No Atom runs a logging Program, and no unchanged full detail is copied into each event.

### 6. Agent and Program remain orthogonal for this slice

`@agent` remains a context-origin/window marker; `@program` remains executable behavior. Agent-specific rules can be associated through children or partners, but collapsing the types would alter CLI entry resolution and existing facts, so it requires a later dedicated migration proposal.

## Risks / Trade-offs

- **Dynamic Program shape can make old instances ambiguous** → pin every instance to an exact template version and require explicit migration.
- **Cross-direction reads can create hidden coupling** → record dependency selections and require exact paths or explicit partners.
- **Detailed logs can expose content or grow quickly** → durable compact receipts, redacted diagnostics, bounded retention, and rebuildable indexes.
- **Root and child may both write the same fact** → child reports are immutable inputs; only one declared owner may emit each state mutation.
- **A large form kernel can become a second platform** → first implementation supports only the work-order scenarios in the spec.

## Migration Plan

1. Add contracts and tests without changing existing Program or Agent behavior.
2. Introduce the protected kernel behind an opt-in registry entry.
3. Add `work_order()` version 1 and test it under a dedicated top-level test Atom.
4. Extend receipts and build the derived year-ring index; existing receipts remain readable.
5. Enable CLI and Web rendering from the same registry metadata.
6. Roll back by disabling the new registry entries; generated instances remain valid ordinary Atoms.
