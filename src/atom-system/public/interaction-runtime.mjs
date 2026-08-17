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

export function createInteractionRuntime({
  world,
  projections,
  feedback,
  agents,
  humanStatus,
  humanWorkspace,
  programRuntime
}) {
  requireMethod(world, 'execute', 'INVALID_WORLD_PORT', 'Interaction runtime world port');
  requireMethod(projections, 'publish', 'INVALID_PROJECTION_PORT', 'Interaction runtime projection port');
  requireMethod(projections, 'recover', 'INVALID_PROJECTION_PORT', 'Interaction runtime projection port');
  requireMethod(feedback, 'submit', 'INVALID_FEEDBACK_PORT', 'Interaction runtime feedback port');
  requireMethod(agents, 'resolve', 'INVALID_AGENT_DIRECTORY', 'Interaction runtime agent directory');
  requireMethod(humanStatus, 'translate', 'INVALID_HUMAN_STATUS_PORT', 'Interaction runtime human-status port');

  async function interactionOf(intent) {
    const agent = intent.agentPath ? await agents.resolve(intent.agentPath) : null;
    return Object.freeze({ id: intent.correlationId, agent });
  }

  async function publish(result) {
    if (!result?.ok || typeof result.revisionAfter !== 'string' || !result.revisionAfter) return null;
    try {
      return await projections.publish({
        expectedRevision: result.revisionAfter,
        lockState: result.lockState
      });
    } catch (error) {
      throw problem(
        'WORLD_COMMITTED_PROJECTION_PENDING',
        'World interaction completed, but its replaceable projection requires recovery',
        { result, cause: error.code ?? error.name }
      );
    }
  }

  async function executeValidated(intent, options = {}) {
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
    let result = await executeWorld(intent.source, interaction);
    const projectionMissing = result?.ok === false
      && result.errors?.some(({ code }) => code === 'ATOM_PROGRAM_PROJECTION_MISSING');
    if (projectionMissing && interaction.agent && !options.programMode) {
      const preparation = await executeWorld('atom', Object.freeze({
        ...interaction,
        id: `${interaction.id}:program-context`
      }), { ...options, programMode: 'reconcile' });
      if (!preparation?.ok) return preparation;
      if (options.publish !== false) await publish(preparation);
      result = await executeWorld(intent.source, interaction);
      result = {
        ...result,
        messages: [
          ...(preparation.messages ?? []),
          ...(result.messages ?? [])
        ]
      };
    }
    if (options.publish !== false && result?.changed !== false) await publish(result);
    return result;
  }

  async function execute(rawIntent) {
    return executeValidated(validateIntent(rawIntent));
  }

  async function initialize({ correlationId }) {
    const intent = validateIntent({ source: 'atom', correlationId, history: [] });
    const initialization = await executeValidated(intent, {
      publish: false,
      programMode: 'reconcile'
    });
    if (!initialization?.ok || !initialization.revisionAfter) {
      throw problem('RUNTIME_INITIALIZATION_FAILED', 'World initialization did not produce a readable revision', {
        result: initialization
      });
    }
    const projection = await publish(initialization);
    return Object.freeze({ initialization, projection });
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
    return projections.recover({ expectedRevision });
  }

  return Object.freeze({ initialize, execute, updateHumanStatus, updateHumanWorkspace, recover });
}
