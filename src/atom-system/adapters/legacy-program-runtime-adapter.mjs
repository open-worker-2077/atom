import { createProgramRuntimeScheduler } from '../../../work-engine/atom-language/program-runtime.mjs';
import { createProgramRuntimePort } from '../world-runtime/program-runtime-port.mjs';

export function createLegacyProgramRuntimePort(options = {}) {
  const scheduler = options.scheduler ?? createProgramRuntimeScheduler(options.schedulerOptions);
  return createProgramRuntimePort({
    evaluate: ({ snapshot, interaction, explore }) => scheduler.refresh(snapshot.facts, {
      agentOrigin: interaction.agent,
      executeExplore: explore
    })
  });
}
