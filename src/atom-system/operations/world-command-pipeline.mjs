function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

export function createWorldCommandPipeline({
  commitCoordinator,
  worldRepository,
  projectionPipeline
}) {
  if (typeof commitCoordinator?.execute !== 'function') {
    throw problem('INVALID_COMMIT_COORDINATOR', 'World command pipeline requires a commit coordinator');
  }
  if (typeof worldRepository?.read !== 'function') {
    throw problem('INVALID_WORLD_REPOSITORY', 'World command pipeline requires a world repository');
  }
  if (typeof projectionPipeline?.rebuild !== 'function') {
    throw problem('INVALID_PROJECTION_PIPELINE', 'World command pipeline requires a projection pipeline');
  }

  async function snapshotAt(expectedRevision) {
    const snapshot = await worldRepository.read();
    if (snapshot.revision !== expectedRevision) {
      throw problem('WORLD_REVISION_CONFLICT', 'Projection source revision no longer matches the committed world', {
        expectedRevision,
        actualRevision: snapshot.revision
      });
    }
    return snapshot;
  }

  async function recoverProjection({ expectedRevision }) {
    return projectionPipeline.rebuild(await snapshotAt(expectedRevision));
  }

  async function execute(request) {
    const receipt = await commitCoordinator.execute(request);
    try {
      const projection = await recoverProjection({ expectedRevision: receipt.afterRevision });
      return Object.freeze({ receipt, projectionStatus: 'published', projection });
    } catch (error) {
      const details = error?.details && typeof error.details === 'object' ? error.details : {};
      return Object.freeze({
        receipt,
        projectionStatus: 'pending',
        projectionRecovery: { expectedRevision: receipt.afterRevision },
        projectionFailure: Object.freeze({
          ...(typeof details.projection === 'string' && details.projection
            ? { projection: details.projection }
            : {}),
          cause: details.cause ?? error.code ?? error.name
        })
      });
    }
  }

  return Object.freeze({ execute, recoverProjection });
}
