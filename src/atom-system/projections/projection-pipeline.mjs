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
      || typeof projector.project !== 'function'
      || (projector.affectedBy !== undefined && typeof projector.affectedBy !== 'function')) {
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

  async function rebuild(rawSnapshot, options = {}) {
    const snapshot = validateWorldSnapshot(rawSnapshot);
    const affectedPaths = Array.isArray(options.affectedPaths)
      ? [...new Set(options.affectedPaths.map((value) => String(value).trim()).filter(Boolean))].sort()
      : null;
    const previous = affectedPaths && typeof repository.readLatest === 'function'
      ? await repository.readLatest(snapshot.worldId)
      : null;
    const projections = {};
    const projectionValues = {};
    const rebuiltProjections = [];
    const reusedProjections = [];
    try {
      for (const projector of projectors) {
        const previousProjection = previous?.projections?.[projector.id] ?? null;
        const affected = !affectedPaths
          || !previousProjection
          || typeof projector.affectedBy !== 'function'
          || projector.affectedBy(affectedPaths);
        if (!affected) {
          projections[projector.id] = validateProjectionEnvelope({
            ...structuredClone(previousProjection),
            sourceRevision: snapshot.revision
          });
          reusedProjections.push(projector.id);
          projectionValues[projector.id] = projections[projector.id].value;
          continue;
        }
        const isolatedSnapshot = structuredClone(snapshot);
        const value = await projector.project(isolatedSnapshot, Object.freeze({
          affectedPaths: affectedPaths ? [...affectedPaths] : null,
          previousProjection: previousProjection ? structuredClone(previousProjection) : null,
          projections: structuredClone(projections),
          values: Object.freeze({ ...projectionValues })
        }));
        projections[projector.id] = validateProjectionEnvelope({
          contract: 'atom.projection',
          version: 1,
          projection: projector.id,
          worldId: snapshot.worldId,
          sourceRevision: snapshot.revision,
          value
        });
        projectionValues[projector.id] = value;
        rebuiltProjections.push(projector.id);
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
    const result = {
      worldId: snapshot.worldId,
      sourceRevision: snapshot.revision,
      projections: projectors.map(({ id }) => id)
    };
    if (affectedPaths) {
      result.rebuiltProjections = rebuiltProjections;
      result.reusedProjections = reusedProjections;
      result.affectedPaths = affectedPaths;
    }
    return result;
  }

  return Object.freeze({ rebuild });
}
