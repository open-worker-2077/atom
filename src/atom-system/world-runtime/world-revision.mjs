import crypto from 'node:crypto';

const immutableRevisions = new WeakMap();

export function revisionOfWorldFacts(facts) {
  if (!Array.isArray(facts)) {
    const error = new Error('World facts must be an array');
    error.code = 'INVALID_WORLD_FACTS';
    throw error;
  }
  const immutable = Object.isFrozen(facts);
  if (immutable && immutableRevisions.has(facts)) return immutableRevisions.get(facts);
  const revision = `sha256:${crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex')}`;
  if (immutable) immutableRevisions.set(facts, revision);
  return revision;
}
