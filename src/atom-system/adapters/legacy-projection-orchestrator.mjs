import path from 'node:path';

import {
  legacyAtomContextMetadata,
  readAtomContext
} from '../../../work-engine/atom-language/context-store.mjs';
import { createProjectionPipeline } from '../projections/projection-pipeline.mjs';
import { createMemoryProjectionRepository } from '../projections/projection-repository.mjs';
import { revisionOfWorldFacts } from '../world-runtime/world-revision.mjs';
import { createLegacyProjectionProjectors } from './legacy-projection-adapter.mjs';
import { createJsonTransactionJournal } from './json-world-repository.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function sameRevision(expected, actual) {
  return expected === actual || expected === actual.slice('sha256:'.length);
}

function performanceTrace(event, details) {
  if (process.env.ATOM_PERF_TRACE !== '1') return;
  process.stderr.write(`${JSON.stringify({ event, ...details })}\n`);
}

export function createLegacyProjectionOrchestrator({
  contextFile,
  worldId = 'primary',
  repository = createMemoryProjectionRepository(),
  programScheduler = null,
  journalFile = path.join(path.dirname(contextFile), 'atom.transactions.json')
}) {
  if (!contextFile) throw problem('INVALID_PROJECTION_CONTEXT', 'Atom context file is required');

  async function projectCurrent({ expectedRevision, lockState = [] } = {}) {
    const readStartedAt = performance.now();
    const journal = createJsonTransactionJournal({ file: journalFile });
    const journalState = await journal.readState();
    const compatibilityManifest = journalState.receipts.at(-1)?.receipt?.result?.compatibilityManifest ?? null;
    const facts = await readAtomContext(contextFile, {
      create: false,
      compatibilityManifest
    });
    performanceTrace('projection-read-world', {
      elapsedMs: Math.round(performance.now() - readStartedAt)
    });
    const sourceRevision = revisionOfWorldFacts(facts);
    if (expectedRevision && !sameRevision(expectedRevision, sourceRevision)) {
      throw problem('STALE_WORLD_PROJECTION', 'Projection request does not match the current Atom world', {
        expectedRevision,
        actualRevision: sourceRevision
      });
    }
    const pipeline = createProjectionPipeline({
      projectors: createLegacyProjectionProjectors({
        lockState,
        programScheduler,
        compatibilityManifest,
        compatibilityMetadata: legacyAtomContextMetadata(facts)
      }),
      repository
    });
    const rebuildStartedAt = performance.now();
    await pipeline.rebuild({
      contract: 'atom.world-snapshot',
      version: 1,
      worldId,
      revision: sourceRevision,
      facts
    });
    performanceTrace('projection-rebuild', {
      elapsedMs: Math.round(performance.now() - rebuildStartedAt)
    });
    const batch = await repository.readCurrent(worldId, sourceRevision);
    if (!batch.current) {
      throw problem('PROJECTION_PUBLICATION_FAILED', 'Projection batch was not published as current');
    }
    return Object.freeze({
      sourceRevision,
      graph: batch.projections.graph.value,
      spatial: batch.projections.spatial.value
    });
  }

  return Object.freeze({ projectCurrent });
}
