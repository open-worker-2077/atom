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

  function transactionFor(request) {
    const key = `${request.contextFile}\0${request.projectionFile}`;
    if (!transactions.has(key)) transactions.set(key, transactionProvider(request));
    return transactions.get(key);
  }

  return createWorldService({
    executeLegacyInteraction: async (request) => {
      if (!request.contextFile || !request.projectionFile) return execute(request);
      const persistence = transactionFor(request);
      await persistence.recover();
      const compatibilityManifest = typeof persistence.compatibilityManifest === 'function'
        ? await persistence.compatibilityManifest()
        : null;
      return execute({
        ...request,
        compatibilityManifest,
        commitWorld: (transition) => persistence.commit({
          ...transition,
          source: request.source,
          correlationId: request.interaction?.id ?? transition.correlationId
        })
      });
    }
  });
}
