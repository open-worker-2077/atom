import crypto from 'node:crypto';

const immutableRevisions = new WeakMap();

function updateJsonHash(hash, value, seen, arrayItem = false) {
  if (value && typeof value === 'object' && typeof value.toJSON === 'function') {
    return updateJsonHash(hash, value.toJSON(), seen, arrayItem);
  }
  if (value === null) {
    hash.update('null');
    return true;
  }
  if (typeof value === 'string') {
    hash.update(JSON.stringify(value));
    return true;
  }
  if (typeof value === 'number') {
    hash.update(Number.isFinite(value) ? String(value) : 'null');
    return true;
  }
  if (typeof value === 'boolean') {
    hash.update(value ? 'true' : 'false');
    return true;
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    if (arrayItem) hash.update('null');
    return arrayItem;
  }
  if (typeof value === 'bigint') {
    throw new TypeError('Do not know how to serialize a BigInt');
  }
  if (seen.has(value)) throw new TypeError('Converting circular structure to JSON');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      hash.update('[');
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) hash.update(',');
        updateJsonHash(hash, value[index], seen, true);
      }
      hash.update(']');
      return true;
    }
    hash.update('{');
    let written = 0;
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue;
      if (written > 0) hash.update(',');
      hash.update(JSON.stringify(key));
      hash.update(':');
      updateJsonHash(hash, child, seen);
      written += 1;
    }
    hash.update('}');
    return true;
  } finally {
    seen.delete(value);
  }
}

export function revisionOfWorldFacts(facts) {
  if (!Array.isArray(facts)) {
    const error = new Error('World facts must be an array');
    error.code = 'INVALID_WORLD_FACTS';
    throw error;
  }
  const immutable = Object.isFrozen(facts);
  if (immutable && immutableRevisions.has(facts)) return immutableRevisions.get(facts);
  const hash = crypto.createHash('sha256');
  updateJsonHash(hash, facts, new Set());
  const revision = `sha256:${hash.digest('hex')}`;
  if (immutable) immutableRevisions.set(facts, revision);
  return revision;
}
