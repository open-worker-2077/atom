function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

export function createMemoryProjectionRepository() {
  const worlds = new Map();

  async function replaceBatch(batch) {
    if (!batch || typeof batch.worldId !== 'string' || !batch.worldId
      || typeof batch.sourceRevision !== 'string' || !batch.sourceRevision
      || !batch.projections || typeof batch.projections !== 'object') {
      throw problem('INVALID_PROJECTION_BATCH', 'Projection batch is invalid');
    }
    worlds.set(batch.worldId, structuredClone(batch));
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
      projections: structuredClone(batch.projections)
    };
  }

  async function readLatest(worldId) {
    const batch = worlds.get(worldId);
    return batch ? structuredClone(batch) : null;
  }

  return Object.freeze({ replaceBatch, readCurrent, readLatest });
}
