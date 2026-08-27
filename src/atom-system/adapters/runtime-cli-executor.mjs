import crypto from 'node:crypto';
import path from 'node:path';

import { createJsonProgramProjectionRepository } from './json-program-projection-repository.mjs';
import { createLegacyRuntimeComposition } from './legacy-runtime-composition.mjs';
import { createProgramRuntimeScheduler } from '../../../work-engine/atom-language/program-runtime.mjs';

export function createRuntimeCliExecutor(options = {}) {
  const programScheduler = options.programScheduler ?? (
    typeof options.contextFile === 'string' && options.contextFile
      ? createProgramRuntimeScheduler({
          projectionRepository: createJsonProgramProjectionRepository({
            file: path.join(path.dirname(options.contextFile), 'program-projection.json')
          })
        })
      : undefined
  );
  const interactionRuntime = options.interactionRuntime ?? createLegacyRuntimeComposition({
    contextFile: options.contextFile,
    graphFile: options.graphFile,
    storeFile: options.storeFile,
    ...(programScheduler ? { programScheduler } : {})
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
