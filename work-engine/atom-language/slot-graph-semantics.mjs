import { parseAtomKey } from './key-parser.mjs';

export const SLOT_ROLE_TYPE_PREFIX = 'slot-role-';
export const SLOT_REVISION_TYPE_PREFIX = 'slot-revision-';

export function fieldsByBase(atom) {
  const result = new Map();
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (!result.has(parsed.baseKey)) result.set(parsed.baseKey, []);
    result.get(parsed.baseKey).push({ rawKey, parsed, value });
  }
  return result;
}

export function storedField(atom, baseKey) {
  const matches = fieldsByBase(atom).get(baseKey) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

export const fieldValue = (atom, baseKey) => storedField(atom, baseKey)?.value;
export const atomName = (atom) => fieldValue(atom, 'thing');
export const atomTypes = (atom) => storedField(atom, 'thing')?.parsed.types.map((type) => type.raw) ?? [];
export const publicAtomTypes = (atom) => atomTypes(atom).filter((type) => (
  !type.startsWith(SLOT_ROLE_TYPE_PREFIX) && !type.startsWith(SLOT_REVISION_TYPE_PREFIX)
));
export function atomDescription(atom) {
  const field = storedField(atom, 'thing');
  return field?.parsed.descriptionPresent ? field.parsed.description : null;
}
export function childrenOf(atom) {
  const value = fieldValue(atom, 'slot');
  return Array.isArray(value) ? value : null;
}
export function partnersOf(atom) {
  const value = fieldValue(atom, 'strut');
  return Array.isArray(value) ? value : null;
}

export function replaceStoredField(atom, baseKey, value, metadata = {}) {
  const previous = storedField(atom, baseKey);
  const types = metadata.types ?? previous?.parsed.types.map((type) => type.raw) ?? [];
  const descriptionPresent = metadata.descriptionPresent ?? previous?.parsed.descriptionPresent ?? false;
  const description = metadata.description ?? previous?.parsed.description ?? null;
  const rawKey = `${baseKey}${types.map((type) => `@${type}`).join('')}${descriptionPresent ? `#${description}` : ''}`;
  for (const key of Object.keys(atom)) {
    if (parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === baseKey) delete atom[key];
  }
  atom[rawKey] = structuredClone(value);
}

export function createAtom({ thing, situation = '', slot = [], strut = [], types = [], description = null }) {
  const atom = {};
  replaceStoredField(atom, 'thing', thing, { types, descriptionPresent: description != null, description });
  replaceStoredField(atom, 'situation', situation);
  replaceStoredField(atom, 'slot', slot);
  replaceStoredField(atom, 'strut', strut);
  return atom;
}

export function walkAtoms(atoms) {
  const result = [];
  function visit(atom, parent, index, path) {
    const currentPath = [...path, atomName(atom)];
    const match = { atom, parent, index, path: currentPath };
    result.push(match);
    for (const [childIndex, child] of (childrenOf(atom) ?? []).entries()) visit(child, match, childIndex, currentPath);
  }
  atoms.forEach((atom, index) => visit(atom, null, index, []));
  return result;
}

export function resolveUnique(atoms, selector) {
  let matches;
  if (selector.includes('/')) {
    const parts = selector.split('/').filter(Boolean);
    matches = atoms.map((atom, index) => ({ atom, parent: null, index, path: [atomName(atom)] }))
      .filter((match) => match.path[0] === parts[0]);
    for (const part of parts.slice(1)) {
      matches = matches.flatMap((parent) => (childrenOf(parent.atom) ?? [])
        .map((atom, index) => ({ atom, parent, index, path: [...parent.path, atomName(atom)] }))
        .filter((match) => atomName(match.atom) === part));
    }
  } else matches = walkAtoms(atoms).filter((match) => atomName(match.atom) === selector);
  if (matches.length === 0) return { error: { code: 'ATOM_NOT_FOUND', message: `找不到 exact Atom：${selector}`, details: { selector } } };
  if (matches.length > 1) return { error: {
    code: 'AMBIGUOUS_ATOM_NAME', message: `exact Atom“${selector}”不唯一`,
    details: { selector, paths: matches.map((match) => match.path.join('/')) }
  } };
  return { match: matches[0] };
}

export function directChild(parent, thing) {
  const matches = (childrenOf(parent) ?? []).filter((child) => atomName(child) === thing);
  return matches.length === 1 ? matches[0] : null;
}
export const directedStruts = (atom) => partnersOf(atom) ?? [];

export function roleIdOf(atom) {
  const marker = atomTypes(atom).find((type) => type.startsWith(SLOT_ROLE_TYPE_PREFIX));
  return marker?.slice(SLOT_ROLE_TYPE_PREFIX.length) ?? null;
}
export function setRoleId(atom, roleId) {
  replaceStoredField(atom, 'thing', atomName(atom), {
    types: [...publicAtomTypes(atom), `${SLOT_ROLE_TYPE_PREFIX}${roleId}`],
    descriptionPresent: atomDescription(atom) != null, description: atomDescription(atom)
  });
}
export function instanceRevisionOf(atom) {
  const marker = atomTypes(atom).find((type) => type.startsWith(SLOT_REVISION_TYPE_PREFIX));
  return marker?.slice(SLOT_REVISION_TYPE_PREFIX.length).replace(/^sha256-/u, 'sha256:') ?? null;
}
export function setInstanceRevision(atom, revision) {
  const encoded = revision.replace(/^sha256:/u, 'sha256-');
  const retained = atomTypes(atom).filter((type) => !type.startsWith(SLOT_REVISION_TYPE_PREFIX));
  replaceStoredField(atom, 'thing', atomName(atom), {
    types: [...retained, `${SLOT_REVISION_TYPE_PREFIX}${encoded}`],
    descriptionPresent: atomDescription(atom) != null, description: atomDescription(atom)
  });
}

export const SLOT_GRAPH_SEMANTICS = Object.freeze({
  directChildren: childrenOf, directedStruts, roleIdOf, instanceRevisionOf
});
