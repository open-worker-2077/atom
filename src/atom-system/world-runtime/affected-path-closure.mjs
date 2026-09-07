function canonicalPath(value) {
  if (typeof value !== 'string') return '';
  return value.split('/').map((part) => part.trim()).filter(Boolean).join('/');
}

function axisEntry(atom, axis) {
  return Object.entries(atom ?? {}).find(([key]) => (
    (String(key).match(/^[^@&#$~]+/u)?.[0] ?? '') === axis
  )) ?? null;
}

function atomName(atom) {
  return axisEntry(atom, 'thing')?.[1];
}

function childrenOf(atom) {
  const value = axisEntry(atom, 'slot')?.[1];
  return Array.isArray(value) ? value : [];
}

function subtreePaths(atom, rootPath) {
  const paths = [];
  const visit = (current, currentPath) => {
    paths.push(currentPath);
    for (const child of childrenOf(current)) {
      const name = atomName(child);
      if (typeof name === 'string' && name) visit(child, `${currentPath}/${name}`);
    }
  };
  visit(atom, rootPath);
  return paths;
}

export function createAffectedPathClosure({
  changedPaths = [],
  patch = null,
  relationEndpoints = [],
  lockPaths = [],
  shortcutPaths = [],
  referencePaths = [],
  complete = false
} = {}) {
  const validPathList = (values) => Array.isArray(values)
    && values.every((value) => typeof value === 'string' && canonicalPath(value));
  const validLockList = Array.isArray(lockPaths) && lockPaths.every((value) => (
    (typeof value === 'string' && canonicalPath(value))
    || (value && typeof value === 'object' && canonicalPath(value.path)
      && ['exact', 'subtree'].includes(value.scope))
  ));
  const reasons = new Map();
  const add = (rawPath, reason) => {
    const path = canonicalPath(rawPath);
    if (!path) return;
    const existing = reasons.get(path) ?? new Set();
    existing.add(reason);
    reasons.set(path, existing);
  };
  const addAncestors = (rawPath) => {
    const parts = canonicalPath(rawPath).split('/').filter(Boolean);
    for (let depth = 1; depth < parts.length; depth += 1) {
      add(parts.slice(0, depth).join('/'), 'authorization-ancestor');
    }
  };

  for (const path of changedPaths) {
    add(path, 'changed');
    addAncestors(path);
  }
  for (const operation of patch?.operations ?? []) {
    for (const [atom, rootPath] of [
      [operation.before, operation.path],
      [operation.after, operation.path]
    ]) {
      if (!atom) continue;
      for (const path of subtreePaths(atom, rootPath)) add(path, 'changed-subtree');
    }
  }
  for (const path of Array.isArray(relationEndpoints) ? relationEndpoints : []) add(path, 'relation-endpoint');
  for (const lock of Array.isArray(lockPaths) ? lockPaths : []) {
    const path = typeof lock === 'string' ? lock : lock?.path;
    add(path, typeof lock === 'object' && lock?.scope === 'exact' ? 'lock-exact' : 'lock-subtree');
    addAncestors(path);
  }
  for (const path of Array.isArray(shortcutPaths) ? shortcutPaths : []) add(path, 'shortcut');
  for (const path of Array.isArray(referencePaths) ? referencePaths : []) add(path, 'reference');

  const paths = [...reasons.keys()].sort();
  return Object.freeze({
    contract: 'atom.affected-path-closure',
    version: 1,
    complete: complete === true
      && validPathList(relationEndpoints)
      && validLockList
      && validPathList(shortcutPaths)
      && validPathList(referencePaths),
    paths,
    entries: paths.map((path) => Object.freeze({
      path,
      reasons: [...reasons.get(path)].sort()
    }))
  });
}
