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

// All in-process writers for a world use its existing coordinator. Projection hooks
// stay on each facade; weak ownership never evicts a live writer or retains a world.
const worldOwners = new Map();
const releaseWorldOwner = new FinalizationRegistry(({ key, reference }) => {
  if (worldOwners.get(key) === reference) worldOwners.delete(key);
});

function ownerFor({ contextFile, journalFile, worldId }) {
  const key = JSON.stringify([path.resolve(contextFile), path.resolve(journalFile), worldId]);
  let owner = worldOwners.get(key)?.deref();
  if (!owner) {
    const worldRepository = createJsonWorldRepository({ file: contextFile, worldId, initialFacts: [] });
    const journalRepository = createJsonTransactionJournal({ file: journalFile });
    owner = { worldRepository, journalRepository,
      coordinator: createCommitCoordinator({ worldRepository, journalRepository }), recovery: null };
    const reference = new WeakRef(owner);
    worldOwners.set(key, reference);
    releaseWorldOwner.register(owner, { key, reference });
  }
  return owner;
}

function assertSourceBinding(execution, event) {
  if (execution && execution.event.binding !== event.binding) {
    throw problem('ATOM_INTERACTION_ID_CONFLICT', '同一 Atom 请求标识不能对应不同命令或 Agent');
  }
}

export function createTransactionalWorldPersistence({
  contextFile,
  projectionFile,
  journalFile = path.join(path.dirname(contextFile), 'atom.transactions.json'),
  worldId = 'primary',
  publishLegacyProjection = true,
  onAuthoritativeWrite = async () => {}
}) {
  const owner = ownerFor({ contextFile, journalFile, worldId });
  const { worldRepository, journalRepository, coordinator } = owner;

  function recover() {
    owner.recovery ??= coordinator.recover();
    return owner.recovery;
  }

  async function compatibilityManifest() {
    await recover();
    if (owner.manifestLoaded) return structuredClone(owner.cachedManifest);
    const state = await journalRepository.readState();
    owner.cachedManifest = structuredClone(state.receipts.at(-1)?.receipt?.result?.compatibilityManifest ?? null);
    owner.manifestLoaded = true;
    return structuredClone(owner.cachedManifest);
  }

  async function transformLogEntries() {
    await recover();
    if (owner.cachedTransformLog) return structuredClone(owner.cachedTransformLog);
    const state = await journalRepository.readState();
    owner.cachedTransformLog = state.receipts.flatMap((entry) => {
      const record = entry.receipt?.result?.transformLogRecord;
      return record ? [structuredClone(record)] : [];
    });
    return structuredClone(owner.cachedTransformLog);
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
    postCommitEvent = null,
    subsequentOf = null,
    compatibilityManifest: suppliedManifest = null
  }) {
    await recover();
    if (postCommitEvent) {
      const existing = await journalRepository.programExecutionForInteraction(correlationId);
      assertSourceBinding(existing, postCommitEvent);
      if (existing) return existing.sourceReceipt;
    }
    if (subsequentOf) {
      const execution = await journalRepository.programExecution(subsequentOf);
      if (!execution) throw problem('PROGRAM_SOURCE_NOT_FOUND', 'Subsequent effects require a committed source');
      if (execution.childReceipt) return execution.childReceipt;
      if (execution.outcome && execution.outcome.status !== 'pending') {
        throw problem('PROGRAM_EXECUTION_FINAL', 'A final post-commit business outcome cannot be executed again');
      }
    }
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
    let receipt;
    try {
      receipt = await coordinator.execute({
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
              ...(postCommitEvent ? { postCommitEvent: structuredClone({ ...postCommitEvent,
                sourceCommandId: commandId, sourceRevision: canonicalNextRevision }) } : {}),
              ...(subsequentOf ? { subsequentOf } : {}),
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
    } catch (error) {
      if (postCommitEvent) {
        const existing = await journalRepository.programExecutionForInteraction(correlationId);
        assertSourceBinding(existing, postCommitEvent);
        if (existing) return existing.sourceReceipt;
      }
      throw error;
    }
    if (postCommitEvent) assertSourceBinding({ event: receipt.result.postCommitEvent }, postCommitEvent);
    owner.cachedManifest = structuredClone(receipt.result?.compatibilityManifest ?? previousManifest ?? null);
    owner.compatibilityGeneration = (owner.compatibilityGeneration ?? 0) + 1;
    owner.manifestLoaded = true;
    if (transformLogRecord && owner.cachedTransformLog) {
      owner.cachedTransformLog.push(structuredClone(transformLogRecord));
    }
    try {
      await adoptAtomContextSnapshot(contextFile, facts, {
        ...(nextManifest ? { compatibilityManifest: nextManifest } : {})
      });
      await onAuthoritativeWrite({
        operation: 'commit',
        contextFile,
        revision: receipt.afterRevision,
        receipt
      });
    } catch (error) {
      throw problem(
        error.code ?? 'WORLD_COMMITTED_AUXILIARY_PENDING',
        error.message ?? 'World transition committed, but an auxiliary projection requires recovery',
        { ...(error.details ?? {}), receipt, cause: error.code ?? error.name }
      );
    }
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
    owner.manifestLoaded = false;
    owner.compatibilityGeneration = (owner.compatibilityGeneration ?? 0) + 1;
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
    // Cache invalidation only; authoritative identity remains the world receipt.
    get compatibilityGeneration() { return owner.compatibilityGeneration ?? 0; },
    commit,
    compatibilityManifest,
    recover,
    rollback,
    transformLogEntries,
    async programExecution(sourceCommandId) {
      await recover();
      return journalRepository.programExecution(sourceCommandId);
    },
    async programExecutionForInteraction(correlationId) {
      await recover();
      return journalRepository.programExecutionForInteraction(correlationId);
    },
    async pendingProgramExecutions() {
      await recover();
      return journalRepository.pendingProgramExecutions();
    },
    async recordProgramExecution(request) {
      await recover();
      return journalRepository.recordProgramExecution(request);
    }
  });
}
