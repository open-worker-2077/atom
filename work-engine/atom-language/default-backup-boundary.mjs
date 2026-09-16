import { atomLanguageError } from './errors.mjs';
import { parseAtomKey } from './key-parser.mjs';

export function isTypedDefaultBackupTypes(types) {
  const names = types instanceof Set
    ? types
    : new Set((types ?? []).map((type) => typeof type === 'string' ? type : type?.name));
  return names.has('backup') && names.has('default');
}

function parsedField(atom, baseKey) {
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (parsed.baseKey === baseKey) return { rawKey, parsed, value };
  }
  return null;
}

export function collectDefaultBackupBoundary(atoms) {
  const entriesByPath = new Map();
  const entriesByName = new Map();
  const thingPathByIdentity = new Map();
  const inactiveAtomPaths = new Set();
  const defaultBackupPaths = [];

  function visit(nodes, parentPath = [], insideDefaultBackup = false) {
    for (const atom of Array.isArray(nodes) ? nodes : []) {
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
  return Object.freeze({
    entriesByPath,
    entriesByName,
    thingPathByIdentity,
    inactiveAtomPaths,
    defaultBackupPaths: Object.freeze(defaultBackupPaths)
  });
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
