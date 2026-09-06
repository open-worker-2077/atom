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
  repository = createMemoryProjectionRepository({ immutableReferences: true }),
  programScheduler = null,
  committedSnapshotProvider = null,
  compatibilityManifestProvider = null,
  journalFile = path.join(path.dirname(contextFile), 'atom.transactions.json')
}) {
  if (!contextFile) throw problem('INVALID_PROJECTION_CONTEXT', 'Atom context file is required');
  let fallbackJournal = null;

  async function currentCompatibilityManifest() {
    if (typeof compatibilityManifestProvider === 'function') {
      const manifest = await compatibilityManifestProvider();
      return manifest ? structuredClone(manifest) : null;
    }
    fallbackJournal ??= createJsonTransactionJournal({ file: journalFile });
    const journalState = await fallbackJournal.readState();
    return journalState.receipts.at(-1)?.receipt?.result?.compatibilityManifest ?? null;
  }

  async function currentCommittedSnapshot() {
    if (typeof committedSnapshotProvider === 'function') {
      const supplied = await committedSnapshotProvider();
      if (!supplied || !Array.isArray(supplied.facts) || typeof supplied.revision !== 'string') {
        throw problem('INVALID_COMMITTED_SNAPSHOT', 'Projection requires committed facts and revision from one boundary');
      }
      const suppliedRevision = revisionOfWorldFacts(supplied.facts);
      if (!sameRevision(supplied.revision, suppliedRevision)) {
        throw problem('INVALID_COMMITTED_SNAPSHOT', 'Committed projection revision does not match its facts', {
          expectedRevision: supplied.revision,
          actualRevision: suppliedRevision
        });
      }
      const compatibilityManifest = supplied.compatibilityManifest
        ? structuredClone(supplied.compatibilityManifest)
        : null;
      const facts = await readAtomContext(contextFile, {
        create: false,
        committedSnapshot: supplied,
        ...(compatibilityManifest ? { compatibilityManifest } : {})
      });
      const revision = revisionOfWorldFacts(facts);
      if (!sameRevision(supplied.revision, revision)) {
        throw problem('INVALID_COMMITTED_SNAPSHOT', 'Normalized projection facts do not match their committed revision', {
          expectedRevision: supplied.revision,
          actualRevision: revision
        });
      }
      return { facts, revision, compatibilityManifest };
    }
    const compatibilityManifest = await currentCompatibilityManifest();
    const facts = await readAtomContext(contextFile, {
      create: false,
      compatibilityManifest
    });
    return {
      facts,
      revision: revisionOfWorldFacts(facts),
      compatibilityManifest
    };
  }

  async function projectCurrent({ expectedRevision, lockState = [], affectedPaths = null } = {}) {
    const readStartedAt = performance.now();
    const { facts, revision: sourceRevision, compatibilityManifest } = await currentCommittedSnapshot();
    performanceTrace('projection-read-world', {
      elapsedMs: Math.round(performance.now() - readStartedAt)
    });
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
      repository,
      shareImmutableSnapshot: true
    });
    const rebuildStartedAt = performance.now();
    const projectionResult = await pipeline.rebuild({
      contract: 'atom.world-snapshot',
      version: 1,
      worldId,
      revision: sourceRevision,
      facts
    }, { affectedPaths });
    performanceTrace('projection-rebuild', {
      elapsedMs: Math.round(performance.now() - rebuildStartedAt)
    });
    const batch = await repository.readCurrent(worldId, sourceRevision);
    if (!batch.current) {
      throw problem('PROJECTION_PUBLICATION_FAILED', 'Projection batch was not published as current');
    }
    return Object.freeze({
      sourceRevision,
      projectionScope: projectionResult,
      graph: batch.projections.graph.value,
      spatial: batch.projections.spatial.value
    });
  }

  return Object.freeze({ projectCurrent });
}
