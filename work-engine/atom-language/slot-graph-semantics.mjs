import { parseAtomKey } from './key-parser.mjs';

export const SLOT_ROLE_VERB = '槽模角色';
export const SLOT_REVISION_VERB = '采用槽模修订';
export const SLOT_SYSTEM_VERBS = new Set([SLOT_ROLE_VERB, SLOT_REVISION_VERB]);

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

export function fieldValue(atom, baseKey) {
  return storedField(atom, baseKey)?.value;
}

export function atomName(atom) {
  return fieldValue(atom, 'name');
}

export function atomTypes(atom) {
  return storedField(atom, 'name')?.parsed.types.map((type) => type.raw) ?? [];
}

export function atomDescription(atom) {
  const field = storedField(atom, 'name');
  return field?.parsed.descriptionPresent ? field.parsed.description : null;
}

export function childrenOf(atom) {
  const value = fieldValue(atom, 'children');
  return Array.isArray(value) ? value : null;
}

export function partnersOf(atom) {
  const value = fieldValue(atom, 'partners');
  return Array.isArray(value) ? value : null;
}

export function replaceStoredField(atom, baseKey, value, metadata = {}) {
  const previous = storedField(atom, baseKey);
  const types = metadata.types ?? previous?.parsed.types.map((type) => type.raw) ?? [];
  const descriptionPresent = metadata.descriptionPresent
    ?? previous?.parsed.descriptionPresent
    ?? false;
  const description = metadata.description ?? previous?.parsed.description ?? null;
  const rawKey = `${baseKey}${types.map((type) => `@${type}`).join('')}${
    descriptionPresent ? `#${description}` : ''
  }`;
  for (const key of Object.keys(atom)) {
    if (parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === baseKey) delete atom[key];
  }
  atom[rawKey] = structuredClone(value);
}

export function createAtom({ name, detail = '', children = [], partners = [], types = [], description = null }) {
  const atom = {};
  replaceStoredField(atom, 'name', name, {
    types,
    descriptionPresent: description != null,
    description
  });
  replaceStoredField(atom, 'detail', detail);
  replaceStoredField(atom, 'children', children);
  replaceStoredField(atom, 'partners', partners);
  return atom;
}

export function walkAtoms(atoms) {
  const result = [];
  function visit(atom, parent, index, path) {
    const currentPath = [...path, atomName(atom)];
    const match = { atom, parent, index, path: currentPath };
    result.push(match);
    for (const [childIndex, child] of (childrenOf(atom) ?? []).entries()) {
      visit(child, match, childIndex, currentPath);
    }
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
  } else {
    matches = walkAtoms(atoms).filter((match) => atomName(match.atom) === selector);
  }
  if (matches.length === 0) {
    return { error: { code: 'ATOM_NOT_FOUND', message: `找不到 exact Atom：${selector}`, details: { selector } } };
  }
  if (matches.length > 1) {
    return {
      error: {
        code: 'AMBIGUOUS_ATOM_NAME',
        message: `exact Atom“${selector}”不唯一`,
        details: { selector, paths: matches.map((match) => match.path.join('/')) }
      }
    };
  }
  return { match: matches[0] };
}

export function directChild(parent, name) {
  const matches = (childrenOf(parent) ?? []).filter((child) => atomName(child) === name);
  return matches.length === 1 ? matches[0] : null;
}

export function systemRelation(partner) {
  return SLOT_SYSTEM_VERBS.has(partner?.verb);
}

export function directedSupports(atom) {
  return (partnersOf(atom) ?? []).filter((partner) => !systemRelation(partner));
}

export function relationTarget(atom, verb) {
  return (partnersOf(atom) ?? []).find((partner) => partner?.verb === verb)?.object ?? null;
}

export function setRelation(atom, verb, object) {
  const retained = (partnersOf(atom) ?? []).filter((partner) => partner?.verb !== verb);
  retained.push({ verb, object });
  replaceStoredField(atom, 'partners', retained);
}

export function removeSystemRelations(atom) {
  replaceStoredField(atom, 'partners', (partnersOf(atom) ?? []).filter((partner) => !systemRelation(partner)));
  for (const child of childrenOf(atom) ?? []) removeSystemRelations(child);
}

export const SLOT_GRAPH_SEMANTICS = Object.freeze({
  directChildren: childrenOf,
  directedSupports,
  isSystemRelation: systemRelation
});
