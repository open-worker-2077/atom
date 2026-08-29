import {
  validateWorldCommandEnvelope,
  validateWorldReceipt,
  validateWorldSnapshot
} from '../public/contracts.mjs';
import { affectedAtomsBetween, normalizeAffectedAtoms } from './year-ring.mjs';
import { revisionOfWorldFacts } from './world-revision.mjs';
import {
  applyLocalWorldPatch,
  createLocalWorldPatch,
  invertLocalWorldPatch
} from './local-world-patch.mjs';
import { createAffectedPathClosure } from './affected-path-closure.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function nextWorldSnapshot(current, facts) {
  return validateWorldSnapshot({
    contract: 'atom.world-snapshot',
    version: 1,
    worldId: current.worldId,
    revision: revisionOfWorldFacts(facts),
    facts
  });
}

function committedReceipt(command, before, after, result, changedPaths = null) {
  const resultAffected = result?.affectedAtoms ?? [];
  const affectedAtoms = normalizeAffectedAtoms([
    ...(Array.isArray(changedPaths) && result?.affectedAtomsComplete === true
      ? []
      : affectedAtomsBetween(before.facts, after.facts)),
    ...resultAffected
  ]);
  const source = result?.source ?? command.payload?.source ?? command.name;
  const rollbackOf = result?.restoredCommandId;
  return validateWorldReceipt({
    contract: 'atom.world-receipt',
    version: 1,
    commandId: command.commandId,
    correlationId: command.correlationId,
    beforeRevision: before.revision,
    afterRevision: after.revision,
    status: 'committed',
    committedAt: new Date().toISOString(),
    source,
    affectedAtoms,
    ...(rollbackOf ? { rollbackOf } : {}),
    result: structuredClone(result ?? null)
  });
}

export function createCommitCoordinator({
  worldRepository,
  journalRepository,
  faultInjector = async () => {}
}) {
  if (!worldRepository?.read || !worldRepository?.compareAndSwap) {
    throw problem('INVALID_WORLD_REPOSITORY', 'A readable compare-and-swap world repository is required');
  }
  if (!journalRepository?.prepare || !journalRepository?.commit) {
    throw problem('INVALID_TRANSACTION_JOURNAL', 'A transaction journal is required');
  }

  let tail = Promise.resolve();

  function serialize(work) {
    const running = tail.then(work, work);
    tail = running.catch(() => {});
    return running;
  }

  async function recoverRecord(record) {
    const current = await worldRepository.read();
    const recordWorldId = record.historyMode === 'local-patch'
      ? record.patch.worldId
      : record.after.worldId;
    const beforeRevision = record.historyMode === 'local-patch'
      ? record.patch.beforeRevision
      : record.before.revision;
    const afterRevision = record.historyMode === 'local-patch'
      ? record.patch.afterRevision
      : record.after.revision;
    if (current.worldId !== recordWorldId) {
      throw problem('TRANSACTION_RECOVERY_CONFLICT', 'Prepared transaction belongs to another world');
    }
    if (current.revision === beforeRevision) {
      const nextSnapshot = record.historyMode === 'local-patch'
        ? nextWorldSnapshot(current, applyLocalWorldPatch(current.facts, record.patch))
        : record.after;
      if (nextSnapshot.revision !== afterRevision) {
        throw problem('TRANSACTION_RECOVERY_CONFLICT', 'Prepared patch does not produce its committed revision');
      }
      await worldRepository.compareAndSwap({
        expectedRevision: beforeRevision,
        nextSnapshot
      });
    } else if (current.revision !== afterRevision) {
      throw problem('TRANSACTION_RECOVERY_CONFLICT', 'World diverged from a prepared transaction', {
        commandId: record.commandId,
        actualRevision: current.revision,
        beforeRevision,
        afterRevision
      });
    }
    return journalRepository.commit(record.commandId, record.receipt);
  }

  async function recoverUnsafe() {
    const prepared = await journalRepository.listPrepared();
    for (const record of prepared) await recoverRecord(record);
    return { recovered: prepared.length };
  }

  function recover() {
    return serialize(recoverUnsafe);
  }

  async function executeUnsafe({ command: rawCommand, transition }) {
      const command = validateWorldCommandEnvelope(rawCommand);
      const existingReceipt = await journalRepository.findReceipt(command.commandId);
      if (existingReceipt) return existingReceipt;

      const pending = await journalRepository.findPrepared(command.commandId);
      if (pending) return recoverRecord(pending);
      if (typeof transition !== 'function') {
        throw problem('INVALID_WORLD_TRANSITION', 'transition must be a function');
      }

      const before = await worldRepository.read();
      if (before.revision !== command.expectedRevision) {
        throw problem('WORLD_REVISION_CONFLICT', 'Command was based on an obsolete world revision', {
          expectedRevision: command.expectedRevision,
          actualRevision: before.revision
        });
      }

      const output = await transition(structuredClone(before), structuredClone(command.payload));
      if (!output || !Array.isArray(output.facts)) {
        throw problem('INVALID_WORLD_TRANSITION', 'transition must return a facts array');
      }
      const after = nextWorldSnapshot(before, output.facts);
      if (after.revision === before.revision) {
        throw problem('WORLD_TRANSITION_NO_CHANGE', 'A world commit must change the authoritative facts');
      }
      const patch = Array.isArray(output.changedPaths) && output.changedPaths.length
        ? createLocalWorldPatch({
            worldId: before.worldId,
            beforeRevision: before.revision,
            afterRevision: after.revision,
            beforeFacts: before.facts,
            afterFacts: after.facts,
            changedPaths: output.changedPaths
          })
        : null;
      const affectedClosure = patch ? createAffectedPathClosure({
        changedPaths: output.changedPaths,
        patch,
        relationEndpoints: output.result?.relationEndpoints,
        lockPaths: output.result?.lockPaths,
        shortcutPaths: output.result?.shortcutPaths
      }) : null;
      const preciseAffectedAtoms = affectedClosure ? [
        ...(output.result?.affectedAtoms ?? []),
        ...affectedClosure.paths.map((path) => ({ path, axes: [] }))
      ] : output.result?.affectedAtoms;
      const receiptResult = affectedClosure ? {
        ...(output.result ?? {}),
        affectedAtoms: preciseAffectedAtoms,
        affectedAtomsComplete: true,
        affectedPathClosure: affectedClosure.entries
      } : output.result;
      const receipt = committedReceipt(command, before, after, receiptResult, output.changedPaths);
      const record = patch ? {
        historyMode: 'local-patch',
        commandId: command.commandId,
        correlationId: command.correlationId,
        command,
        patch,
        inversePatch: invertLocalWorldPatch(patch),
        receipt
      } : {
        commandId: command.commandId,
        correlationId: command.correlationId,
        command,
        before,
        after,
        receipt
      };

      await journalRepository.prepare(record);
      await faultInjector('after-prepare', structuredClone(record));
      await worldRepository.compareAndSwap({ expectedRevision: before.revision, nextSnapshot: after });
      await faultInjector('after-world-write', structuredClone(record));
      return journalRepository.commit(command.commandId, receipt);
  }

  function execute(request) {
    return serialize(() => executeUnsafe(request));
  }

  function rollback({ targetCommandId, command }) {
    return serialize(async () => {
      if (typeof targetCommandId !== 'string' || !targetCommandId.trim()) {
        throw problem('INVALID_ROLLBACK_TARGET', 'Rollback requires a target command id');
      }
      const target = await journalRepository.findCommitted(targetCommandId);
      if (!target || (target.historyMode !== 'local-patch' && (!target.before || !target.after))) {
        throw problem('ROLLBACK_TARGET_NOT_FOUND', `Committed command ${targetCommandId} was not found`);
      }
      const current = await worldRepository.read();
      const targetAfterRevision = target.historyMode === 'local-patch'
        ? target.patch.afterRevision
        : target.after.revision;
      if (current.revision !== targetAfterRevision) {
        throw problem('ROLLBACK_WORLD_DIVERGED', 'Rollback target is not the latest world transition', {
          targetCommandId,
          targetAfterRevision,
          actualRevision: current.revision
        });
      }
      return executeUnsafe({
        command,
        transition: () => target.historyMode === 'local-patch'
          ? ({
              facts: applyLocalWorldPatch(current.facts, target.inversePatch),
              changedPaths: target.inversePatch.changedPaths,
              result: {
                restoredCommandId: targetCommandId,
                affectedAtoms: target.receipt.affectedAtoms,
                affectedAtomsComplete: true
              }
            })
          : ({
              facts: structuredClone(target.before.facts),
              result: { restoredCommandId: targetCommandId }
            })
      });
    });
  }

  return Object.freeze({ execute, recover, rollback });
}
