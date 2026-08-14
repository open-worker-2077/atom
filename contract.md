# Visual Interaction Contract

## Scope

- This build changes the three-dimensional visual interaction carrier only.
- It does not implement business calculation, workflow routing, permissions, approval state, database persistence, or a data-side command language.
- Node and edge editing in this laboratory remains an in-memory interaction proof; an external script layer may later persist the same operations.

## Carrier semantics

- Every node sphere is a traversable tunnel carrier.
- `hasChildren` describes seeded child content only. `false` means an empty child domain, never a terminal entity.
- An empty tunnel may be entered and may receive its first node through the current-domain editor.
- Same-layer expansion shows only real seeded or workspace child nodes and never fabricates content.
- The mirror surface is an independent observation layer. It may cover the interior while the complex tunnel perimeter remains visible.

## Interaction semantics

- Physical buttons are mappings in `input-config.js`, not hard-coded meanings.
- The current desktop preset keeps direct one-step operations: primary click series for use slots, secondary single click for same-layer expansion, secondary double click for domain travel, and middle click for the mirror surface.
- Ctrl + primary click creates or edits a node. Ctrl + secondary click selects relation endpoints. Enter confirms and Esc cancels.
- Navigation does not cancel an unfinished relation draft, so an endpoint may be selected in another domain.

## Spatial layout

- Sibling nodes repel one another and explicit relations constrain their maximum separation, producing stretched chains and open loops instead of a tangled clump.
- Open chains seed along an axis; closed chains seed around a ring.
- Child nodes remain inside their parent radius and cannot move parent-level topology.
- Layout is deterministic and recalculated from graph state. This version does not run a continuous physics simulation.

## Visual discipline

- Near-black blue space, sparse static stars, cold-white type, ice-blue signal light, and restrained violet depth glow.
- No warm brass, amber, brown, blueprint grid, industrial instrument chrome, card-wall composition, cheap glass panels, or full-screen particle motion.
- Gradient light supplies atmosphere without assigning semantic color to the spheres.

## Delivery

- The verified development copy is `spatial-lab-editor-v3`.
- The canonical `spatial-lab` entry is backed up before deployment and receives only the verified build.
- The CLI remains a design blueprint in this iteration and is not globally installed.
