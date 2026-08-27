function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function requireMethod(value, method, code, label) {
  if (typeof value?.[method] !== 'function') {
    throw problem(code, `${label} requires ${method}()`);
  }
}

function validateIntent(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    throw problem('INVALID_INTERACTION', 'Interaction intent must be an object');
  }
  if (typeof intent.source !== 'string' || !intent.source.trim()) {
    throw problem('INVALID_INTERACTION_SOURCE', 'Interaction source must be a non-empty string');
  }
  if (typeof intent.correlationId !== 'string' || !intent.correlationId.trim()) {
    throw problem('INVALID_CORRELATION_ID', 'Interaction requires a non-empty correlation id');
  }
  if (intent.agentPath !== undefined && (typeof intent.agentPath !== 'string' || !intent.agentPath.trim())) {
    throw problem('INVALID_AGENT_PATH', 'Agent path must be a non-empty string when provided');
  }
  if (intent.history !== undefined && !Array.isArray(intent.history)) {
    throw problem('INVALID_INTERACTION_HISTORY', 'Interaction history must be an array when provided');
  }
  return Object.freeze({
    source: intent.source,
    correlationId: intent.correlationId,
    agentPath: intent.agentPath,
    history: structuredClone(intent.history ?? [])
  });
}

function feedbackSource(source) {
  return /^submit(?:\s|$)/u.test(source.trim());
}

function performanceTrace(event, details) {
  if (process.env.ATOM_PERF_TRACE !== '1') return;
  process.stderr.write(`${JSON.stringify({ event, ...details })}\n`);
}

function readAffectedAtoms(result) {
  const affected = new Map();
  for (const item of result?.items ?? []) {
    for (const match of item?.matches ?? []) {
      const path = typeof match?.path === 'string' ? match.path.trim() : '';
      const ref = typeof match?.ref === 'string' ? match.ref.trim() : '';
      if (!path && !ref) continue;
      const key = `${path}\0${ref}`;
      affected.set(key, {
        ...(path ? { path } : {}),
        ...(ref ? { ref } : {}),
        axes: []
      });
    }
  }
  return [...affected.values()].sort((left, right) => (
    (left.path ?? left.ref).localeCompare(right.path ?? right.ref)
  ));
}

function diagnosticFailure(result) {
  const first = result?.errors?.[0];
  if (!first) return undefined;
  return {
    ...(typeof first.code === 'string' && first.code ? { code: first.code } : {}),
    ...(typeof first.message === 'string' && first.message ? { message: first.message } : {})
  };
}

function transformProgramFingerprint(result) {
  const fingerprint = result?.program?.fingerprint ?? result?.programIdentity?.fingerprint;
  return typeof fingerprint === 'string' && fingerprint.trim() ? fingerprint.trim() : undefined;
}

function withInteractionId(result, correlationId) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  return { ...result, interactionId: correlationId };
}

export function createInteractionRuntime({
  world,
  projections,
  feedback,
  agents,
  humanStatus,
  humanWorkspace,
  programRuntime,
  diagnostics = null,
  onStage = null
}) {
  requireMethod(world, 'execute', 'INVALID_WORLD_PORT', 'Interaction runtime world port');
  requireMethod(projections, 'publish', 'INVALID_PROJECTION_PORT', 'Interaction runtime projection port');
  requireMethod(projections, 'recover', 'INVALID_PROJECTION_PORT', 'Interaction runtime projection port');
  requireMethod(feedback, 'submit', 'INVALID_FEEDBACK_PORT', 'Interaction runtime feedback port');
  requireMethod(agents, 'resolve', 'INVALID_AGENT_DIRECTORY', 'Interaction runtime agent directory');
  requireMethod(humanStatus, 'translate', 'INVALID_HUMAN_STATUS_PORT', 'Interaction runtime human-status port');
  if (diagnostics) {
    requireMethod(diagnostics, 'record', 'INVALID_RUNTIME_DIAGNOSTIC_PORT', 'Interaction runtime diagnostic port');
  }

  let latestProjectionState = Object.freeze({ status: 'uninitialized' });

  async function timedStage(stage, work, interactionId = null) {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      try {
        onStage?.({
          stage,
          ...(interactionId ? { interactionId } : {}),
          durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000
        });
      } catch {
        // Local timing is observational and must never alter an interaction result.
      }
    }
  }

  async function interactionOf(intent) {
    return timedStage('interactionOf', async () => {
      const agent = intent.agentPath
        ? await timedStage('agents.resolve', () => agents.resolve(intent.agentPath), intent.correlationId)
        : null;
      return Object.freeze({ id: intent.correlationId, agent });
    }, intent.correlationId);
  }

  function projectionFailure(error) {
    const details = error?.details && typeof error.details === 'object' ? error.details : {};
    return Object.freeze({
      ...(typeof details.projection === 'string' && details.projection
        ? { projection: details.projection }
        : {}),
      cause: details.cause ?? error?.code ?? error?.name ?? 'PROJECTION_FAILED'
    });
  }

  function withProjectionOutcome(result, outcome) {
    if (!outcome) return result;
    if (outcome.status === 'published') {
      return { ...result, projectionStatus: 'published' };
    }
    return {
      ...result,
      projectionStatus: 'pending',
      projectionRecovery: { expectedRevision: outcome.expectedRevision },
      projectionFailure: outcome.failure,
      warnings: [
        ...(result.warnings ?? []),
        {
          code: 'PROJECTION_RECOVERY_PENDING',
          message: 'World facts are committed; a disposable projection is pending recovery',
          details: {
            expectedRevision: outcome.expectedRevision,
            ...outcome.failure
          }
        }
      ]
    };
  }

  async function publish(result) {
    if (!result?.ok || typeof result.revisionAfter !== 'string' || !result.revisionAfter) return null;
    try {
      const startedAt = performance.now();
      const published = await projections.publish({
        expectedRevision: result.revisionAfter,
        lockState: result.lockState
      });
      performanceTrace('projection-publish', {
        elapsedMs: Math.round(performance.now() - startedAt)
      });
      latestProjectionState = Object.freeze({
        status: 'published',
        expectedRevision: result.revisionAfter
      });
      return Object.freeze({ status: 'published', projection: published });
    } catch (error) {
      const failure = projectionFailure(error);
      latestProjectionState = Object.freeze({
        status: 'pending',
        expectedRevision: result.revisionAfter,
        failure
      });
      return Object.freeze({
        status: 'pending',
        expectedRevision: result.revisionAfter,
        failure
      });
    }
  }

  async function executeValidated(intent, options = {}) {
    const interactionStartedAt = performance.now();
    const interaction = await interactionOf(intent);
    if (feedbackSource(intent.source)) {
      return feedback.submit({
        source: intent.source,
        interaction,
        history: intent.history
      });
    }
    const executeWorld = (source, currentInteraction, currentOptions = options) => world.execute({
      source,
      interaction: currentInteraction,
      history: intent.history,
      ...(currentOptions.bypassProgramLocks ? { bypassProgramLocks: true } : {}),
      ...(currentOptions.programMode ? { programMode: currentOptions.programMode } : {}),
      programRuntime
    });
    const worldStartedAt = performance.now();
    let result = withInteractionId(await timedStage(
      'world.execute', () => executeWorld(intent.source, interaction), intent.correlationId
    ), intent.correlationId);
    performanceTrace('world-execute', {
      elapsedMs: Math.round(performance.now() - worldStartedAt),
      changed: result?.changed === true
    });
    const projectionMissing = result?.ok === false
      && result.errors?.some(({ code }) => code === 'ATOM_PROGRAM_PROJECTION_MISSING');
    if (projectionMissing && !options.programMode) {
      let preparation = withInteractionId(
        await executeWorld('atom', Object.freeze({
          ...interaction,
          id: `${interaction.id}:program-context`
        }), { ...options, programMode: 'passive' }),
        `${intent.correlationId}:program-context`
      );
      if (!preparation?.ok) return preparation;
      if (options.publish !== false) {
        preparation = withProjectionOutcome(preparation, await publish(preparation));
      }
      result = withInteractionId(
        await executeWorld(intent.source, interaction), intent.correlationId
      );
      result = {
        ...result,
        ...(preparation.projectionStatus ? {
          projectionStatus: preparation.projectionStatus,
          ...(preparation.projectionRecovery
            ? { projectionRecovery: preparation.projectionRecovery }
            : {}),
          ...(preparation.projectionFailure
            ? { projectionFailure: preparation.projectionFailure }
            : {}),
          warnings: [
            ...(preparation.warnings ?? []),
            ...(result.warnings ?? [])
          ]
        } : {}),
        messages: [
          ...(preparation.messages ?? []),
          ...(result.messages ?? [])
        ]
      };
    }
    if (result?.ok === true && result?.changed === true
      && typeof options.onCommitted === 'function') {
      options.onCommitted(structuredClone(result));
    }
    if (options.publish !== false && result?.changed !== false) {
      result = withProjectionOutcome(result, await publish(result));
    }
    if (diagnostics && result?.command === 'explore') {
      try {
        await diagnostics.record({
          id: `${intent.correlationId}:read`,
          type: 'read',
          durationMs: performance.now() - interactionStartedAt,
          outcome: result.ok === false ? 'failure' : 'success',
          ...(diagnosticFailure(result) ? { failure: diagnosticFailure(result) } : {}),
          affectedAtoms: readAffectedAtoms(result)
        });
      } catch (error) {
        result = {
          ...result,
          warnings: [
            ...(result.warnings ?? []),
            {
              code: 'READ_DIAGNOSTIC_RECORD_FAILED',
              message: 'Read completed, but its compact runtime diagnostic was not persisted',
              details: { cause: error.code ?? error.name }
            }
          ]
        };
      }
    }
    if (diagnostics && result?.command === 'transform' && result?.ok === false) {
      const failure = diagnosticFailure(result);
      if (failure?.code) {
        const transformDiagnostic = {
          id: `${intent.correlationId}:transform`,
          type: 'transform',
          command: 'transform',
          durationMs: performance.now() - interactionStartedAt,
          outcome: 'failure',
          errorCode: failure.code,
          ...(transformProgramFingerprint(result) ? {
            programFingerprint: transformProgramFingerprint(result)
          } : {})
        };
        if (typeof diagnostics.enqueue === 'function') {
          diagnostics.enqueue(transformDiagnostic);
          return result;
        }
        if (typeof diagnostics.findByInteractionId === 'function') {
          try {
            const stageDiagnostic = await diagnostics.findByInteractionId(intent.correlationId);
            if (stageDiagnostic?.type === 'transform-stage') {
              await diagnostics.record({
                ...stageDiagnostic,
                outcome: 'failure',
                durationMs: performance.now() - interactionStartedAt
              });
            }
          } catch {
            // Diagnostics are observational: a persistence fault must not change a failed command result.
          }
        }
        try {
          await diagnostics.record(transformDiagnostic);
        } catch {
          // Diagnostics are observational: a persistence fault must not change a failed command result.
        }
      }
    }
    return timedStage('result.serialize', () => result, intent.correlationId);
  }

  async function execute(rawIntent, options = {}) {
    return executeValidated(validateIntent(rawIntent), options);
  }

  async function initialize({ correlationId }) {
    const intent = validateIntent({ source: 'atom', correlationId, history: [] });
    const initialization = await executeValidated(intent, {
      publish: false,
      programMode: 'project'
    });
    if (!initialization?.ok || !initialization.revisionAfter) {
      throw problem('RUNTIME_INITIALIZATION_FAILED', 'World initialization did not produce a readable revision', {
        result: initialization
      });
    }
    const outcome = await publish(initialization);
    if (outcome?.status === 'published') {
      return Object.freeze({
        initialization,
        projection: outcome.projection,
        projectionStatus: 'published'
      });
    }
    return Object.freeze({
      initialization,
      projection: null,
      projectionStatus: 'pending',
      projectionRecovery: { expectedRevision: outcome.expectedRevision },
      projectionFailure: outcome.failure
    });
  }

  async function updateHumanStatus({ key, atomPath, detail, correlationId }) {
    if ((typeof key !== 'string' || !key.trim()) && (typeof atomPath !== 'string' || !atomPath.trim())
      || typeof detail !== 'string' || !detail.trim()) {
      throw problem('INVALID_HUMAN_STATUS', 'Human status requires one stable target and non-empty detail');
    }
    const source = await humanStatus.translate({
      key: typeof key === 'string' ? key.trim() : '',
      atomPath: typeof atomPath === 'string' ? atomPath.trim() : '',
      detail: detail.trim()
    });
    return executeValidated(validateIntent({ source, correlationId, history: [] }), {
      bypassProgramLocks: true,
      programMode: 'reconcile'
    });
  }

  async function updateHumanWorkspace({ operation, correlationId }) {
    requireMethod(humanWorkspace, 'translate', 'INVALID_HUMAN_WORKSPACE_PORT', 'Interaction runtime human-workspace port');
    const source = await humanWorkspace.translate({ operation });
    return executeValidated(validateIntent({ source, correlationId, history: [] }), {
      programMode: 'reconcile'
    });
  }

  async function recover({ expectedRevision }) {
    if (typeof expectedRevision !== 'string' || !expectedRevision.trim()) {
      throw problem('INVALID_WORLD_REVISION', 'Recovery requires a non-empty expected revision');
    }
    try {
      const projection = await projections.recover({ expectedRevision });
      latestProjectionState = Object.freeze({ status: 'published', expectedRevision });
      return projection;
    } catch (error) {
      latestProjectionState = Object.freeze({
        status: 'pending',
        expectedRevision,
        failure: projectionFailure(error)
      });
      throw error;
    }
  }

  function projectionStatus() {
    return structuredClone(latestProjectionState);
  }

  return Object.freeze({
    initialize,
    execute,
    updateHumanStatus,
    updateHumanWorkspace,
    recover,
    projectionStatus
  });
}
