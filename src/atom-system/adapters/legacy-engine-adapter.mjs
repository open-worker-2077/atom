import { executeAtomLanguage } from '../../../work-engine/atom-language/engine.mjs';
import { createWorldService } from '../public/world-service.mjs';
import { createTransactionalWorldPersistence } from './transactional-world-persistence.mjs';

export function createLegacyWorldService(options = {}) {
  const execute = options.execute ?? executeAtomLanguage;
  const transactionProvider = options.transactionProvider ?? ((request) => (
    createTransactionalWorldPersistence({
      contextFile: request.contextFile,
      projectionFile: request.projectionFile,
      publishLegacyProjection: options.publishLegacyProjection !== false,
      onAuthoritativeWrite: options.onAuthoritativeWrite
    })
  ));
  const transactions = new Map();
  const readiness = new WeakMap();

  function transactionFor(request) {
    const key = `${request.contextFile}\0${request.projectionFile}`;
    if (!transactions.has(key)) transactions.set(key, transactionProvider(request));
    return transactions.get(key);
  }

  function readinessFor(persistence) {
    let state = readiness.get(persistence);
    if (!state) {
      state = { recovery: null, manifest: null };
      readiness.set(persistence, state);
    }
    return state;
  }

  async function timed(stage, work) {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      options.onPersistenceStage?.({
        stage,
        durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000
      });
    }
  }

  function recoverPersistence(persistence) {
    const state = readinessFor(persistence);
    if (!state.recovery) {
      state.recovery = timed('recover', () => persistence.recover())
        .catch((error) => {
          state.recovery = null;
          throw error;
        });
    }
    return state.recovery;
  }

  function manifestFor(persistence) {
    const state = readinessFor(persistence);
    if (!state.manifest) {
      state.manifest = recoverPersistence(persistence)
        .then(() => (typeof persistence.compatibilityManifest === 'function'
          ? timed('manifest', () => persistence.compatibilityManifest())
          : null))
        .catch((error) => {
          state.manifest = null;
          throw error;
        });
    }
    return state.manifest;
  }

  function invalidateManifest(persistence) {
    readinessFor(persistence).manifest = null;
  }

  const service = createWorldService({
    executeLegacyInteraction: async (request) => {
      request.signal?.throwIfAborted?.();
      if (!request.contextFile || !request.projectionFile) return execute(request);
      const persistence = transactionFor(request);
      await recoverPersistence(persistence);
      request.signal?.throwIfAborted?.();
      const compatibilityManifest = await manifestFor(persistence);
      const transactionTransformLog = typeof persistence.transformLogEntries === 'function'
        ? await timed('transform-log', () => persistence.transformLogEntries())
        : [];
      return timed('engine.execute', () => execute({
        ...request,
        compatibilityManifest,
        transactionTransformLog,
        commitWorld: async (transition) => {
          request.signal?.throwIfAborted?.();
          const receipt = await persistence.commit({
            ...transition,
            source: request.source,
            correlationId: transition.correlationId ?? request.interaction?.id
          });
          invalidateManifest(persistence);
          return receipt;
        }
      }));
    }
  });
  return Object.freeze({
    ...service,
    async compatibilityManifest(request) {
      if (!request?.contextFile || !request?.projectionFile) return null;
      const persistence = transactionFor(request);
      return structuredClone(await manifestFor(persistence));
    }
  });
}
