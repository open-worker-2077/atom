import {
  validateWorldCommandEnvelope,
  validateWorldReceipt,
  validateWorldSnapshot
} from '../public/contracts.mjs';
import { affectedAtomsBetween, normalizeAffectedAtoms } from './year-ring.mjs';
import { revisionOfWorldFacts } from './world-revision.mjs';
import { isDeepStrictEqual } from 'node:util';

import {
  applyLocalWorldPatch,
  createLocalWorldPatch,
  invertLocalWorldPatch,
  localWorldPatchReproducesFacts,
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

const semanticGuardReasons = new Set([
  'relation-endpoint', 'lock-exact', 'lock-subtree', 'shortcut', 'reference'
]);

function revisionConflict(message, beforeRevision, currentRevision, conflictingPaths = []) {
  return problem('WORLD_REVISION_CONFLICT', message, {
    expectedRevision: beforeRevision,
    actualRevision: currentRevision,
    ...(conflictingPaths.length ? { conflictingPaths: [...new Set(conflictingPaths)].sort() } : {})
  });
}

function semanticConflictPaths(leftEntries = [], rightEntries = []) {
  const intersects = (left, right) => left === right
    || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  const conflicts = [];
  for (const left of leftEntries) {
    const leftReasons = left.reasons ?? [];
    const leftSubstantive = leftReasons.some((reason) => reason !== 'authorization-ancestor');
    for (const right of rightEntries) {
      const rightReasons = right.reasons ?? [];
      const rightSubstantive = rightReasons.some((reason) => reason !== 'authorization-ancestor');
      if (!leftSubstantive || !rightSubstantive) continue;
      const leftSubtreeLock = leftReasons.includes('lock-subtree');
      const rightSubtreeLock = rightReasons.includes('lock-subtree');
      if ((leftSubtreeLock || rightSubtreeLock) && intersects(left.path, right.path)) {
        conflicts.push(leftSubtreeLock ? left.path : right.path);
        continue;
      }
      const exactGuard = leftReasons.some((reason) => semanticGuardReasons.has(reason))
        || rightReasons.some((reason) => semanticGuardReasons.has(reason));
      if (exactGuard && left.path === right.path) conflicts.push(left.path);
    }
  }
  return conflicts;
}

function completeClosureFor(record) {
  if (record?.historyMode !== 'local-patch') return null;
  const result = record.receipt?.result;
  const closure = createAffectedPathClosure({
    changedPaths: record.patch?.changedPaths,
    patch: record.patch,
    relationEndpoints: result?.relationEndpoints,
    lockPaths: result?.lockPaths,
    shortcutPaths: result?.shortcutPaths,
    referencePaths: result?.referencePaths,
    complete: result?.affectedPathClosureComplete
  });
  if (!closure.complete || !isDeepStrictEqual(closure.entries, result?.affectedPathClosure)) return null;
  return closure.entries;
}

function verifiedLegacyPreparedIdentity(record) {
  if (record?.historyMode === 'local-patch') return null;
  let command;
  let before;
  let after;
  let receipt;
  try {
    command = validateWorldCommandEnvelope(record?.command);
    before = validateWorldSnapshot(record?.before);
    after = validateWorldSnapshot(record?.after);
    receipt = validateWorldReceipt(record?.receipt);
  } catch {
    return null;
  }
  if (record.commandId !== command.commandId
    || record.correlationId !== command.correlationId
    || receipt.commandId !== command.commandId
    || receipt.correlationId !== command.correlationId
    || command.expectedRevision !== before.revision
    || revisionOfWorldFacts(before.facts) !== before.revision
    || revisionOfWorldFacts(after.facts) !== after.revision
    || receipt.beforeRevision !== before.revision
    || receipt.afterRevision !== after.revision
    || before.worldId !== after.worldId) return null;
  return Object.freeze({
    commandId: command.commandId,
    worldId: before.worldId,
    beforeRevision: before.revision,
    afterRevision: after.revision
  });
}

function matchesLegacyPreparedEvidence(evidence, identity) {
  return evidence?.contract === 'atom.legacy-prepared-evidence'
    && evidence.version === 1
    && [1, 2].includes(evidence.sourceSchemaVersion)
    && evidence.cutoverIdentity === 'pre-local-commit-cutover'
    && evidence.commandId === identity?.commandId
    && evidence.worldId === identity?.worldId
    && evidence.beforeRevision === identity?.beforeRevision
    && evidence.afterRevision === identity?.afterRevision;
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
    const recordWorldId = record.historyMode === 'local-patch'
      ? record.patch.worldId
      : record.after.worldId;
    const beforeRevision = record.historyMode === 'local-patch'
      ? record.patch.beforeRevision
      : record.before.revision;
    const afterRevision = record.historyMode === 'local-patch'
      ? record.patch.afterRevision
      : record.after.revision;
    const identity = { commandId: record.commandId, beforeRevision, afterRevision };
    await worldRepository.recoverIndeterminateCommit?.(identity);
    const current = await worldRepository.read();
    if (current.worldId !== recordWorldId) {
      throw problem('TRANSACTION_RECOVERY_CONFLICT', 'Prepared transaction belongs to another world');
    }
    const durableEvidence = typeof worldRepository.durableCommitEvidence === 'function'
      ? await worldRepository.durableCommitEvidence(identity)
      : null;
    const legacyIdentity = current.revision === afterRevision
      ? verifiedLegacyPreparedIdentity(record)
      : null;
    const legacyEvidence = !durableEvidence && legacyIdentity
      ? await journalRepository.legacyPreparedEvidence?.(legacyIdentity)
      : null;
    const verifiedLegacyAfterWrite = matchesLegacyPreparedEvidence(legacyEvidence, legacyIdentity);
    if (!durableEvidence && current.revision === beforeRevision) {
      const nextSnapshot = record.historyMode === 'local-patch'
        ? nextWorldSnapshot(current, applyLocalWorldPatch(current.facts, record.patch))
        : record.after;
      if (nextSnapshot.revision !== afterRevision) {
        throw problem('TRANSACTION_RECOVERY_CONFLICT', 'Prepared patch does not produce its committed revision');
      }
      if (record.historyMode === 'local-patch' && typeof worldRepository.appendLocalCommit === 'function') {
        await worldRepository.appendLocalCommit({
          commandId: record.commandId,
          expectedRevision: beforeRevision,
          nextSnapshot,
          patch: record.patch
        });
      } else {
        await worldRepository.compareAndSwap({
          commandId: record.commandId,
          expectedRevision: beforeRevision,
          nextSnapshot,
          currentSnapshot: current
        });
      }
      if (typeof worldRepository.hasDurableCommit === 'function'
        && !await worldRepository.hasDurableCommit(identity)) {
        throw problem('TRANSACTION_RECOVERY_CONFLICT', 'Recovered world write lacks exact durable command evidence', identity);
      }
    } else if (!durableEvidence && !verifiedLegacyAfterWrite) {
      const successor = await worldRepository.durableSuccessor?.(beforeRevision);
      if (successor && successor.commandId !== record.commandId
        && typeof journalRepository.abort === 'function') {
        await journalRepository.abort(record.commandId, {
          reason: 'superseded-durable-command',
          successor
        });
        return null;
      }
      throw problem('TRANSACTION_RECOVERY_CONFLICT', 'World diverged from a prepared transaction', {
        commandId: record.commandId,
        actualRevision: current.revision,
        beforeRevision,
        afterRevision
      });
    }
    const receipt = await journalRepository.commit(record.commandId, record.receipt);
    worldRepository.scheduleCompaction?.();
    return receipt;
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
      const declaredPatch = Array.isArray(output.changedPaths) && output.changedPaths.length
        ? createLocalWorldPatch({
            worldId: before.worldId,
            beforeRevision: before.revision,
            afterRevision: after.revision,
            beforeFacts: before.facts,
            afterFacts: after.facts,
            changedPaths: output.changedPaths
          })
        : null;
      const patch = declaredPatch && localWorldPatchReproducesFacts(
        before.facts, after.facts, declaredPatch
      ) ? declaredPatch : null;
      const affectedClosure = patch ? createAffectedPathClosure({
        changedPaths: patch.changedPaths,
        patch,
        relationEndpoints: output.result?.relationEndpoints,
        lockPaths: output.result?.lockPaths,
        shortcutPaths: output.result?.shortcutPaths,
        referencePaths: output.result?.referencePaths,
        complete: output.result?.affectedPathClosureComplete
      }) : null;
      const preciseLocal = affectedClosure?.complete === true;
      const preciseAffectedAtoms = preciseLocal ? [
        ...(output.result?.affectedAtoms ?? []),
        ...affectedClosure.paths.map((path) => ({ path, axes: [] }))
      ] : output.result?.affectedAtoms;
      const receiptResult = preciseLocal ? {
        ...(output.result ?? {}),
        affectedAtoms: preciseAffectedAtoms,
        affectedAtomsComplete: true,
        affectedPathClosureComplete: true,
        affectedPathClosure: affectedClosure.entries
      } : {
        ...(output.result ?? {}),
        affectedPathClosureComplete: false
      };
      const receipt = committedReceipt(command, before, after, receiptResult,
        preciseLocal ? output.changedPaths : null);
      const record = preciseLocal ? {
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
    const candidateClosure = completeClosureFor(record);
    if (candidate.allowRevisionRebase === false || !candidateClosure) {
      throw revisionConflict('Command was based on an obsolete world revision', before.revision, current.revision);
    }
    const chain = await committedChain(before.revision, current.revision);
    const chainClosures = chain?.map(completeClosureFor);
    if (!chain || chainClosures.some((closure) => !closure)) {
      throw revisionConflict('Local command cannot prove an unbroken precise history', before.revision, current.revision);
    }
    const semanticConflicts = chain.flatMap((entry, index) => semanticConflictPaths(
      candidateClosure,
      chainClosures[index]
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
      if (record.historyMode === 'local-patch' && typeof worldRepository.appendLocalCommit === 'function') {
        await worldRepository.appendLocalCommit({
          commandId: record.commandId,
          expectedRevision: before.revision,
          nextSnapshot: after,
          patch: record.patch
        });
      } else {
        await worldRepository.compareAndSwap({
          commandId: record.commandId,
          expectedRevision: before.revision,
          nextSnapshot: after,
          currentSnapshot: current
        });
      }
      await faultInjector('after-world-write', structuredClone(record));
      const committed = await journalRepository.commit(command.commandId, receipt);
      worldRepository.scheduleCompaction?.();
      return committed;
  }

  function execute(request) {
    return prepareCandidate(request).then((candidate) => serialize(async () => {
      // Binding/final-state checks must see all earlier journal decisions, even
      // when a candidate was prepared after their world write but before append.
      await recoverUnsafe();
      const existing = await request.validateCommit?.();
      return existing ?? commitCandidate(candidate);
    }));
  }

  function rollback({ targetCommandId, command, rebaseResult }) {
    return serialize(async () => {
      await recoverUnsafe();
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
      if (current.revision !== targetAfterRevision && target.historyMode !== 'local-patch') {
        throw problem('ROLLBACK_WORLD_DIVERGED', 'Rollback target is not the latest world transition', {
          targetCommandId,
          targetAfterRevision,
          actualRevision: current.revision
        });
      }
      let rebasedInverse = null;
      if (target.historyMode === 'local-patch') {
        if (current.revision !== targetAfterRevision) {
          const targetClosure = completeClosureFor(target);
          const chain = targetClosure
            ? await committedChain(targetAfterRevision, current.revision)
            : null;
          const chainClosures = chain?.map(completeClosureFor);
          const conflictingPaths = chain && chainClosures?.every(Boolean)
            ? chain.flatMap((entry, index) => semanticConflictPaths(
                targetClosure,
                chainClosures[index]
              ))
            : [];
          if (!chain || chainClosures.some((closure) => !closure) || conflictingPaths.length) {
            throw problem('ROLLBACK_WORLD_DIVERGED',
              'Rollback target is followed by an overlapping or unproven world transition', {
                targetCommandId,
                targetAfterRevision,
                actualRevision: current.revision,
                ...(conflictingPaths.length ? {
                  conflictingPaths: [...new Set(conflictingPaths)].sort()
                } : {})
              });
          }
        }
        try {
          rebasedInverse = rebaseLocalWorldPatch(current.facts, target.inversePatch);
        } catch (error) {
          if (!String(error?.code ?? '').startsWith('WORLD_PATCH_')) throw error;
          throw problem('ROLLBACK_WORLD_DIVERGED', 'Rollback target preimage changed', {
            targetCommandId,
            targetAfterRevision,
            actualRevision: current.revision,
            conflictingPaths: error.details?.path
              ? [error.details.path]
              : target.inversePatch.changedPaths
          });
        }
      }
      let rollbackResult = {
        restoredCommandId: targetCommandId,
        ...(target.historyMode === 'local-patch' ? {
          affectedAtoms: target.receipt.affectedAtoms,
          affectedAtomsComplete: true,
          relationEndpoints: target.receipt.result?.relationEndpoints ?? [],
          lockPaths: target.receipt.result?.lockPaths ?? [],
          shortcutPaths: target.receipt.result?.shortcutPaths ?? [],
          referencePaths: target.receipt.result?.referencePaths ?? [],
          affectedPathClosureComplete:
            target.receipt.result?.affectedPathClosureComplete === true
        } : {}),
        ...(target.receipt.result?.previousCompatibilityManifest
          ? { compatibilityManifest: target.receipt.result.previousCompatibilityManifest }
          : {})
      };
      if (current.revision !== targetAfterRevision && typeof rebaseResult === 'function') {
        rollbackResult = await rebaseResult({
          command,
          current,
          after: nextWorldSnapshot(current, rebasedInverse.facts),
          facts: rebasedInverse.facts,
          result: rollbackResult
        });
      }
      const candidate = await prepareCandidate({
        command,
        rebaseResult,
        transitionReadsSnapshot: false,
        transition: () => target.historyMode === 'local-patch'
          ? ({
              facts: rebasedInverse.facts,
              changedPaths: rebasedInverse.patch.changedPaths,
              result: rollbackResult
            })
          : ({
              facts: structuredClone(target.before.facts),
              result: rollbackResult
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
