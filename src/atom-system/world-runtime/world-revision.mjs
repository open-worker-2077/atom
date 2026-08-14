import crypto from 'node:crypto';

export function revisionOfWorldFacts(facts) {
  if (!Array.isArray(facts)) {
    const error = new Error('World facts must be an array');
    error.code = 'INVALID_WORLD_FACTS';
    throw error;
  }
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex')}`;
}
