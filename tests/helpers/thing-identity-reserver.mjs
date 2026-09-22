import { storedField, walkAtoms } from '../../work-engine/atom-language/slot-graph-semantics.mjs';
import {
  createThingIdAllocationSession,
  parseShortThingId,
  thingIdForOrdinal
} from '../../work-engine/atom-language/thing-id-allocator.mjs';

// Direct kernel callers must reserve identities from the world's own watermark;
// short ids are never invented or derived from the caller's position.
export function thingIdentityReserverFor(atoms = []) {
  const highestOrdinal = walkAtoms(atoms).reduce((ordinal, { atom }) => {
    const identity = storedField(atom, 'thing')?.parsed.identity;
    if (!identity) return ordinal;
    try {
      return Math.max(ordinal, parseShortThingId(identity).ordinal);
    } catch {
      return ordinal;
    }
  }, 0);
  const session = createThingIdAllocationSession(
    highestOrdinal > 0 ? thingIdForOrdinal(highestOrdinal) : '000'
  );
  return (count) => session.reserve(count);
}
