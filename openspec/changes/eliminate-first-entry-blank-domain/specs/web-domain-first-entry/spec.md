## Purpose

Guarantees that entering an unloaded Atom Web domain produces an authoritative, non-empty first frame while keeping progressive spatial data loading bounded to one direct level.

## ADDED Requirements

### Requirement: Scoped state provides one-level lookahead
The spatial state endpoint SHALL return the requested path and every direct child domain of portal nodes on that path. It MUST NOT include nodes from deeper descendant domains solely because of lookahead.

#### Scenario: Direct child scope is prefetched
- **WHEN** a client requests spatial state for a path containing a portal with authoritative children
- **THEN** the response contains the portal and the nodes whose path is that portal's direct child-domain path

#### Scenario: Grandchild scope remains progressive
- **WHEN** a direct child node is itself a portal with deeper descendants
- **THEN** the response does not include nodes from that grandchild domain until the client requests the direct child path

### Requirement: First entered frame is not an empty target domain
Atom Web SHALL render authoritative nodes in the first visual frame after switching to a prefetched child domain. It MUST NOT depend on refresh, re-entry, polling, or a later duplicate view event to make those nodes visible.

#### Scenario: First entry has visible nodes
- **WHEN** a user enters a portal whose direct child scope arrived with the parent state
- **THEN** the next visual frame uses that authoritative child scope and contains its nodes

### Requirement: Lookahead preserves scoped facts
The one-level response SHALL include node patches, deleted-node keys, and edges relevant to the requested and directly prefetched paths so the first frame does not present stale node or relation state.

#### Scenario: Child relation is visible on first entry
- **WHEN** authoritative nodes in a prefetched child scope have an edge touching that scope
- **THEN** the scoped response includes the edge and the first entered frame can render the authoritative relation
