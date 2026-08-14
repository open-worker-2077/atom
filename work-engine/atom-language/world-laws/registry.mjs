const VALID_DECISIONS = new Set(['allow', 'truncate', 'deny']);

function assertLaw(law) {
  if (!law || typeof law !== 'object') throw new TypeError('law must be an object');
  for (const field of ['id', 'version']) {
    if (typeof law[field] !== 'string' || !law[field]) {
      throw new TypeError(`law ${field} must be a non-empty string`);
    }
  }
  if (typeof law.validate !== 'function' || typeof law.evaluate !== 'function') {
    throw new TypeError('law must expose validate and evaluate functions');
  }
}

export class WorldLawRegistry {
  #laws = new Map();

  register(law) {
    assertLaw(law);
    if (this.#laws.has(law.id)) throw new Error(`duplicate world law: ${law.id}`);
    this.#laws.set(law.id, Object.freeze({ ...law }));
    return this;
  }

  resolve(id) {
    return this.#laws.get(id) ?? null;
  }

  names() {
    return [...this.#laws.keys()];
  }
}

function pathWithin(path, root, scope) {
  if (path === root) return true;
  return scope === 'subtree' && path.startsWith(`${root}/`);
}

function keyOpens(lock, keys, operation, target) {
  if (!lock.keyRequirement) return false;
  return keys.some((key) => (
    key?.id === lock.keyRequirement
    && Number.isFinite(key.grade)
    && key.grade >= lock.grade
    && (!Array.isArray(key.actions) || key.actions.includes(operation))
    && (!Array.isArray(key.scopes)
      || key.scopes.length === 0
      || key.scopes.some((scope) => pathWithin(target.path, scope, 'subtree')))
  ));
}

export const basicLockLaw = Object.freeze({
  id: 'atom.lock.basic',
  version: '1.0.0',
  validate(lock) {
    const ok = ['fence', 'seal'].includes(lock.effect)
      && ['node', 'subtree'].includes(lock.scope)
      && Array.isArray(lock.protects)
      && lock.protects.length > 0;
    return ok ? { ok: true } : { ok: false, code: 'INVALID_BASIC_LOCK' };
  },
  evaluate({ lock, operation, target, keys = [] }) {
    const applicableAction = lock.actions.includes(operation);
    if (!applicableAction || keyOpens(lock, keys, operation, target)) {
      return { decision: 'allow' };
    }
    const inside = lock.protects.some((root) => pathWithin(target.path, root, lock.scope));
    if (lock.effect === 'seal') {
      return { decision: inside ? (operation === 'read' ? 'truncate' : 'deny') : 'allow' };
    }
    return { decision: inside ? 'allow' : (operation === 'read' ? 'truncate' : 'deny') };
  }
});

export function isWorldLawDecision(value) {
  return Boolean(value && VALID_DECISIONS.has(value.decision));
}

export function createDefaultWorldLawRegistry() {
  return new WorldLawRegistry().register(basicLockLaw);
}
