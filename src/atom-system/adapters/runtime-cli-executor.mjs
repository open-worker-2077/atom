import crypto from 'node:crypto';
import path from 'node:path';

import { createJsonProgramProjectionRepository } from './json-program-projection-repository.mjs';
import { createLegacyRuntimeComposition } from './legacy-runtime-composition.mjs';
import { createProgramRuntimeScheduler } from '../../../work-engine/atom-language/program-runtime.mjs';

export function createRuntimeCliExecutor(options = {}) {
  const trustedMaintenance = options.trustedMaintenance === true;
  const programScheduler = trustedMaintenance ? null : (options.programScheduler ?? (
    typeof options.contextFile === 'string' && options.contextFile
      ? createProgramRuntimeScheduler({
          projectionRepository: createJsonProgramProjectionRepository({
            file: path.join(path.dirname(options.contextFile), 'program-projection.json')
          })
        })
      : undefined
  ));
  const interactionRuntime = options.interactionRuntime ?? createLegacyRuntimeComposition({
    contextFile: options.contextFile,
    graphFile: options.graphFile,
    storeFile: options.storeFile,
    programScheduler
  });
  const randomId = options.randomId ?? crypto.randomUUID;
  let preparation = null;

  return async function executeCliRequest(request) {
    const correlationId = request.interaction?.id ?? randomId();
    if (typeof interactionRuntime.initialize === 'function') {
      preparation ??= interactionRuntime.initialize({
        correlationId: `${correlationId}:maintenance-projection`
      }).then((result) => {
        if (result?.projectionStatus === 'pending') {
          throw Object.assign(
            new Error('Maintenance execution requires a published current projection'),
            {
              code: 'RUNTIME_INITIALIZATION_FAILED',
              details: structuredClone(result.projectionFailure ?? {})
            }
          );
        }
        return result;
      });
      await preparation;
    }
    const intent = {
      source: request.source,
      correlationId,
      ...(request.interaction?.agent?.path ? { agentPath: request.interaction.agent.path } : {}),
      history: structuredClone(request.history ?? [])
    };
    return trustedMaintenance
      ? interactionRuntime.execute(intent, {
          trustedMaintenance: true,
          programMode: 'project'
        })
      : interactionRuntime.execute(intent);
  };
}
