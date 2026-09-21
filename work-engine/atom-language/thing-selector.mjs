import { diagnostic } from './errors.mjs';
import { matchesExactSelector } from './exact-selector.mjs';
import { storedField } from './slot-graph-semantics.mjs';
import { parseShortThingId } from './thing-id-allocator.mjs';

export function parseThingSelector(selector) {
  if (typeof selector !== 'string' || !selector.startsWith('@')) {
    return { kind: 'semantic', selector };
  }
  try {
    return { kind: 'identity', identity: parseShortThingId(selector.slice(1)).id };
  } catch (error) {
    return {
      kind: 'invalid-identity',
      error: diagnostic(
        error?.code === 'RESERVED_THING_ID' ? 'RESERVED_THING_ID' : 'INVALID_THING_ID_SELECTOR',
        'Thing identity selector is invalid'
      )
    };
  }
}

export function resolveThingSelector(candidates, parsedSelector) {
  if (parsedSelector?.kind === 'invalid-identity') return { error: parsedSelector.error };
  const matches = parsedSelector?.kind === 'identity'
    ? candidates.filter(candidate => (
        storedField(candidate.atom, 'thing')?.parsed.identity === parsedSelector.identity
      ))
    : candidates.filter(candidate => matchesExactSelector(
        candidate.path,
        storedField(candidate.atom, 'thing')?.value,
        parsedSelector?.selector
      ));
  if (matches.length === 0) {
    return { error: diagnostic('ATOM_NOT_FOUND', '找不到 exact Atom') };
  }
  if (matches.length > 1) {
    return { error: diagnostic(
      parsedSelector?.kind === 'identity' ? 'DUPLICATE_THING_IDENTITY' : 'AMBIGUOUS_ATOM_NAME',
      parsedSelector?.kind === 'identity' ? 'Thing identity is not unique' : 'exact Atom 不唯一'
    ) };
  }
  return { match: matches[0] };
}
