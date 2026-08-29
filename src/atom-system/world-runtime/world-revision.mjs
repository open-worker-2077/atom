import crypto from 'node:crypto';

const immutableRevisions = new WeakMap();
const immutableSerializations = new WeakMap();

function freezeWorldFacts(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeWorldFacts(child);
  return Object.freeze(value);
}

export function revisionOfWorldFacts(facts) {
  if (!Array.isArray(facts)) {
    const error = new Error('World facts must be an array');
    error.code = 'INVALID_WORLD_FACTS';
    throw error;
  }
  const immutable = Object.isFrozen(facts);
  return prepareWorldFactsRevision(facts).revision;
}

export function sealWorldFactsRevision(facts) {
  freezeWorldFacts(facts);
  return revisionOfWorldFacts(facts);
}

export function prepareWorldFactsRevision(facts) {
  if (!Array.isArray(facts)) {
    const error = new Error('World facts must be an array');
    error.code = 'INVALID_WORLD_FACTS';
    throw error;
  }
  const immutable = Object.isFrozen(facts);
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
