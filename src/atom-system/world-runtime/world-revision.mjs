import crypto from 'node:crypto';
import { types } from 'node:util';

const immutableRevisions = new WeakMap();
const immutableSerializations = new WeakMap();
const sealedWorldFacts = new WeakSet();

function invalidFacts() {
  const error = new Error('World facts must contain only plain JSON data');
  error.code = 'INVALID_WORLD_FACTS';
  return error;
}

function freezeWorldFacts(value, active = new WeakSet(), validated = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || types.isProxy(value) || active.has(value)) {
    throw invalidFacts();
  }
  if (validated.has(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (array ? prototype !== Array.prototype
    : prototype !== Object.prototype && prototype !== null) throw invalidFacts();
  active.add(value);
  let elementCount = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string') throw invalidFacts();
    if (array) {
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.length
        || String(index) !== key) throw invalidFacts();
      elementCount += 1;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalidFacts();
    freezeWorldFacts(descriptor.value, active, validated);
  }
  if (array && elementCount !== value.length) throw invalidFacts();
  active.delete(value);
  validated.add(value);
  return Object.freeze(value);
}

export function revisionOfWorldFacts(facts) {
  if (!Array.isArray(facts)) {
    const error = new Error('World facts must be an array');
    error.code = 'INVALID_WORLD_FACTS';
    throw error;
  }
  return prepareWorldFactsRevision(facts).revision;
}

export function sealWorldFactsRevision(facts) {
  if (sealedWorldFacts.has(facts)) return revisionOfWorldFacts(facts);
  freezeWorldFacts(facts);
  sealedWorldFacts.add(facts);
  return revisionOfWorldFacts(facts);
}

export function isSealedWorldFacts(facts) {
  return Array.isArray(facts) && sealedWorldFacts.has(facts);
}

export function prepareWorldFactsRevision(facts) {
  if (!Array.isArray(facts)) {
    const error = new Error('World facts must be an array');
    error.code = 'INVALID_WORLD_FACTS';
    throw error;
  }
  const immutable = sealedWorldFacts.has(facts);
  if (immutable && immutableRevisions.has(facts) && immutableSerializations.has(facts)) {
    return {
      revision: immutableRevisions.get(facts),
      json: immutableSerializations.get(facts)
    };
  }
  const json = JSON.stringify(facts);
  const revision = `sha256:${crypto.createHash('sha256').update(json).digest('hex')}`;
  if (immutable) {
    immutableRevisions.set(facts, revision);
    immutableSerializations.set(facts, json);
  }
  return { revision, json };
}
