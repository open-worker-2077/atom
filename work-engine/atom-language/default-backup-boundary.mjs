import { atomLanguageError } from './errors.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { isSealedWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

const preparedWorlds = new WeakMap();
const validatedArchives = new WeakMap();
const completeEntriesByBoundary = new WeakMap();

function traceBoundary(visitedAtoms, reusedArchiveAtoms) {
  if (process.env.ATOM_PERF_TRACE !== '1') return;
  process.stderr.write(`[atom-perf] ${JSON.stringify({
    event: 'default-backup-boundary', visitedAtoms, reusedArchiveAtoms
  })}\n`);
}

export function isTypedDefaultBackupTypes(types) {
  const names = types instanceof Set
    ? types
    : new Set((types ?? []).map((type) => typeof type === 'string' ? type : type?.name));
  return names.has('backup') && names.has('default');
}

function parsedField(atom, baseKey) {
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false, identityContract: 'world-any' });
    if (parsed.baseKey === baseKey) return { rawKey, parsed, value };
  }
  return null;
}

function collectUncachedBoundary(atoms) {
  const entriesByPath = new Map();
  const entriesByName = new Map();
  const thingPathByIdentity = new Map();
  const inactiveAtomPaths = new Set();
  const defaultBackupPaths = [];
  const completeEntries = [];
  let visitedAtoms = 0;

  function visit(nodes, parentPath = [], insideDefaultBackup = false) {
    for (const atom of Array.isArray(nodes) ? nodes : []) {
      visitedAtoms += 1;
      const thingField = parsedField(atom, 'thing');
      const slotField = parsedField(atom, 'slot');
      if (!thingField || typeof thingField.value !== 'string' || !thingField.value) {
        if (insideDefaultBackup) visit(slotField?.value, parentPath, true);
        continue;
      }
      const path = [...parentPath, thingField.value];
      const pathText = path.join('/');
      const defaultBackup = !thingField.parsed.errors.length
        && isTypedDefaultBackupTypes(thingField.parsed.types);
      const inactive = insideDefaultBackup || defaultBackup;
      const entry = Object.freeze({
        atom,
        name: thingField.value,
        path: pathText,
        pathParts: Object.freeze(path),
        identity: thingField.parsed.identity ?? null,
        inactive,
        defaultBackup
      });
      completeEntries.push(entry);
      entriesByPath.set(pathText, entry);
      if (!entriesByName.has(entry.name)) entriesByName.set(entry.name, []);
      entriesByName.get(entry.name).push(entry);
      if (inactive) inactiveAtomPaths.add(pathText);
      if (defaultBackup) defaultBackupPaths.push(pathText);
      if (entry.identity) {
        if (thingPathByIdentity.has(entry.identity)) {
          throw atomLanguageError(
            'DUPLICATE_THING_IDENTITY',
            '多个 Thing 使用了同一内核身份',
            { identity: entry.identity, paths: [thingPathByIdentity.get(entry.identity), pathText] }
          );
        }
        thingPathByIdentity.set(entry.identity, pathText);
      }
      visit(slotField?.value, path, inactive);
    }
  }

  visit(atoms);
  if (defaultBackupPaths.length > 1) {
    throw atomLanguageError(
      'AMBIGUOUS_DEFAULT_BACKUP',
      'World contains multiple typed default backup roots',
      { paths: defaultBackupPaths }
    );
  }
  traceBoundary(visitedAtoms, 0);
  const boundary = Object.freeze({
    entriesByPath,
    entriesByName,
    thingPathByIdentity,
    inactiveAtomPaths,
    defaultBackupPaths: Object.freeze(defaultBackupPaths)
  });
  completeEntriesByBoundary.set(boundary, completeEntries);
  return boundary;
}

function readonlyLookup(map) {
  return Object.freeze({ get: (key) => map.get(key), has: (key) => map.has(key) });
}

function readonlyMembership(set) {
  return Object.freeze({ has: (key) => set.has(key) });
}

function frozenView(boundary) {
  for (const entries of boundary.entriesByName.values()) Object.freeze(entries);
  return Object.freeze({
    entriesByPath: readonlyLookup(boundary.entriesByPath),
    entriesByName: readonlyLookup(boundary.entriesByName),
    thingPathByIdentity: readonlyLookup(boundary.thingPathByIdentity),
    inactiveAtomPaths: readonlyMembership(boundary.inactiveAtomPaths),
    defaultBackupPaths: boundary.defaultBackupPaths
  });
}

function archiveProof(boundary) {
  if (boundary.defaultBackupPaths.length !== 1) return null;
  const completeEntries = completeEntriesByBoundary.get(boundary);
  if (boundary.entriesByPath.size !== completeEntries.length) return null;
  const path = boundary.defaultBackupPaths[0];
  const rootEntry = completeEntries.find((entry) => entry.defaultBackup && entry.path === path);
  if (!rootEntry) return null;
  const root = rootEntry.atom;
  const entries = completeEntries.filter((entry) => (
    rootEntry.pathParts.every((part, index) => entry.pathParts[index] === part)
  ));
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const entriesByName = new Map();
  const thingPathByIdentity = new Map();
  const inactiveAtomPaths = new Set();
  for (const entry of entries) {
    if (!entriesByName.has(entry.name)) entriesByName.set(entry.name, []);
    entriesByName.get(entry.name).push(entry);
    if (entry.identity) thingPathByIdentity.set(entry.identity, entry.path);
    if (entry.inactive) inactiveAtomPaths.add(entry.path);
  }
  for (const entries of entriesByName.values()) Object.freeze(entries);
  const orderByEntry = new Map(entries.map((entry, index) => [entry, index]));
  return { root, path, pathParts: rootEntry.pathParts, entries, entriesByPath, entriesByName, thingPathByIdentity,
    inactiveAtomPaths, orderByEntry, count: entries.length };
}

function collectWithArchiveProof(atoms) {
  const entriesByPath = new Map();
  const activeEntries = [];
  const entriesByName = new Map();
  const thingPathByIdentity = new Map();
  const inactiveAtomPaths = new Set();
  const activeOrders = new Map();
  let proof = null;
  let archiveOrder = -1;
  let ordinal = 0;
  let visitedAtoms = 0;
  let invalidated = false;

  function visit(nodes, parentPath = []) {
    for (const atom of Array.isArray(nodes) ? nodes : []) {
      visitedAtoms += 1;
      const thingField = parsedField(atom, 'thing');
      const slotField = parsedField(atom, 'slot');
      if (!thingField || typeof thingField.value !== 'string' || !thingField.value) continue;
      const path = [...parentPath, thingField.value];
      const pathText = path.join('/');
      const defaultBackup = !thingField.parsed.errors.length
        && isTypedDefaultBackupTypes(thingField.parsed.types);
      if (defaultBackup) {
        const candidate = validatedArchives.get(atom);
        if (!candidate || candidate.path !== pathText
          || candidate.pathParts.length !== path.length
          || candidate.pathParts.some((part, index) => part !== path[index]) || proof) {
          invalidated = true;
          return;
        }
        proof = candidate;
        archiveOrder = ordinal;
        ordinal += proof.count;
        continue;
      }
      const entry = Object.freeze({
        atom, name: thingField.value, path: pathText, pathParts: Object.freeze(path),
        identity: thingField.parsed.identity ?? null, inactive: false, defaultBackup: false
      });
      activeEntries.push(entry);
      entriesByPath.set(pathText, entry);
      activeOrders.set(entry, ordinal++);
      if (!entriesByName.has(entry.name)) entriesByName.set(entry.name, []);
      entriesByName.get(entry.name).push(entry);
      if (entry.identity) {
        if (thingPathByIdentity.has(entry.identity)) {
          invalidated = true;
          return;
        }
        thingPathByIdentity.set(entry.identity, pathText);
      }
      visit(slotField?.value, path);
      if (invalidated) return;
    }
  }
  visit(atoms);
  if (invalidated || !proof) return null;
  if (activeEntries.some((entry) => proof.entriesByPath.has(entry.path))) return null;
  for (const identity of thingPathByIdentity.keys()) {
    if (proof.thingPathByIdentity.has(identity)) return null;
  }
  for (const entries of entriesByName.values()) Object.freeze(entries);
  const entryOrder = (entry) => activeOrders.get(entry)
    ?? archiveOrder + proof.orderByEntry.get(entry);
  const combinedNames = new Map();
  const lookup = (active, archived) => Object.freeze({
    get: (key) => active.get(key) ?? archived.get(key),
    has: (key) => active.has(key) || archived.has(key)
  });
  const view = Object.freeze({
    entriesByPath: lookup(entriesByPath, proof.entriesByPath),
    entriesByName: Object.freeze({ get(name) {
      if (!entriesByName.has(name) && !proof.entriesByName.has(name)) return undefined;
      if (!combinedNames.has(name)) {
        combinedNames.set(name, Object.freeze([
          ...(entriesByName.get(name) ?? []), ...(proof.entriesByName.get(name) ?? [])
        ].sort((a, b) => entryOrder(a) - entryOrder(b))));
      }
      return combinedNames.get(name);
    } }),
    thingPathByIdentity: lookup(thingPathByIdentity, proof.thingPathByIdentity),
    inactiveAtomPaths: readonlyMembership(proof.inactiveAtomPaths),
    defaultBackupPaths: Object.freeze([proof.path])
  });
  traceBoundary(visitedAtoms, proof.count);
  return { view, parts: [activeEntries, proof.entries], entryOrder };
}

function preparedBoundary(atoms) {
  if (!isSealedWorldFacts(atoms)) return { view: collectUncachedBoundary(atoms), parts: null };
  const cached = preparedWorlds.get(atoms);
  if (cached) return cached;
  const reused = collectWithArchiveProof(atoms);
  if (reused) {
    preparedWorlds.set(atoms, reused);
    return reused;
  }
  const boundary = collectUncachedBoundary(atoms);
  const proof = archiveProof(boundary);
  if (proof) validatedArchives.set(proof.root, proof);
  const completeEntries = completeEntriesByBoundary.get(boundary);
  const entryOrders = new Map(completeEntries.map((entry, index) => [entry, index]));
  const prepared = { view: frozenView(boundary), parts: [completeEntries],
    entryOrder: (entry) => entryOrders.get(entry) };
  preparedWorlds.set(atoms, prepared);
  return prepared;
}

export function preparedDefaultBackupBoundary(atoms) {
  return preparedBoundary(atoms).view;
}

// A root is reusable only at the exact topology validated in a sealed world.
// No boundary entries, caller trust flag, or mutable proof object escapes.
export function hasValidatedDefaultBackupArchiveAt(atom, pathParts) {
  const proof = validatedArchives.get(atom);
  return Boolean(proof && Array.isArray(pathParts)
    && proof.pathParts.length === pathParts.length
    && proof.pathParts.every((part, index) => part === pathParts[index]));
}

export function collectDefaultBackupBoundary(atoms) {
  const prepared = preparedBoundary(atoms);
  if (!prepared.parts) return prepared.view;
  const entries = prepared.parts.flat()
    .sort((a, b) => prepared.entryOrder(a) - prepared.entryOrder(b));
  const entriesByPath = new Map();
  const entriesByName = new Map();
  const thingPathByIdentity = new Map();
  const inactiveAtomPaths = new Set();
  for (const entry of entries) {
    entriesByPath.set(entry.path, entry);
    if (!entriesByName.has(entry.name)) entriesByName.set(entry.name, []);
    entriesByName.get(entry.name).push(entry);
    if (entry.identity) thingPathByIdentity.set(entry.identity, entry.path);
    if (entry.inactive) inactiveAtomPaths.add(entry.path);
  }
  return Object.freeze({ entriesByPath, entriesByName, thingPathByIdentity,
    inactiveAtomPaths, defaultBackupPaths: Object.freeze([...prepared.view.defaultBackupPaths]) });
}

export function resolveBoundarySelector(boundary, selector, sourceAtomPath, rootThing) {
  if (!boundary || typeof selector !== 'string' || typeof sourceAtomPath !== 'string') return null;
  const rootPrefix = `${rootThing}/`;
  const normalized = selector.startsWith(rootPrefix) ? selector.slice(rootPrefix.length) : selector;
  const sourceParts = sourceAtomPath.split('/');
  if (normalized === '.') return boundary.entriesByPath.get(sourceAtomPath) ?? null;
  if (normalized.startsWith('./')) {
    const relative = normalized.slice(2);
    return boundary.entriesByPath.get([...sourceParts.slice(0, -1), ...relative.split('/')].join('/'))
      ?? null;
  }
  if (normalized.includes('/')) {
    return boundary.entriesByPath.get(normalized) ?? null;
  }
  const sibling = boundary.entriesByPath.get([...sourceParts.slice(0, -1), normalized].join('/'));
  if (sibling) return sibling;
  const candidates = boundary.entriesByName.get(normalized) ?? [];
  for (let depth = sourceParts.length - 2; depth >= 0; depth -= 1) {
    const domain = sourceParts.slice(0, depth + 1);
    const scoped = candidates.filter((candidate) => (
      domain.every((part, index) => candidate.pathParts[index] === part)
    ));
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1) {
      throw atomLanguageError(
        'AMBIGUOUS_STRUT_SELECTOR',
        `selector 在最近当前域内名称不唯一：${normalized}`,
        { selector: normalized, domain: domain.join('/'), candidates: scoped.map(({ path }) => path) }
      );
    }
  }
  if (candidates.length > 1) {
    throw atomLanguageError(
      'AMBIGUOUS_STRUT_SELECTOR',
      `selector 名称不唯一：${normalized}`,
      { selector: normalized, candidates: candidates.map(({ path }) => path) }
    );
  }
  return candidates[0] ?? null;
}

export function isInsideDefaultBackupPath(atomPath, inactiveAtomPaths) {
  return typeof atomPath === 'string' && inactiveAtomPaths?.has(atomPath);
}
