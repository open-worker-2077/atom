function canonicalPath(value) {
  if (typeof value !== 'string') return '';
  return value.split('/').map((part) => part.trim()).filter(Boolean).join('/');
}

function axisEntry(atom, axis) {
  return Object.entries(atom ?? {}).find(([key]) => (
    String(key).split('@', 1)[0].split('#', 1)[0] === axis
  )) ?? null;
}

function atomName(atom) {
  return axisEntry(atom, 'thing')?.[1];
}

function childrenOf(atom) {
  const value = axisEntry(atom, 'contain')?.[1];
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
  shortcutPaths = []
} = {}) {
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
  for (const path of relationEndpoints) add(path, 'relation-endpoint');
  for (const path of lockPaths) {
    add(path, 'lock');
    addAncestors(path);
  }
  for (const path of shortcutPaths) add(path, 'shortcut');

  const paths = [...reasons.keys()].sort();
  return Object.freeze({
    paths,
    entries: paths.map((path) => Object.freeze({
      path,
      reasons: [...reasons.get(path)].sort()
    }))
  });
}
