import crypto from 'node:crypto';
import path from 'node:path';
import { executeAtomLanguage } from '../../../work-engine/atom-language/engine.mjs';
import { createWorldService } from '../public/world-service.mjs';
import { createTransactionalWorldPersistence } from './transactional-world-persistence.mjs';
import { prepareCommittedAtomVersion, prepareOwnedCommittedAtomVersion } from '../../../work-engine/atom-language/context-store.mjs';
import { DEFAULT_WORLD_SHUTDOWN_TIMEOUT_MS, worldShutdownDeadline, withinWorldShutdown } from '../world-runtime/world-shutdown.mjs';
import { isHardCapacityBlocked, isWorldCapacityError } from '../world-runtime/pending-world-capacity.mjs';

// Only live invocations are joined here. All completed results and restart
// decisions come from the central journal, never this transient rendezvous.
const activeInteractions = new Map();
const recoveringWorlds = new Map();

function interactionBinding(request) {
  return crypto.createHash('sha256').update(JSON.stringify({ source: request.source, agentPath: request.interaction?.agent?.path ?? null,
    history: request.history ?? [], trustedMaintenance: request.trustedMaintenance === true,
    ...(request.humanAuthority === true ? { humanAuthority: true } : {}),
    bypassProgramLocks: request.bypassProgramLocks === true })).digest('hex');
}

function assertBinding(expected, actual) {
  if (expected !== actual) throw Object.assign(new Error('同一 Atom 请求标识不能对应不同命令或 Agent'), {
    code: 'ATOM_INTERACTION_ID_CONFLICT'
  });
}

export function createLegacyWorldService(options = {}) {
  const execute = options.execute ?? executeAtomLanguage;
  const transactionProvider = options.transactionProvider ?? ((request) => (
    createTransactionalWorldPersistence({
      contextFile: request.contextFile,
      projectionFile: request.projectionFile,
      publishLegacyProjection: options.publishLegacyProjection !== false,
      runtimeAuthority: options.memoryAuthoritative === true ? 'memory' : 'disk',
      saveSchedule: options.saveSchedule,
      pendingLimits: options.pendingLimits,
      writerFactory: options.writerFactory,
      shutdownTimeoutMs: options.shutdownTimeoutMs,
      onAuthoritativeWrite: options.onAuthoritativeWrite,
      onSaved: options.onSaved
    })
  ));
  const transactions = new Map();
  const readiness = new WeakMap();
  const recoveryRequests = new WeakMap();
  let closing = false;
  let closePromise = null;

  function captureSaveState(request) {
    if (options.memoryAuthoritative !== true || !request?.contextFile || !request?.projectionFile) return null;
    const persistence = transactions.get(`${request.contextFile}\0${request.projectionFile}`);
    return persistence ? structuredClone(persistence.saveStatus ?? null) : null;
  }

  function withSaveState(request, result) {
    const saveState = captureSaveState(request);
    return saveState && result && typeof result === 'object' ? { ...result, saveState } : result;
  }

  function beginClose() {
    closing = true;
    for (const persistence of transactions.values()) {
      readinessFor(persistence).unsubscribeCapacity?.();
      persistence.beginClose?.();
    }
  }

  function transactionFor(request) {
    const key = `${request.contextFile}\0${request.projectionFile}`;
    if (!transactions.has(key)) {
      if (closing) throw Object.assign(new Error('World service is closing'), { code: 'WORLD_SAVE_WORKER_CLOSED' });
      const persistence = transactionProvider(request);
      transactions.set(key, persistence);
      readinessFor(persistence).unsubscribeCapacity = persistence.subscribeCapacityRelease?.(() => rearmCapacity(persistence));
    }
    const persistence = transactions.get(key);
    if (request.programScheduler) readinessFor(persistence).resumeRequest = { ...request,
      source: undefined, history: [], interaction: { id: '' }, signal: undefined,
      onCommitted: undefined, onSubsequentSettled: undefined };
    return persistence;
  }

  function readinessFor(persistence) {
    let state = readiness.get(persistence);
    if (!state) {
      state = { recovery: null, pendingRecovered: false };
      readiness.set(persistence, state);
    }
    return state;
  }

  async function timed(stage, work) {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      const measurement = {
        stage,
        durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000
      };
      options.onPersistenceStage?.(measurement);
      if (process.env.ATOM_PERF_TRACE === '1') {
        process.stderr.write(`${JSON.stringify({ event: 'world-service-stage', ...measurement })}\n`);
      }
    }
  }

  function recoverPersistence(persistence) {
    const state = readinessFor(persistence);
    if (!state.recovery) {
      state.recovery = timed('recover', () => persistence.recover())
        .catch((error) => {
          state.recovery = null;
          throw error;
        });
    }
    return state.recovery;
  }

  async function committedSnapshotFor(persistence) {
    const state = readinessFor(persistence);
    if (!state.committedSnapshot || state.compatibilityGeneration !== persistence.compatibilityGeneration) {
      state.compatibilityGeneration = persistence.compatibilityGeneration;
      state.committedSnapshot = recoverPersistence(persistence)
        .then(async () => {
          if (typeof persistence.readCommittedSnapshot === 'function') {
            return timed('committed-snapshot', async () => {
              const owned = await persistence.readOwnedCommittedSnapshot?.();
              if (Array.isArray(owned?.facts)) return prepareOwnedCommittedAtomVersion(owned);
              const snapshot = await persistence.readCommittedSnapshot();
              return Array.isArray(snapshot?.facts) ? prepareCommittedAtomVersion(snapshot) : snapshot;
            });
          }
          const compatibilityManifest = typeof persistence.compatibilityManifest === 'function'
            ? await timed('manifest', () => persistence.compatibilityManifest())
            : null;
          return compatibilityManifest ? { compatibilityManifest } : null;
        })
        .catch(error => { state.committedSnapshot = null; throw error; });
    }
    return state.committedSnapshot;
  }

  async function manifestFor(persistence) {
    return (await committedSnapshotFor(persistence))?.compatibilityManifest ?? null;
  }

  function rearmCapacity(persistence) {
    const state = readinessFor(persistence);
    if (closing || !state.resumeRequest) return;
    state.resumeRequested = true;
    if (state.resumeScheduled || state.capacityResuming) return;
    state.resumeScheduled = true;
    setImmediate(async () => {
      state.resumeScheduled = false;
      if (closing) return;
      state.resumeRequested = false;
      state.capacityResuming = true;
      state.pendingRecovered = false;
      try { await resumePendingExecutions(state.resumeRequest, persistence, { recovering: false, capacityRearm: true }); }
      catch { /* A later actual release can retry retained pending sources. */ }
      finally {
        state.capacityResuming = false;
        if (state.resumeRequested) rearmCapacity(persistence);
      }
    });
  }

  function capacityPendingResult(request, execution, reason = execution.outcome?.capacityBlocked) {
    return { ok: true, language: 'atom', command: 'transform', changed: true,
      contextFile: request.contextFile, projectionFile: request.projectionFile,
      interactionId: execution.sourceReceipt.correlationId,
      revisionBefore: execution.sourceReceipt.beforeRevision.replace(/^sha256:/u, ''),
      revisionAfter: (execution.childReceipt?.afterRevision ?? execution.sourceReceipt.afterRevision).replace(/^sha256:/u, ''),
      result: null, messages: [], errors: [], warnings: [{ code: 'ATOM_PROGRAM_CAPACITY_PENDING',
        message: '来源事实已接受；后续结果因容量限制待处理', cause: reason?.code }],
      subsequentExecution: { status: 'pending', sourceCommandId: execution.sourceReceipt.commandId,
        ...(execution.childReceipt ? { childCommandId: execution.childReceipt.commandId } : {}), capacityBlocked: reason } };
  }

  async function resumePendingExecutions(request, persistence, entry) {
    if (closing || !request.programScheduler || entry.recovering || readinessFor(persistence).pendingRecovered) return;
    readinessFor(persistence).pendingRecovered = true;
    const worldKey = path.resolve(request.contextFile);
    if (recoveringWorlds.has(worldKey)) {
      // Joining an older recovery must not consume a release that it did not see.
      if (entry.capacityRearm) readinessFor(persistence).resumeRequested = true;
      return recoveringWorlds.get(worldKey);
    }
    const recovering = (async () => {
      for (const execution of await persistence.pendingProgramExecutions?.() ?? []) {
        if (isHardCapacityBlocked(execution.outcome)) continue;
        const id = execution.sourceReceipt.correlationId;
        if (id === request.interaction.id) continue;
        const active = activeInteractions.get(`${worldKey}\0${id}`);
        if (active) {
          if (entry.capacityRearm) {
            const state = readinessFor(persistence);
            state.releaseWaiters ??= new WeakSet();
            if (!state.releaseWaiters.has(active)) {
              state.releaseWaiters.add(active);
              const settled = () => rearmCapacity(persistence);
              active.running.then(settled, settled);
            }
          }
          continue;
        }
        const recoveryRequest = { ...request, source: execution.sourceReceipt.source,
          interaction: structuredClone(execution.event.interaction), history: [],
          trustedMaintenance: false, humanAuthority: false, bypassProgramLocks: false,
          onCommitted: undefined, onSubsequentSettled: undefined };
        recoveryRequests.set(recoveryRequest, execution.event.binding);
        const result = await service.executeLegacy(recoveryRequest);
        if (result.subsequentExecution?.capacityBlocked?.retryable) break;
      }
    })();
    recoveringWorlds.set(worldKey, recovering);
    try { await recovering; }
    finally { recoveringWorlds.delete(worldKey); }
  }

  async function executeInteraction(request, entry) {
    request.signal?.throwIfAborted?.();
    if (!request.contextFile || !request.projectionFile) return execute(request);
    const persistence = transactionFor(request);
    await recoverPersistence(persistence);
    await resumePendingExecutions(request, persistence, entry);
    let execution = await persistence.programExecutionForInteraction?.(request.interaction.id) ?? null;
    if (execution) {
      assertBinding(execution.event.binding, entry.binding);
      if (isHardCapacityBlocked(execution.outcome)) return capacityPendingResult(request, execution);
      if (execution.outcome?.result && execution.outcome.status !== 'pending') return execution.outcome.result;
      try { await persistence.reserveProgramExecution?.(execution.sourceReceipt.commandId); }
      catch (error) {
        if (!isWorldCapacityError(error)) throw error;
        return capacityPendingResult(request, execution, { code: error.code, retryable: error.code === 'WORLD_SAVE_BACKPRESSURE' });
      }
    }
    request.signal?.throwIfAborted?.();
    const committedSnapshot = await committedSnapshotFor(persistence);
    const transactionTransformLog = typeof persistence.transformLogEntries === 'function'
      ? await timed('transform-log', () => persistence.transformLogEntries())
      : [];
    let sourceReceipt = execution?.sourceReceipt ?? null;
    const attemptId = `${request.interaction.id}:subsequent:${crypto.randomUUID()}`;
    const outcomeWarnings = [];
    let businessSettled = false;
    let revalidatingConflict = false;
    let requestInterruptedCommit = false;
    const businessWarnings = [];
    let outcomeCapacityFailure = null;
    async function recordOutcome(outcome) {
      try {
        return await persistence.recordProgramExecution({ sourceCommandId: sourceReceipt.commandId, outcome });
      } catch (error) {
        if (isWorldCapacityError(error)) outcomeCapacityFailure = error;
        outcomeWarnings.push({ code: 'ATOM_PROGRAM_OUTCOME_PERSISTENCE_PENDING',
          message: '事实已提交，但后续结果未能持久保存；可用原交互标识恢复确认',
          cause: error.code ?? error.message, correlationId: request.interaction.id });
        return null;
      }
    }
    if (execution && (!execution.outcome || execution.outcome.status === 'pending')) {
      await recordOutcome({ ...execution.outcome, status: 'pending', attemptId });
      if (outcomeCapacityFailure) return capacityPendingResult(request, execution,
        { code: outcomeCapacityFailure.code, retryable: outcomeCapacityFailure.code === 'WORLD_SAVE_BACKPRESSURE' });
    }
    const run = (recovery = execution, snapshot = committedSnapshot) => timed('engine.execute', () => execute({
      ...request,
      ...(recovery ? { programExecution: recovery,
        interaction: structuredClone(recovery.event.interaction) } : {}),
      interactionBinding: entry.binding,
      compatibilityManifest: snapshot?.compatibilityManifest ?? null,
      ...(Array.isArray(snapshot?.facts) ? {
        committedSnapshot: snapshot,
        committedVersion: snapshot
      } : {}),
      acquireCommittedSnapshot: async () => {
        const latest = await committedSnapshotFor(persistence);
        return latest ?? null;
      },
      transactionTransformLog,
      ...(typeof persistence.claimCandidate === 'function' ? {
        claimCandidate: (facts) => persistence.claimCandidate(facts)
      } : {}),
      readDiscardEvidence: typeof persistence.readDiscardEvidence === 'function'
        ? (identity) => persistence.readDiscardEvidence(identity) : undefined,
      onSubsequentSettled: settleBusinessResult,
      onCommitted: async result => {
        entry.pending = structuredClone(result);
        try {
          await request.onCommitted?.({ ...result, warnings: [...(result.warnings ?? []), ...outcomeWarnings] });
        } finally {
          if (sourceReceipt && result.subsequentExecution?.status === 'pending') {
            await recordOutcome({ ...result.subsequentExecution, attemptId, result: structuredClone(result) });
          }
        }
      },
      commitWorld: async (transition) => {
        if (request.signal?.aborted) requestInterruptedCommit = true;
        request.signal?.throwIfAborted?.();
        let receipt;
        try {
          receipt = await persistence.commit({
            ...transition,
            source: request.source,
            correlationId: transition.correlationId ?? request.interaction?.id
          });
        } catch (error) {
          if (transition.postCommitEvent && error?.details?.receipt?.afterRevision) {
            sourceReceipt = error.details.receipt;
          }
          throw error;
        }
        readinessFor(persistence).manifest = null;
        readinessFor(persistence).committedSnapshot = null;
        if (transition.postCommitEvent) sourceReceipt = receipt;
        return receipt;
      }
    }));
    async function settleBusinessResult(result) {
      if (!sourceReceipt || businessSettled) return result;
      execution = await persistence.programExecution(sourceReceipt.commandId);
      const capacityFailure = [...(result.errors ?? []), ...(result.subsequentExecution?.errors ?? [])].find(isWorldCapacityError);
      if (capacityFailure) {
        const reason = { code: capacityFailure.code, retryable: capacityFailure.code === 'WORLD_SAVE_BACKPRESSURE' };
        await recordOutcome({ status: 'pending', attemptId, capacityBlocked: reason });
        businessSettled = true;
        entry.pending = capacityPendingResult(request, execution, reason);
        return entry.pending;
      }
      if (isHardCapacityBlocked(execution.outcome)) {
        businessSettled = true;
        return entry.pending = capacityPendingResult(request, execution);
      }
      // A stale candidate has no committed effects. Re-evaluate the exact event
      // against current facts once; a confirmed child is read, never run again.
      if (!revalidatingConflict && result.subsequentExecution?.errors?.some(({ code }) => code === 'WORLD_REVISION_CONFLICT')) {
        revalidatingConflict = true;
        const conflict = result.subsequentExecution.errors.find(({ code }) => code === 'WORLD_REVISION_CONFLICT');
        businessWarnings.push(conflict);
        const recoverySnapshot = await committedSnapshotFor(persistence);
        result = await run(execution, recoverySnapshot);
        if (businessSettled) return result;
      }
      if (result.ok === false) {
        const sourceResult = execution.outcome?.result ?? { ok: true, language: 'atom', command: 'transform',
          changed: true, contextFile: request.contextFile, projectionFile: request.projectionFile,
          interactionId: request.interaction.id, revisionBefore: sourceReceipt.beforeRevision.replace(/^sha256:/u, ''),
          result: null, messages: [], warnings: [] };
        result = { ...sourceResult, ok: true, errors: [], revisionAfter: result.revisionAfter,
          warnings: [...(sourceResult.warnings ?? []).filter(({ code }) => code !== 'ATOM_SUBSEQUENT_EXECUTION_PENDING'),
            { code: 'ATOM_SUBSEQUENT_EXECUTION_FAILED', message: '来源事实已提交，但后续 Program 执行失败', cause: result.errors?.[0]?.code }],
          subsequentExecution: { status: 'failed', sourceRevision: sourceReceipt.afterRevision.replace(/^sha256:/u, ''),
            revisionAfter: result.revisionAfter, errors: result.errors } };
      }
      const latest = await persistence.programExecution(sourceReceipt.commandId);
      // A worker's own bounded timeout is a determined failure. Resume only an
      // external cancellation that actually interrupted this execution/commit.
      const cancellationCode = request.signal?.aborted ? request.signal.reason?.code : null;
      const interrupted = requestInterruptedCommit || (cancellationCode != null
        && result.subsequentExecution?.errors?.some(error => error.code === cancellationCode));
      if (interrupted && !latest.childReceipt) {
        result.subsequentExecution = { ...result.subsequentExecution, status: 'pending' };
        result.warnings = [...(result.warnings ?? []).filter(({ code }) => code !== 'ATOM_SUBSEQUENT_EXECUTION_FAILED'),
          { code: 'ATOM_SUBSEQUENT_EXECUTION_PENDING', message: '来源事实已提交；中断的后续运行待恢复',
            correlationId: `${request.interaction.id}:subsequent` }];
      }
      result.subsequentExecution = { ...result.subsequentExecution, attemptId,
        sourceCommandId: sourceReceipt.commandId,
        ...(latest.childReceipt ? { childCommandId: latest.childReceipt.commandId } : {}) };
      result.warnings = [...(result.warnings ?? []), ...businessWarnings];
      const outcome = await recordOutcome({ ...result.subsequentExecution, result: structuredClone(result) });
      businessSettled = true;
      if (isHardCapacityBlocked(outcome)) {
        return entry.pending = capacityPendingResult(request, { ...execution, outcome });
      }
      if (!outcome) {
        return { ...result,
          warnings: [...(result.warnings ?? []).filter(({ code }) => code !== 'ATOM_SUBSEQUENT_EXECUTION_FAILED'), ...outcomeWarnings],
          subsequentExecution: { ...result.subsequentExecution, status: 'pending',
            observedStatus: result.subsequentExecution.status, outcomePersistence: 'pending' } };
      }
      const durable = outcome.result ?? result;
      entry.pending = structuredClone(durable);
      if (outcome.status !== 'pending') {
        for (const notify of entry.settledListeners) {
          try { await notify(structuredClone(durable)); }
          catch (error) {
            durable.warnings = [...(durable.warnings ?? []), {
              code: 'ATOM_SUBSEQUENT_NOTIFICATION_FAILED',
              message: '后续结果已保存，但结果通知失败；可用原交互标识重读',
              cause: error.code ?? error.message, correlationId: request.interaction.id
            }];
          }
        }
        entry.settledListeners.clear();
      }
      return durable;
    }
    const result = await run();
    return businessSettled ? result : settleBusinessResult(result);
  }

  function executeLegacyInteraction(original) {
      if (!original.contextFile || !original.projectionFile) return execute(original);
      const request = { ...original,
        ...(typeof original.onCommitted === 'function' ? {
          onCommitted: result => original.onCommitted(withSaveState(original, result))
        } : {}),
        ...(typeof original.onSubsequentSettled === 'function' ? {
          onSubsequentSettled: result => original.onSubsequentSettled(withSaveState(original, result))
        } : {}),
        interaction: { ...original.interaction,
        id: original.interaction?.id ?? crypto.randomUUID() } };
      const key = `${path.resolve(request.contextFile)}\0${request.interaction.id}`;
      const recoveredBinding = recoveryRequests.get(original);
      const binding = recoveredBinding ?? interactionBinding(request);
      const active = activeInteractions.get(key);
      if (active) {
        assertBinding(active.binding, binding);
        if (typeof request.onSubsequentSettled === 'function'
          && !['completed', 'failed'].includes(active.pending?.subsequentExecution?.status)) {
          active.settledListeners.add(request.onSubsequentSettled);
        }
        if (active.pending && typeof request.onCommitted === 'function') {
          return (async () => {
            let warning;
            try { await request.onCommitted(structuredClone(active.pending)); }
            catch (error) {
              warning = { code: 'ATOM_COMMITTED_NOTIFICATION_FAILED',
                message: '来源事实已提交，但回执通知失败；可用原交互标识重读结果',
                cause: error.code ?? error.message, correlationId: request.interaction.id };
            }
            const result = await active.running;
            return warning ? { ...result, warnings: [...(result.warnings ?? []), warning] } : structuredClone(result);
          })();
        }
        return active.pending ? Promise.resolve(structuredClone(active.pending)) : active.running;
      }
      const entry = { binding, recovering: recoveredBinding !== undefined, pending: null, running: null,
        settledListeners: new Set(typeof request.onSubsequentSettled === 'function' ? [request.onSubsequentSettled] : []) };
      activeInteractions.set(key, entry);
      entry.running = executeInteraction(request, entry).finally(() => activeInteractions.delete(key));
      return entry.running;
  }
  const service = createWorldService({
    executeLegacyInteraction: async original => withSaveState(original, await executeLegacyInteraction(original))
  });
  return Object.freeze({
    ...service,
    captureSaveState,
    async saveStatus(request) { return captureSaveState(request); },
    async flushSaves() {
      await Promise.all([...transactions.values()].map((persistence) => persistence.flushSaves?.()));
    },
    beginClose,
    closeSaves({ timeoutMs = options.shutdownTimeoutMs ?? DEFAULT_WORLD_SHUTDOWN_TIMEOUT_MS, deadline } = {}) {
      if (closePromise) return closePromise;
      const absoluteDeadline = worldShutdownDeadline({ timeoutMs, deadline });
      beginClose();
      closePromise = withinWorldShutdown(Promise.all([...transactions.values()]
        .map(persistence => persistence.closeSaves?.({ deadline: absoluteDeadline }))), absoluteDeadline);
      return closePromise;
    },
    async readCommittedSnapshot(request) {
      if (!request?.contextFile || !request?.projectionFile) return null;
      const persistence = transactionFor(request);
      return structuredClone(await committedSnapshotFor(persistence));
    },
    async readCommittedVersion(request) {
      if (!request?.contextFile || !request?.projectionFile) return null;
      return committedSnapshotFor(transactionFor(request));
    },
    async compatibilityManifest(request) {
      if (!request?.contextFile || !request?.projectionFile) return null;
      const persistence = transactionFor(request);
      return structuredClone(await manifestFor(persistence));
    }
  });
}
