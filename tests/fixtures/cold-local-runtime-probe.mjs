import { createLegacyRuntimeComposition } from '../../src/atom-system/adapters/legacy-runtime-composition.mjs';

const [contextFile, graphFile, storeFile, agentPath] = process.argv.slice(2);

function fieldValue(atom, baseKey) {
  return Object.entries(atom ?? {}).find(([key]) => key === baseKey || key.startsWith(`${baseKey}@`))?.[1];
}

function rootSituationFromGraph(graph) {
  return fieldValue(fieldValue(graph?.graph, 'slot')?.[0], 'situation') ?? null;
}

function rootSituationFromSpatial(spatial) {
  return spatial?.nodes?.find((node) => node.atomPath === 'Root')?.detail ?? null;
}

let projectedGraph = null;
let projectedSpatial = null;
const runtime = createLegacyRuntimeComposition({
  contextFile,
  graphFile,
  storeFile,
  graphPublisher: { publish: async (graph) => { projectedGraph = graph; } },
  spatialPublisher: { publish: async (spatial) => { projectedSpatial = spatial; } },
  feedbackRecorder: async () => ({ ok: true })
});

try {
  const initialized = await runtime.initialize({ correlationId: 'cold-local-runtime-startup' });
  let explored = null;
  let agentError = null;
  try {
    explored = await runtime.execute({
      source: 'explore {"thing":"Root","situation$full":true}',
      correlationId: 'cold-local-runtime-explore',
      ...(agentPath ? { agentPath } : {}),
      history: []
    });
  } catch (error) {
    agentError = error.code ?? error.name;
  }
  const match = explored?.items?.[0]?.matches?.[0] ?? null;
  process.stdout.write(JSON.stringify({
    projectionStatus: initialized.projectionStatus,
    initializationRevision: initialized.initialization.revisionAfter,
    projectionRevision: initialized.projection?.sourceRevision ?? null,
    graphSituation: rootSituationFromGraph(projectedGraph),
    spatialSituation: rootSituationFromSpatial(projectedSpatial),
    legacyRelations: projectedSpatial?.legacyRelations ?? [],
    agentError,
    agentPath: explored?.agent ?? (agentPath || null),
    exploreSituation: match?.situation ?? null,
    exploreResult: explored
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    error: error.code ?? error.name,
    message: error.message,
    details: error.details ?? null
  }));
} finally {
  await runtime.close().catch(() => {});
}
