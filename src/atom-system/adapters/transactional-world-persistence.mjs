import crypto from 'node:crypto';
import path from 'node:path';

import {
  adoptAtomContextSnapshot,
  writeAtomGraphProjection
} from '../../../work-engine/atom-language/context-store.mjs';
import {
  advanceCompatibilityManifest,
  validateCompatibilityManifest
} from '../world-runtime/legacy-graph-compat.mjs';
import { createCommitCoordinator } from '../world-runtime/commit-coordinator.mjs';
import { revisionOfWorldFacts } from '../world-runtime/world-revision.mjs';
import {
  createJsonTransactionJournal,
  createJsonWorldRepository
} from './json-world-repository.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function commandIdFor({ correlationId, expectedRevision, nextRevision }) {
  const digest = crypto.createHash('sha256')
    .update(`${correlationId}\0${expectedRevision}\0${nextRevision}`)
    .digest('hex');
  return `legacy-${digest}`;
}

function rollbackCommandIdFor({ correlationId, expectedRevision, targetCommandId }) {
  const digest = crypto.createHash('sha256')
    .update(`${correlationId}\0${expectedRevision}\0${targetCommandId}`)
    .digest('hex');
  return `rollback-${digest}`;
}

function canonicalRevision(value) {
  return String(value).startsWith('sha256:') ? String(value) : `sha256:${value}`;
}

export function createTransactionalWorldPersistence({
  contextFile,
  projectionFile,
  journalFile = path.join(path.dirname(contextFile), 'atom.transactions.json'),
  worldId = 'primary',
  publishLegacyProjection = true,
  onAuthoritativeWrite = async () => {}
}) {
  const worldRepository = createJsonWorldRepository({ file: contextFile, worldId, initialFacts: [] });
  const journalRepository = createJsonTransactionJournal({ file: journalFile });
  const coordinator = createCommitCoordinator({ worldRepository, journalRepository });
  let recovery = null;
  let cachedManifest = null;
  let cachedTransformLog = null;
  let manifestLoaded = false;

  function recover() {
    recovery ??= coordinator.recover();
    return recovery;
  }

  async function compatibilityManifest() {
    await recover();
    if (manifestLoaded) return structuredClone(cachedManifest);
    const state = await journalRepository.readState();
    cachedManifest = structuredClone(state.receipts.at(-1)?.receipt?.result?.compatibilityManifest ?? null);
    manifestLoaded = true;
    return structuredClone(cachedManifest);
  }

  async function transformLogEntries() {
    await recover();
    if (cachedTransformLog) return structuredClone(cachedTransformLog);
    const state = await journalRepository.readState();
    cachedTransformLog = state.receipts.flatMap((entry) => {
      const record = entry.receipt?.result?.transformLogRecord;
      return record ? [structuredClone(record)] : [];
    });
    return structuredClone(cachedTransformLog);
  }

  async function commit({
    correlationId,
    expectedRevision,
    nextRevision,
    facts,
    source = 'legacy-interaction',
    changedPaths = null,
    affectedAtoms = null,
    transformLogRecord = null,
    compatibilityManifest: suppliedManifest = null
  }) {
    await recover();
    const previousManifest = await compatibilityManifest();
    const computedRevision = revisionOfWorldFacts(facts);
    const canonicalNextRevision = canonicalRevision(nextRevision);
    const canonicalExpectedRevision = canonicalRevision(expectedRevision);
    if (computedRevision !== canonicalNextRevision) {
      throw problem('INVALID_WORLD_REVISION', 'Legacy transition revision does not match its facts', {
        nextRevision,
        computedRevision
      });
    }
    const commandId = commandIdFor({
      correlationId,
      expectedRevision: canonicalExpectedRevision,
      nextRevision: canonicalNextRevision
    });
    let nextManifest = suppliedManifest
      ? (validateCompatibilityManifest(suppliedManifest, facts), structuredClone(suppliedManifest))
      : null;
    const receipt = await coordinator.execute({
      command: {
        contract: 'atom.world-command',
        version: 1,
        commandId,
        correlationId,
        expectedRevision: canonicalExpectedRevision,
        name: 'legacy-transition',
        payload: { source }
      },
      transitionInputMode: 'trusted-readonly',
      transition: (current) => {
        nextManifest ??= previousManifest
          ? advanceCompatibilityManifest(previousManifest, current.facts, facts)
          : null;
        return {
          facts,
          revision: canonicalNextRevision,
          ...(Array.isArray(changedPaths) && changedPaths.length ? { changedPaths } : {}),
          result: {
            source,
            ...(Array.isArray(affectedAtoms) ? {
              affectedAtoms,
              affectedAtomsComplete: true
            } : {}),
            ...(nextManifest ? { compatibilityManifest: nextManifest } : {}),
            ...(previousManifest ? { previousCompatibilityManifest: previousManifest } : {}),
            ...(transformLogRecord ? {
              transformLogRecord: structuredClone(transformLogRecord)
            } : {})
          }
        };
      }
    });
    cachedManifest = structuredClone(receipt.result?.compatibilityManifest ?? previousManifest ?? null);
    manifestLoaded = true;
    if (transformLogRecord && cachedTransformLog) {
      cachedTransformLog.push(structuredClone(transformLogRecord));
    }
    await adoptAtomContextSnapshot(contextFile, facts, {
      ...(nextManifest ? { compatibilityManifest: nextManifest } : {})
    });
    await onAuthoritativeWrite({
      operation: 'commit',
      contextFile,
      revision: receipt.afterRevision,
      receipt
    });
    if (publishLegacyProjection) {
      try {
        await writeAtomGraphProjection(projectionFile, facts, {
          rootName: path.basename(contextFile),
          allowLegacyStrut: Boolean(nextManifest)
        });
      } catch (error) {
        throw problem(
          'WORLD_COMMITTED_PROJECTION_PENDING',
          'World transition committed, but the legacy Graph projection requires recovery',
          { receipt, projection: 'graph', cause: error.code ?? error.name }
        );
      }
    }
    return receipt;
  }

  async function rollback({ targetCommandId, correlationId, expectedRevision }) {
    await recover();
    const canonicalExpectedRevision = canonicalRevision(expectedRevision);
    const receipt = await coordinator.rollback({
      targetCommandId,
      command: {
        contract: 'atom.world-command',
        version: 1,
        commandId: rollbackCommandIdFor({
          correlationId,
          expectedRevision: canonicalExpectedRevision,
          targetCommandId
        }),
        correlationId,
        expectedRevision: canonicalExpectedRevision,
        name: 'rollback-world-command',
        payload: { targetCommandId }
      }
    });
    manifestLoaded = false;
    await onAuthoritativeWrite({
      operation: 'rollback',
      contextFile,
      revision: receipt.afterRevision,
      receipt
    });
    if (publishLegacyProjection) {
      const restored = await worldRepository.read();
      try {
        await writeAtomGraphProjection(projectionFile, restored.facts, {
          rootName: path.basename(contextFile),
          allowLegacyStrut: Boolean(await compatibilityManifest())
        });
      } catch (error) {
        throw problem(
          'WORLD_COMMITTED_PROJECTION_PENDING',
          'World rollback committed, but the legacy Graph projection requires recovery',
          { receipt, projection: 'graph', cause: error.code ?? error.name }
        );
      }
    }
    return receipt;
  }

  return Object.freeze({
    commit,
    compatibilityManifest,
    recover,
    rollback,
    transformLogEntries
  });
}
