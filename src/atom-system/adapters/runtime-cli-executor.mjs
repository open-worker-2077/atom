import crypto from 'node:crypto';

import { createLegacyRuntimeComposition } from './legacy-runtime-composition.mjs';

export function createRuntimeCliExecutor(options = {}) {
  const interactionRuntime = options.interactionRuntime ?? createLegacyRuntimeComposition({
    contextFile: options.contextFile,
    graphFile: options.graphFile,
    storeFile: options.storeFile
  });
  const randomId = options.randomId ?? crypto.randomUUID;

  return function executeCliRequest(request) {
    return interactionRuntime.execute({
      source: request.source,
      correlationId: request.interaction?.id ?? randomId(),
      ...(request.interaction?.agent?.path ? { agentPath: request.interaction.agent.path } : {}),
      history: structuredClone(request.history ?? [])
    });
  };
}
