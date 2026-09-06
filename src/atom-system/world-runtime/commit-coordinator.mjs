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
  invertLocalWorldPatch,
  rebaseLocalWorldPatch
} from './local-world-patch.mjs';
import { createAffectedPathClosure } from './affected-path-closure.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function nextWorldSnapshot(current, facts, { trusted = false, revision = null } = {}) {
  if (trusted) {
    const computedRevision = revisionOfWorldFacts(facts);
    if (revision && computedRevision !== revision) {
      throw problem('INVALID_WORLD_REVISION', 'Trusted transition revision does not match facts', {
        revision,
        computedRevision
      });
    }
    return Object.freeze({
      contract: 'atom.world-snapshot',
      version: 1,
      worldId: current.worldId,
      revision: revision ?? computedRevision,
      facts
    });
  }
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

const semanticGuardReasons = new Set(['relation-endpoint', 'lock', 'shortcut']);

function revisionConflict(message, beforeRevision, currentRevision, conflictingPaths = []) {
  return problem('WORLD_REVISION_CONFLICT', message, {
    expectedRevision: beforeRevision,
    actualRevision: currentRevision,
    ...(conflictingPaths.length ? { conflictingPaths: [...new Set(conflictingPaths)].sort() } : {})
  });
}

function semanticConflictPaths(leftEntries = [], rightEntries = []) {
  const right = new Map(rightEntries.map((entry) => [entry.path, entry.reasons ?? []]));
  return leftEntries.flatMap((entry) => {
    const otherReasons = right.get(entry.path);
    if (!otherReasons) return [];
    const reasons = entry.reasons ?? [];
    const guarded = reasons.some((reason) => semanticGuardReasons.has(reason))
      || otherReasons.some((reason) => semanticGuardReasons.has(reason));
    const substantive = reasons.some((reason) => reason !== 'authorization-ancestor')
      && otherReasons.some((reason) => reason !== 'authorization-ancestor');
    return guarded && substantive ? [entry.path] : [];
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
        nextSnapshot,
        currentSnapshot: current
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

  async function prepareCandidate({
    command: rawCommand,
    transition,
    baseFacts,
    rebaseResult,
    allowRevisionRebase = true,
    transitionReadsSnapshot = true,
    transitionInputMode = transitionReadsSnapshot ? 'isolated-copy' : 'none'
  }) {
      const command = validateWorldCommandEnvelope(rawCommand);
      const existingReceipt = await journalRepository.findReceipt(command.commandId);
      if (existingReceipt) return { command, receipt: existingReceipt };

      const pending = await journalRepository.findPrepared(command.commandId);
      if (pending) return { command, pending };
      if (typeof transition !== 'function') {
        throw problem('INVALID_WORLD_TRANSITION', 'transition must be a function');
      }
      if (!['isolated-copy', 'trusted-readonly', 'none'].includes(transitionInputMode)) {
        throw problem('INVALID_WORLD_TRANSITION', 'transitionInputMode is invalid');
      }

      const authoritativeBefore = await worldRepository.read();
      let before = authoritativeBefore;
      if (before.revision !== command.expectedRevision) {
        if (allowRevisionRebase && Array.isArray(baseFacts)
          && revisionOfWorldFacts(baseFacts) === command.expectedRevision) {
          before = nextWorldSnapshot(authoritativeBefore, structuredClone(baseFacts), {
            trusted: true,
            revision: command.expectedRevision
          });
        } else {
          throw revisionConflict('Command was based on an obsolete world revision',
            command.expectedRevision, before.revision);
        }
      }

      const output = transitionInputMode === 'none'
        ? await transition()
        : transitionInputMode === 'trusted-readonly'
          ? await transition(before, command.payload)
          : await transition(structuredClone(before), structuredClone(command.payload));
      if (!output || !Array.isArray(output.facts)) {
        throw problem('INVALID_WORLD_TRANSITION', 'transition must return a facts array');
      }
      const after = nextWorldSnapshot(before, output.facts, {
        trusted: transitionInputMode === 'trusted-readonly',
        revision: output.revision ?? null
      });
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

      return { command, before, after, receipt, record, rebaseResult, allowRevisionRebase };
  }

  async function committedChain(beforeRevision, currentRevision) {
    const { receipts } = await journalRepository.readState();
    const chain = [];
    let cursor = beforeRevision;
    for (const entry of receipts) {
      if (cursor === currentRevision) break;
      if (entry.receipt?.beforeRevision !== cursor) continue;
      chain.push(entry);
      cursor = entry.receipt.afterRevision;
    }
    return cursor === currentRevision ? chain : null;
  }

  async function rebaseCandidate(candidate, current) {
    const { command, before, receipt, record } = candidate;
    if (candidate.allowRevisionRebase === false || record?.historyMode !== 'local-patch') {
      throw revisionConflict('Command was based on an obsolete world revision', before.revision, current.revision);
    }
    const chain = await committedChain(before.revision, current.revision);
    if (!chain || chain.some((entry) => entry.historyMode !== 'local-patch')) {
      throw revisionConflict('Local command cannot prove an unbroken precise history', before.revision, current.revision);
    }
    const candidateClosure = receipt.result?.affectedPathClosure ?? [];
    const semanticConflicts = chain.flatMap((entry) => semanticConflictPaths(
      candidateClosure,
      entry.receipt?.result?.affectedPathClosure ?? []
    ));
    if (semanticConflicts.length) {
      throw revisionConflict('Local command overlaps a guarded path changed since preparation',
        before.revision, current.revision, semanticConflicts);
    }
    let rebased;
    try {
      rebased = rebaseLocalWorldPatch(current.facts, record.patch);
    } catch (error) {
      if (!String(error?.code ?? '').startsWith('WORLD_PATCH_')) throw error;
      throw revisionConflict('Local command preimage changed since preparation', before.revision, current.revision,
        error.details?.path ? [error.details.path] : record.patch.changedPaths);
    }
    const after = nextWorldSnapshot(current, rebased.facts);
    const result = typeof candidate.rebaseResult === 'function'
      ? await candidate.rebaseResult({
          command, before, current, after, facts: rebased.facts,
          result: structuredClone(receipt.result)
        })
      : receipt.result;
    const nextReceipt = committedReceipt(command, current, after, result, rebased.patch.changedPaths);
    return {
      ...candidate,
      before: current,
      after,
      receipt: nextReceipt,
      record: {
        ...record,
        patch: rebased.patch,
        inversePatch: invertLocalWorldPatch(rebased.patch),
        receipt: nextReceipt
      }
    };
  }

  async function commitCandidate(candidate) {
      if (candidate.receipt && !candidate.record) return candidate.receipt;
      const { command } = candidate;
      const existingReceipt = await journalRepository.findReceipt(command.commandId);
      if (existingReceipt) return existingReceipt;
      const pending = candidate.pending ?? await journalRepository.findPrepared(command.commandId);
      if (pending) return recoverRecord(pending);
      let { before, after, receipt, record } = candidate;
      const current = await worldRepository.read();
      if (current.revision !== before.revision) {
        ({ before, after, receipt, record } = await rebaseCandidate(candidate, current));
      }

      await journalRepository.prepare(record);
      await faultInjector('after-prepare', structuredClone(record));
      await worldRepository.compareAndSwap({
        expectedRevision: before.revision,
        nextSnapshot: after,
        currentSnapshot: current
      });
      await faultInjector('after-world-write', structuredClone(record));
      return journalRepository.commit(command.commandId, receipt);
  }

  function execute(request) {
    return prepareCandidate(request).then((candidate) => serialize(async () => {
      // Binding/final-state checks must see all earlier journal decisions, even
      // when a candidate was prepared after their world write but before append.
      const existing = await request.validateCommit?.();
      return existing ?? commitCandidate(candidate);
    }));
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
      const candidate = await prepareCandidate({
        command,
        transitionReadsSnapshot: false,
        transition: () => target.historyMode === 'local-patch'
          ? ({
              facts: applyLocalWorldPatch(current.facts, target.inversePatch),
              changedPaths: target.inversePatch.changedPaths,
              result: {
                restoredCommandId: targetCommandId,
                affectedAtoms: target.receipt.affectedAtoms,
                affectedAtomsComplete: true,
                ...(target.receipt.result?.previousCompatibilityManifest
                  ? { compatibilityManifest: target.receipt.result.previousCompatibilityManifest }
                  : {})
              }
            })
          : ({
              facts: structuredClone(target.before.facts),
              result: {
                restoredCommandId: targetCommandId,
                ...(target.receipt.result?.previousCompatibilityManifest
                  ? { compatibilityManifest: target.receipt.result.previousCompatibilityManifest }
                  : {})
              }
            })
      });
      return commitCandidate(candidate);
    });
  }

  function recordProgramExecution(request) {
    return serialize(() => journalRepository.recordProgramExecution(request));
  }

  function inspectCommitted(project = (snapshot) => snapshot) {
    if (typeof project !== 'function') {
      throw problem('INVALID_COMMITTED_INSPECTION', 'Committed inspection requires a projection function');
    }
    return serialize(async () => {
      await recoverUnsafe();
      return project(await worldRepository.read());
    });
  }

  return Object.freeze({ execute, recover, rollback, recordProgramExecution, inspectCommitted });
}
