import { isDeepStrictEqual } from 'node:util';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function baseKey(key) {
  return String(key).split('@', 1)[0].split('#', 1)[0];
}

function axisEntry(atom, axis) {
  return Object.entries(atom ?? {}).find(([key]) => baseKey(key) === axis) ?? null;
}

function atomName(atom) {
  return axisEntry(atom, 'thing')?.[1];
}

function childrenOf(atom) {
  const entry = axisEntry(atom, 'slot');
  return Array.isArray(entry?.[1]) ? entry[1] : null;
}

function pathParts(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw problem('INVALID_PATCH_PATH', 'Patch paths must be non-empty strings');
  }
  const parts = value.split('/').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) throw problem('INVALID_PATCH_PATH', 'Patch paths must slot an Atom name');
  return parts;
}

function canonicalPath(value) {
  return pathParts(value).join('/');
}

function minimalPaths(paths) {
  const ordered = [...new Set(paths.map(canonicalPath))].sort((left, right) => (
    left.split('/').length - right.split('/').length || left.localeCompare(right)
  ));
  const roots = [];
  for (const candidate of ordered) {
    if (roots.some((root) => candidate.startsWith(`${root}/`))) continue;
    roots.push(candidate);
  }
  return roots.sort();
}

function locate(facts, rawPath) {
  const parts = pathParts(rawPath);
  let container = facts;
  let atom = null;
  for (const [depth, part] of parts.entries()) {
    if (!Array.isArray(container)) return null;
    const index = container.findIndex((candidate) => atomName(candidate) === part);
    if (index === -1) return null;
    atom = container[index];
    if (depth === parts.length - 1) return { atom, container, index };
    container = childrenOf(atom);
  }
  return null;
}

function operationAtPath(beforeFacts, afterFacts, path) {
  const before = locate(beforeFacts, path);
  const after = locate(afterFacts, path);
  if (!before && !after) {
    throw problem('PATCH_PATH_NOT_FOUND', 'Changed path is absent from both world revisions', { path });
  }
  if (before && after && isDeepStrictEqual(before.atom, after.atom)) return null;
  return Object.freeze({
    path,
    ...(before ? { before: structuredClone(before.atom), beforeIndex: before.index } : {}),
    ...(after ? { after: structuredClone(after.atom), afterIndex: after.index } : {})
  });
}

export function createLocalWorldPatch({
  worldId,
  beforeRevision,
  afterRevision,
  beforeFacts,
  afterFacts,
  changedPaths
}) {
  if (!worldId || !beforeRevision || !afterRevision) {
    throw problem('INVALID_WORLD_PATCH', 'World patch requires world and revision identities');
  }
  if (!Array.isArray(beforeFacts) || !Array.isArray(afterFacts) || !Array.isArray(changedPaths)) {
    throw problem('INVALID_WORLD_PATCH', 'World patch requires fact arrays and changed paths');
  }
  const operations = minimalPaths(changedPaths)
    .map((path) => operationAtPath(beforeFacts, afterFacts, path))
    .filter(Boolean);
  if (!operations.length) {
    throw problem('EMPTY_WORLD_PATCH', 'Local world patch contains no changed Atom');
  }
  const paths = operations.map(({ path }) => path).sort();
  return Object.freeze({
    contract: 'atom.world-patch',
    version: 1,
    worldId,
    beforeRevision,
    afterRevision,
    changedPaths: paths,
    operations
  });
}

export function invertLocalWorldPatch(patch) {
  if (patch?.contract !== 'atom.world-patch' || patch?.version !== 1) {
    throw problem('INVALID_WORLD_PATCH', 'Cannot invert an invalid world patch');
  }
  return Object.freeze({
    contract: patch.contract,
    version: patch.version,
    worldId: patch.worldId,
    beforeRevision: patch.afterRevision,
    afterRevision: patch.beforeRevision,
    changedPaths: [...patch.changedPaths],
    operations: patch.operations.map((operation) => Object.freeze({
      path: operation.path,
      ...(Object.hasOwn(operation, 'after')
        ? { before: structuredClone(operation.after), beforeIndex: operation.afterIndex }
        : {}),
      ...(Object.hasOwn(operation, 'before')
        ? { after: structuredClone(operation.before), afterIndex: operation.beforeIndex }
        : {})
    }))
  });
}

function assertPreimage(actual, expected, path) {
  if (!isDeepStrictEqual(actual, expected)) {
    throw problem('WORLD_PATCH_PREIMAGE_MISMATCH', 'World patch preimage does not match authoritative facts', {
      path
    });
  }
}

export function applyLocalWorldPatch(facts, patch) {
  if (!Array.isArray(facts) || patch?.contract !== 'atom.world-patch' || patch?.version !== 1) {
    throw problem('INVALID_WORLD_PATCH', 'Applying a local patch requires facts and a valid patch');
  }
  const next = structuredClone(facts);
  const replacements = patch.operations.filter((operation) => (
    Object.hasOwn(operation, 'before') && Object.hasOwn(operation, 'after')
  ));
  const removals = patch.operations
    .filter((operation) => Object.hasOwn(operation, 'before') && !Object.hasOwn(operation, 'after'))
    .sort((left, right) => right.path.split('/').length - left.path.split('/').length);
  const additions = patch.operations
    .filter((operation) => !Object.hasOwn(operation, 'before') && Object.hasOwn(operation, 'after'))
    .sort((left, right) => left.path.split('/').length - right.path.split('/').length);

  for (const operation of replacements) {
    const current = locate(next, operation.path);
    if (!current) throw problem('WORLD_PATCH_PREIMAGE_MISSING', 'Patch replacement target is missing', { path: operation.path });
    assertPreimage(current.atom, operation.before, operation.path);
    current.container.splice(current.index, 1, structuredClone(operation.after));
  }
  for (const operation of removals) {
    const current = locate(next, operation.path);
    if (!current) throw problem('WORLD_PATCH_PREIMAGE_MISSING', 'Patch removal target is missing', { path: operation.path });
    assertPreimage(current.atom, operation.before, operation.path);
    current.container.splice(current.index, 1);
  }
  for (const operation of additions) {
    const parts = pathParts(operation.path);
    const name = parts.pop();
    const parentPath = parts.join('/');
    const container = parentPath ? childrenOf(locate(next, parentPath)?.atom) : next;
    if (!Array.isArray(container)) {
      throw problem('WORLD_PATCH_PARENT_MISSING', 'Patch addition parent is missing', { path: operation.path });
    }
    if (container.some((atom) => atomName(atom) === name)) {
      throw problem('WORLD_PATCH_DESTINATION_EXISTS', 'Patch addition destination already exists', { path: operation.path });
    }
    const index = Math.min(operation.afterIndex ?? container.length, container.length);
    container.splice(index, 0, structuredClone(operation.after));
  }
  return next;
}
