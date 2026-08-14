import {
  validateWorldCommandEnvelope,
  validateWorldReceipt,
  validateWorldSnapshot
} from '../public/contracts.mjs';
import { revisionOfWorldFacts } from './world-revision.mjs';

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

function committedReceipt(command, beforeRevision, afterRevision, result) {
  return validateWorldReceipt({
    contract: 'atom.world-receipt',
    version: 1,
    commandId: command.commandId,
    correlationId: command.correlationId,
    beforeRevision,
    afterRevision,
    status: 'committed',
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
    if (current.worldId !== record.after.worldId) {
      throw problem('TRANSACTION_RECOVERY_CONFLICT', 'Prepared transaction belongs to another world');
    }
    if (current.revision === record.before.revision) {
      await worldRepository.compareAndSwap({
        expectedRevision: record.before.revision,
        nextSnapshot: record.after
      });
    } else if (current.revision !== record.after.revision) {
      throw problem('TRANSACTION_RECOVERY_CONFLICT', 'World diverged from a prepared transaction', {
        commandId: record.commandId,
        actualRevision: current.revision,
        beforeRevision: record.before.revision,
        afterRevision: record.after.revision
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
      const receipt = committedReceipt(command, before.revision, after.revision, output.result);
      const record = {
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
      if (!target?.before || !target?.after) {
        throw problem('ROLLBACK_TARGET_NOT_FOUND', `Committed command ${targetCommandId} was not found`);
      }
      const current = await worldRepository.read();
      if (current.revision !== target.after.revision) {
        throw problem('ROLLBACK_WORLD_DIVERGED', 'Rollback target is not the latest world transition', {
          targetCommandId,
          targetAfterRevision: target.after.revision,
          actualRevision: current.revision
        });
      }
      return executeUnsafe({
        command,
        transition: () => ({
          facts: structuredClone(target.before.facts),
          result: { restoredCommandId: targetCommandId }
        })
      });
    });
  }

  return Object.freeze({ execute, recover, rollback });
}
