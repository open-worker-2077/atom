import { isWorldLawDecision } from './registry.mjs';

function parsedKey(rawKey) {
  const hash = rawKey.indexOf('#');
  const left = hash < 0 ? rawKey : rawKey.slice(0, hash);
  const firstSymbol = left.search(/[@$~]/u);
  const baseKey = firstSymbol < 0 ? left : left.slice(0, firstSymbol);
  const types = [...left.matchAll(/@([^@$~]+)/gu)].map((match) => match[1]);
  return { baseKey, types };
}

function field(atom, baseKey) {
  for (const [key, value] of Object.entries(atom ?? {})) {
    if (parsedKey(key).baseKey === baseKey) return { key, value, types: parsedKey(key).types };
  }
  return null;
}

function atomName(atom) {
  return field(atom, 'thing')?.value ?? null;
}

function atomDetail(atom) {
  return field(atom, 'situation')?.value ?? '';
}

function walk(atoms, parentPath = []) {
  const result = [];
  for (const atom of atoms ?? []) {
    const nameField = field(atom, 'thing');
    const name = nameField?.value;
    if (typeof name !== 'string') continue;
    const path = [...parentPath, name];
    result.push({ atom, name, path: path.join('/'), types: nameField.types });
    const children = field(atom, 'contain')?.value;
    if (Array.isArray(children)) result.push(...walk(children, path));
  }
  return result;
}

function properties(atom) {
  const children = field(atom, 'contain')?.value;
  return new Map((Array.isArray(children) ? children : []).map((child) => [
    atomName(child), atomDetail(child)
  ]));
}

function csv(value, fallback = []) {
  if (typeof value !== 'string') return fallback;
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

export function decodeLockAtoms(atoms) {
  const entries = walk(atoms);
  const resolveReference = (source, reference) => {
    if (reference.includes('/')) {
      return entries.find((candidate) => candidate.path === reference)?.path ?? reference;
    }
    const parent = source.path.includes('/')
      ? source.path.slice(0, source.path.lastIndexOf('/'))
      : '';
    const siblingPath = parent ? `${parent}/${reference}` : reference;
    const sibling = entries.find((candidate) => candidate.path === siblingPath);
    if (sibling) return sibling.path;
    const named = entries.filter((candidate) => candidate.name === reference);
    return named.length === 1 ? named[0].path : reference;
  };
  return entries.filter((entry) => entry.types.includes('lock')).map((entry) => {
    const values = properties(entry.atom);
    const related = (property) => csv(values.get(property))
      .map((reference) => resolveReference(entry, reference));
    return {
      id: entry.name,
      path: entry.path,
      law: values.get('law') || 'atom.lock.basic',
      effect: values.get('effect') || 'seal',
      actions: csv(values.get('actions'), ['read', 'write']),
      scope: values.get('scope') || 'subtree',
      protects: related('protects'),
      appliesTo: related('applies_to'),
      grade: Number(values.get('grade') || 0),
      keyRequirement: values.get('key_requirement') || '',
      enabled: values.get('enabled') !== 'false'
    };
  });
}

function stronger(left, right) {
  const rank = { allow: 0, truncate: 1, deny: 2 };
  return rank[right.decision] > rank[left.decision] ? right : left;
}

export async function evaluateLockAccess(options) {
  const {
    locks = [], registry, operation, window, target, keys = [], lawTimeoutMs = 100
  } = options;
  let result = { decision: 'allow', matchedLocks: [] };
  for (const lock of locks) {
    if (!lock.enabled) continue;
    if (!Array.isArray(lock.actions) || !lock.actions.every((action) => ['read', 'write'].includes(action))
      || !Array.isArray(lock.appliesTo)) {
      return { decision: operation === 'read' ? 'truncate' : 'deny', code: 'LOCK_LAW_FAILED_CLOSED', matchedLocks: [lock.id] };
    }
    if (lock.appliesTo.length && !lock.appliesTo.includes(window)) continue;
    const law = registry.resolve(lock.law);
    if (!law) {
      return {
        decision: operation === 'read' ? 'truncate' : 'deny',
        code: 'LOCK_LAW_FAILED_CLOSED', matchedLocks: [lock.id]
      };
    }
    try {
      const validation = await law.validate(structuredClone(lock));
      if (!validation?.ok) throw new Error(validation?.code || 'invalid lock');
      if (!lock.actions.includes(operation)) continue;
      let timer;
      const decision = await Promise.race([
        Promise.resolve().then(() => law.evaluate(Object.freeze({
          lock: structuredClone(lock), operation, window,
          target: structuredClone(target), keys: structuredClone(keys)
        }))),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('lock law timeout')), lawTimeoutMs);
        })
      ]).finally(() => clearTimeout(timer));
      if (!isWorldLawDecision(decision)) throw new Error('invalid law decision');
      if (decision.decision !== 'allow') {
        result = stronger(result, {
          ...decision,
          matchedLocks: [...result.matchedLocks, lock.id]
        });
      }
    } catch {
      return {
        decision: operation === 'read' ? 'truncate' : 'deny',
        code: 'LOCK_LAW_FAILED_CLOSED', matchedLocks: [lock.id]
      };
    }
  }
  return result;
}
