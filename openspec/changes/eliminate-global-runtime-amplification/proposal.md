## Why

Atom has reached roughly ten thousand nodes, but a local `explore` still scans and hashes the complete world and republishes a complete Web projection, while one write rewrites the complete transaction history. This global amplification makes ordinary reads take seconds, serializes concurrent users, and leaves Program cycles close to their ten-second budget just as production usage is increasing.

## What Changes

- Make read-only Atom commands operate on a revision-bound in-memory snapshot and return without publishing or persisting projections.
- Separate immutable concurrent reads from the single serialized write/commit path.
- Replace whole-file transaction-history rewrites with append-oriented, content-addressed history while retaining recovery and rollback compatibility.
- Keep projections derived and replaceable: publish only after a committed fact change, and make current consumers compatible with an in-memory projection boundary.
- Remove residual whole-world Program work from unmatched indexed trigger events and bound matched effect application to one prepared revision.
- Add performance and compatibility gates for real-world-scale reads, writes, restart recovery, rollback, CLI, and Web consumers.

## Capabilities

### New Capabilities

- `localized-runtime-reads`: Revision-bound local reads, concurrent read execution, and change-driven projection publication.
- `incremental-world-history`: Append-oriented transaction persistence with crash recovery, rollback, and legacy-journal compatibility.
- `event-indexed-program-runtime`: Event-local Program selection and bounded effect application without unrelated whole-world execution.

### Modified Capabilities

None. The main spec catalog is currently empty; this change establishes the runtime contracts without changing Atom language syntax.

## Impact

- Affects the 4784 command server, interaction runtime, world repository, transaction coordinator, Program scheduler, projection publication, and their tests.
- Preserves `atom.json` as the authoritative fact source and preserves existing CLI, Web, Program, rollback, and recovery contracts.
- Existing `graph.json`, `knowledge.json`, and monolithic transaction journals remain readable during migration but cease to be rewritten by read-only interactions.
