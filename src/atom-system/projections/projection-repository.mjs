function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (value instanceof Map || value instanceof Set) return Object.freeze(value);
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

export function createMemoryProjectionRepository(options = {}) {
  const worlds = new Map();
  const immutableReferences = options.immutableReferences === true;

  async function replaceBatch(batch) {
    if (!batch || typeof batch.worldId !== 'string' || !batch.worldId
      || typeof batch.sourceRevision !== 'string' || !batch.sourceRevision
      || !batch.projections || typeof batch.projections !== 'object') {
      throw problem('INVALID_PROJECTION_BATCH', 'Projection batch is invalid');
    }
    worlds.set(batch.worldId, immutableReferences
      ? freezeTree(batch)
      : structuredClone(batch));
  }

  async function readCurrent(worldId, requestedRevision) {
    const batch = worlds.get(worldId);
    if (!batch || batch.sourceRevision !== requestedRevision) {
      return {
        current: false,
        worldId,
        requestedRevision,
        ...(batch ? { availableRevision: batch.sourceRevision } : {})
      };
    }
    return {
      current: true,
      worldId,
      sourceRevision: batch.sourceRevision,
      projections: immutableReferences ? batch.projections : structuredClone(batch.projections)
    };
  }

  async function readLatest(worldId) {
    const batch = worlds.get(worldId);
    return batch ? (immutableReferences ? batch : structuredClone(batch)) : null;
  }

  return Object.freeze({ replaceBatch, readCurrent, readLatest });
}
