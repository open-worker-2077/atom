function requireName(value, label) {
  if (typeof value !== 'string' || !value) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export class MatcherRegistry {
  #matchers = new Map();

  register(name, matcher) {
    const key = requireName(name, 'matcher name');
    if (matcher === null || typeof matcher !== 'object' || typeof matcher.match !== 'function') {
      throw new TypeError('matcher must expose a match(candidate, expected) function');
    }
    this.#matchers.set(key, matcher);
    return this;
  }

  has(name) {
    return this.#matchers.has(name);
  }

  resolve(name) {
    return this.#matchers.get(name) ?? null;
  }

  names() {
    return [...this.#matchers.keys()];
  }
}

export function createMatcherRegistry() {
  return new MatcherRegistry().register(
    'exact',
    Object.freeze({
      id: 'exact',
      description: 'P0 exact-name matcher',
      match(candidate, expected) {
        return candidate === expected;
      }
    })
  );
}

export class ActionRegistry {
  #actions = new Map();

  register(baseKey, name, definition = {}) {
    const base = requireName(baseKey, 'base key');
    const action = requireName(name, 'action name');
    this.#actions.set(`${base}\u0000${action}`, Object.freeze({
      parameter: 'none',
      ...definition,
      name: action,
      baseKey: base
    }));
    return this;
  }

  resolve(baseKey, name) {
    return this.#actions.get(`${baseKey}\u0000${name}`) ?? null;
  }

  has(baseKey, name) {
    return this.#actions.has(`${baseKey}\u0000${name}`);
  }

  entries() {
    return [...this.#actions.values()];
  }
}

export function createActionRegistry() {
  const registry = new ActionRegistry();
  registry.register('situation', 'full');
  registry.register('situation', 'lock');
  for (const name of ['latitude', 'longitude']) {
    registry.register('contain', name, { parameter: 'integer' });
  }
  for (const name of ['up', 'down', 'prev', 'next']) {
    registry.register('contain', name, { parameter: 'retiredRoute' });
  }
  registry.register('support', 'hop', { parameter: 'retiredRoute' });
  return registry;
}
