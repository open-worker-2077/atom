import {
  validateProjectionEnvelope,
  validateWorldSnapshot
} from '../public/contracts.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function validateProjectors(projectors) {
  if (!Array.isArray(projectors) || projectors.length === 0) {
    throw problem('INVALID_PROJECTORS', 'At least one projector is required');
  }
  const ids = new Set();
  for (const projector of projectors) {
    if (!projector || typeof projector.id !== 'string' || !projector.id.trim()
      || typeof projector.project !== 'function') {
      throw problem('INVALID_PROJECTOR', 'Each projector requires an id and project function');
    }
    if (ids.has(projector.id)) {
      throw problem('DUPLICATE_PROJECTION_ID', `Projection ${projector.id} is registered twice`);
    }
    ids.add(projector.id);
  }
  return Object.freeze(projectors.map((projector) => Object.freeze({ ...projector })));
}

export function createProjectionPipeline({ projectors: inputProjectors, repository }) {
  const projectors = validateProjectors(inputProjectors);
  if (!repository?.replaceBatch || !repository?.readCurrent) {
    throw problem('INVALID_PROJECTION_REPOSITORY', 'Projection repository must replace and read batches');
  }

  async function rebuild(rawSnapshot) {
    const snapshot = validateWorldSnapshot(rawSnapshot);
    const projections = {};
    try {
      for (const projector of projectors) {
        const isolatedSnapshot = structuredClone(snapshot);
        const value = await projector.project(isolatedSnapshot);
        projections[projector.id] = validateProjectionEnvelope({
          contract: 'atom.projection',
          version: 1,
          projection: projector.id,
          worldId: snapshot.worldId,
          sourceRevision: snapshot.revision,
          value
        });
      }
    } catch (error) {
      throw problem('PROJECTION_BUILD_FAILED', 'Projection batch was not published', {
        cause: error.code ?? error.name
      });
    }

    await repository.replaceBatch({
      worldId: snapshot.worldId,
      sourceRevision: snapshot.revision,
      projections
    });
    return {
      worldId: snapshot.worldId,
      sourceRevision: snapshot.revision,
      projections: projectors.map(({ id }) => id)
    };
  }

  return Object.freeze({ rebuild });
}
