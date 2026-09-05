import crypto from 'node:crypto';
import path from 'node:path';
import { executeAtomLanguage } from '../../../work-engine/atom-language/engine.mjs';
import { createWorldService } from '../public/world-service.mjs';
import { createTransactionalWorldPersistence } from './transactional-world-persistence.mjs';

// Only live invocations are joined here. All completed results and restart
// decisions come from the central journal, never this transient rendezvous.
const activeInteractions = new Map();
const recoveringWorlds = new Map();

function interactionBinding(request) {
  return crypto.createHash('sha256').update(JSON.stringify({ source: request.source, agentPath: request.interaction?.agent?.path ?? null,
    history: request.history ?? [], trustedMaintenance: request.trustedMaintenance === true,
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
      onAuthoritativeWrite: options.onAuthoritativeWrite
    })
  ));
  const transactions = new Map();
  const readiness = new WeakMap();
  const recoveryRequests = new WeakMap();

  function transactionFor(request) {
    const key = `${request.contextFile}\0${request.projectionFile}`;
    if (!transactions.has(key)) transactions.set(key, transactionProvider(request));
    return transactions.get(key);
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
      options.onPersistenceStage?.({
        stage,
        durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000
      });
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

  async function manifestFor(persistence) {
    const state = readinessFor(persistence);
    if (!state.manifest || state.compatibilityGeneration !== persistence.compatibilityGeneration) {
      state.compatibilityGeneration = persistence.compatibilityGeneration;
      state.manifest = recoverPersistence(persistence)
        .then(() => typeof persistence.compatibilityManifest === 'function'
          ? timed('manifest', () => persistence.compatibilityManifest()) : null)
        .catch(error => { state.manifest = null; throw error; });
    }
    return state.manifest;
  }

  async function resumePendingExecutions(request, persistence, entry) {
    if (!request.programScheduler || entry.recovering || readinessFor(persistence).pendingRecovered) return;
    readinessFor(persistence).pendingRecovered = true;
    const worldKey = path.resolve(request.contextFile);
    if (recoveringWorlds.has(worldKey)) return recoveringWorlds.get(worldKey);
    const recovering = (async () => {
      for (const execution of await persistence.pendingProgramExecutions?.() ?? []) {
        const id = execution.sourceReceipt.correlationId;
        if (id === request.interaction.id || activeInteractions.has(`${worldKey}\0${id}`)) continue;
        const recoveryRequest = { ...request, source: execution.sourceReceipt.source,
          interaction: structuredClone(execution.event.interaction), history: [],
          trustedMaintenance: false, bypassProgramLocks: false, onCommitted: undefined };
        recoveryRequests.set(recoveryRequest, execution.event.binding);
        await service.executeLegacy(recoveryRequest);
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
      if (execution.outcome?.result && execution.outcome.status !== 'pending') return execution.outcome.result;
    }
    request.signal?.throwIfAborted?.();
    const compatibilityManifest = await manifestFor(persistence);
    const transactionTransformLog = typeof persistence.transformLogEntries === 'function'
      ? await timed('transform-log', () => persistence.transformLogEntries())
      : [];
    let sourceReceipt = execution?.sourceReceipt ?? null;
    const attemptId = `${request.interaction.id}:subsequent:${crypto.randomUUID()}`;
    if (execution && (!execution.outcome || execution.outcome.status === 'pending')) {
      await persistence.recordProgramExecution({ sourceCommandId: sourceReceipt.commandId,
        outcome: { ...execution.outcome, status: 'pending', attemptId } });
    }
    const run = (recovery = execution) => timed('engine.execute', () => execute({
      ...request,
      ...(recovery ? { programExecution: recovery,
        interaction: structuredClone(recovery.event.interaction) } : {}),
      interactionBinding: entry.binding,
      compatibilityManifest,
      transactionTransformLog,
      onCommitted: async result => {
        entry.pending = structuredClone(result);
        if (sourceReceipt && result.subsequentExecution?.status === 'pending') {
          await persistence.recordProgramExecution({ sourceCommandId: sourceReceipt.commandId,
            outcome: { ...result.subsequentExecution, attemptId, result: structuredClone(result) } });
        }
        await request.onCommitted?.(result);
      },
      commitWorld: async (transition) => {
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
        if (transition.postCommitEvent) sourceReceipt = receipt;
        return receipt;
      }
    }));
    let result = await run();
    if (!sourceReceipt) return result;
    execution = await persistence.programExecution(sourceReceipt.commandId);
    // A stale candidate has no committed effects. Re-evaluate the exact event
    // against current facts once; a confirmed child is read, never run again.
    if (result.subsequentExecution?.errors?.some(({ code }) => code === 'WORLD_REVISION_CONFLICT')) {
      const conflict = result.subsequentExecution.errors.find(({ code }) => code === 'WORLD_REVISION_CONFLICT');
      result = await run(execution);
      result.warnings = [...(result.warnings ?? []), conflict];
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
    if (request.signal?.aborted && !latest.childReceipt) {
      result.subsequentExecution = { ...result.subsequentExecution, status: 'pending' };
      result.warnings = [...(result.warnings ?? []).filter(({ code }) => code !== 'ATOM_SUBSEQUENT_EXECUTION_FAILED'),
        { code: 'ATOM_SUBSEQUENT_EXECUTION_PENDING', message: '来源事实已提交；中断的后续运行待恢复',
          correlationId: `${request.interaction.id}:subsequent` }];
    }
    result.subsequentExecution = { ...result.subsequentExecution, attemptId,
      sourceCommandId: sourceReceipt.commandId,
      ...(latest.childReceipt ? { childCommandId: latest.childReceipt.commandId } : {}) };
    const outcome = await persistence.recordProgramExecution({ sourceCommandId: sourceReceipt.commandId,
      outcome: { ...result.subsequentExecution, result: structuredClone(result) } });
    return outcome.result ?? result;
  }

  const service = createWorldService({
    executeLegacyInteraction: (original) => {
      if (!original.contextFile || !original.projectionFile) return execute(original);
      const request = { ...original, interaction: { ...original.interaction,
        id: original.interaction?.id ?? crypto.randomUUID() } };
      const key = `${path.resolve(request.contextFile)}\0${request.interaction.id}`;
      const recoveredBinding = recoveryRequests.get(original);
      const binding = recoveredBinding ?? interactionBinding(request);
      const active = activeInteractions.get(key);
      if (active) {
        assertBinding(active.binding, binding);
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
      const entry = { binding, recovering: recoveredBinding !== undefined, pending: null, running: null };
      activeInteractions.set(key, entry);
      entry.running = executeInteraction(request, entry).finally(() => activeInteractions.delete(key));
      return entry.running;
    }
  });
  return Object.freeze({
    ...service,
    async compatibilityManifest(request) {
      if (!request?.contextFile || !request?.projectionFile) return null;
      const persistence = transactionFor(request);
      return structuredClone(await manifestFor(persistence));
    }
  });
}
