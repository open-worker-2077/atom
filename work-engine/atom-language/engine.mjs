import path from 'node:path';
import { diagnostic } from './errors.mjs';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

function mergeWarnings(...groups) {
  const warnings = [];
  const seen = new Set();
  for (const warning of groups.flat()) {
    const key = JSON.stringify(warning);
    if (!seen.has(key)) warnings.push(warning);
    seen.add(key);
  }
  return warnings;
}

function visibleExplorePaths(items) {
  return new Set(items.flatMap((item) => (
    (item.matches ?? []).map((match) => Array.isArray(match.path) ? match.path.join('/') : match.path)
  )));
}

function relevantProgramWarnings(items, warnings) {
  const visiblePaths = visibleExplorePaths(items);
  return warnings.filter((warning) => visiblePaths.has(warning.program));
}

function relevantProgramMessages(items, messages) {
  const visiblePaths = visibleExplorePaths(items);
  return messages.filter((message) => visiblePaths.has(message.sourceProgramPath));
}
import { createAtomLanguageReceiver } from './receiver.mjs';
import {
  appendTransformLog,
  applyTransform,
  createExactTransformIndex,
  transformChangesStructure
} from './transform-executor.mjs';
import {
  projectAtomContext,
  readAtomContext,
  resolveAtomContextFile
} from './context-store.mjs';
import {
  buildProgramLockIndex,
  mergeProgramLockIndexes,
  authorizeProgramLock,
  programLockDeniedDiagnostic,
  programLockState
} from './program-locks.mjs';
import { applySlotBodyEffect } from './slot-body-runtime.mjs';
import {
  createAccessController,
  describeAtom,
  executeExploreItem,
  executeProgramExplore,
  fieldsByBase,
  oneStoredField,
  prepareExploreWorld,
  walkAtoms
} from './query-capability.mjs';

export { executeProgramExplore } from './query-capability.mjs';

function revisionOf(atoms) {
  return revisionOfWorldFacts(atoms).slice('sha256:'.length);
}

function graphTypesAtPath(atoms, targetPath) {
  if (!targetPath) return [];
  const match = walkAtoms(atoms).find((candidate) => candidate.path.join('/') === targetPath);
  if (!match) return [];
  return oneStoredField(match.atom, 'name')?.parsed.types.map((type) => type.raw) ?? [];
}

function performanceTrace(event, details) {
  if (process.env.ATOM_PERF_TRACE !== '1') return;
  process.stderr.write(`${JSON.stringify({ event, ...details })}\n`);
}

function projectionFileFor(contextFile, explicitProjectionFile) {
  if (explicitProjectionFile) return path.resolve(explicitProjectionFile);
  const basename = path.basename(contextFile);
  const stem = basename.toLowerCase() === 'atom.json'
    ? 'atom.graph'
    : `${basename.slice(0, -path.extname(basename).length)}.graph`;
  return path.join(path.dirname(contextFile), `${stem}.json`);
}

function sameFile(left, right) {
  const normalize = (file) => {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function normalizedValueToPersistent(value) {
  if (Array.isArray(value)) return value.map(normalizedValueToPersistent);
  if (value?.kind !== 'graph-object' || !Array.isArray(value.fields)) {
    return structuredClone(value);
  }
  const output = {};
  for (const field of value.fields) {
    if (!field.valuePresent) continue;
    output[field.persistentKey] = normalizedValueToPersistent(field.value);
  }
  return output;
}

function persistentAtomFromItem(item) {
  const atom = {};
  for (const field of item.fields) {
    if (!field.valuePresent) continue;
    atom[field.persistentKey] = normalizedValueToPersistent(field.value);
  }
  return atom;
}

function validateNewAtom(atom) {
  const byBase = fieldsByBase(atom);
  const required = ['name', 'detail', 'children', 'partners'];
  const missing = required.filter((baseKey) => (byBase.get(baseKey) ?? []).length !== 1);
  if (missing.length) {
    return diagnostic(
      'TRANSFORM_NEW_REQUIRES_FOUR_AXES',
      'transform new 首轮要求完整提交 name、detail、children、partners 四个纵轴',
      { missing }
    );
  }
  const name = byBase.get('name')[0].value;
  const detail = byBase.get('detail')[0].value;
  const children = byBase.get('children')[0].value;
  const partners = byBase.get('partners')[0].value;
  if (typeof name !== 'string' || !name.trim()) {
    return diagnostic('INVALID_ATOM_NAME', 'Atom name 必须是非空字符串');
  }
  if (typeof detail !== 'string') {
    return diagnostic('INVALID_ATOM_DETAIL', 'Atom detail 必须是字符串');
  }
  if (!Array.isArray(children) || !Array.isArray(partners)) {
    return diagnostic(
      'INVALID_ATOM_GRAPH_AXES',
      'Atom children 与 partners 必须是数组'
    );
  }
  return null;
}

function nameFieldIn(item) {
  return item.fields.find((field) => field.baseKey === 'name');
}

function exactMatches(atoms, item, matcherRegistry, candidates = null) {
  const nameField = nameFieldIn(item);
  if (!nameField?.valuePresent || typeof nameField.value !== 'string' || !nameField.value) {
    return {
      error: diagnostic(
        'ATOM_NAME_REQUIRED',
        '首轮 explore/transform 执行需要带 Value 的 name 精确锚点'
      )
    };
  }
  const mode = nameField.matcher?.mode ?? 'exact';
  const matcher = matcherRegistry.resolve(mode);
  if (!matcher) {
    return {
      error: diagnostic(
        'UNSUPPORTED_MATCHER',
        `不支持此匹配模式：${mode}`,
        { mode }
      )
    };
  }
  const isFullBusinessPath = mode === 'exact' && nameField.value.includes('/');
  const matches = (candidates ?? walkAtoms(atoms)).filter(({ atom, path: atomPath }) => {
    if (isFullBusinessPath) {
      return atomPath.join('/') === nameField.value;
    }
    const candidate = oneStoredField(atom, 'name')?.value;
    return matcher.match(candidate, nameField.value);
  });
  return { matches, expected: nameField.value };
}

function failureBase(parsed, contextFile, projectionFile, atoms, errors, extra = {}) {
  const revision = revisionOf(atoms);
  return {
    ok: false,
    language: 'atom',
    command: parsed.command,
    changed: false,
    contextFile,
    projectionFile,
    revisionBefore: revision,
    revisionAfter: revision,
    warnings: parsed.warnings ?? [],
    errors,
    ...extra
  };
}

function programRunRequest(item) {
  const commands = item.fields.flatMap((field) => (
    (field.commands ?? []).map((command) => ({ field, command }))
  ));
  const runs = commands.filter(({ command }) => command.name === 'run');
  if (!runs.length) return null;
  const [{ field, command }] = runs;
  if (
    runs.length !== 1
    || commands.length !== 1
    || item.fields.length !== 1
    || field.baseKey !== 'name'
    || command.parameter !== ''
    || !field.valuePresent
    || typeof field.value !== 'string'
    || !field.value
  ) {
    return {
      error: diagnostic(
        'INVALID_PROGRAM_RUN',
        'Program 只接受独立的 transform {"name.run.":"Program 名称或路径"}'
      )
    };
  }
  return { selector: field.value };
}

async function validatePrograms(atoms, contextFile, previousAtoms = null, programScheduler = null) {
  void contextFile;
  if (typeof programScheduler?.validateProgramSources !== 'function') {
    return { ok: true, errors: [], warnings: [] };
  }
  try {
    await programScheduler.validateProgramSources(atoms, previousAtoms ?? []);
    return { ok: true, errors: [], warnings: [] };
  } catch (error) {
    return {
      ok: false,
      errors: [diagnostic(
        'INVALID_PROGRAM_SOURCE',
        error.message ?? 'Introduced Program source failed validation',
        error.details ?? {}
      )],
      warnings: []
    };
  }
}

function appendNestedAtom(atoms, parentMatch, atom) {
  const nextAtoms = structuredClone(atoms);
  const lineage = [];
  for (let current = parentMatch; current; current = current.parent) lineage.unshift(current.index);
  let parent = nextAtoms[lineage.shift()];
  for (const index of lineage) parent = oneStoredField(parent, 'children').value[index];
  oneStoredField(parent, 'children').value.push(atom);
  return nextAtoms;
}

function isCompletePersistentAtomItem(item) {
  const required = new Set(['name', 'detail', 'children', 'partners']);
  return item.fields.length === required.size
    && item.fields.every((field) => (
      required.has(field.baseKey) && (field.commands ?? []).length === 0
    ))
    && new Set(item.fields.map((field) => field.baseKey)).size === required.size;
}

async function applyCreateTransform({
  atoms,
  item,
  contextFile,
  authorize,
  matcherRegistry,
  programScheduler = null
}) {
  const commandFields = item.fields.filter((field) => field.commands?.length);
  if (commandFields.length) {
    return { error: diagnostic(
      'TRANSFORM_NEW_COMMANDS_REJECTED',
      'transform new 不接受点号改造指令；请提交完整持久 Atom',
      { fields: commandFields.map((field) => field.rawKey) }
    ) };
  }
  const atom = persistentAtomFromItem(item);
  const invalid = validateNewAtom(atom);
  if (invalid) return { error: invalid };

  const createNameField = oneStoredField(atom, 'name');
  const createName = createNameField?.value;
  const createPath = createName.split('/');
  const createDecision = await authorize({ atom, name: createName, path: createPath }, 'write');
  if (createDecision.decision !== 'allow') {
    const programDenied = createDecision.matched
      ? programLockDeniedDiagnostic(createDecision)
      : null;
    return { error: diagnostic(
      programDenied?.code ?? 'WINDOW_ACCESS_DENIED',
      programDenied?.message ?? '当前窗口无权执行该改造；请反馈派发方',
      programDenied?.details ?? {}
    ) };
  }

  const selected = exactMatches(atoms, item, matcherRegistry);
  if (selected.error) return { error: selected.error };
  if (selected.matches.length) {
    return { error: diagnostic(
      'DUPLICATE_ATOM_NAME',
      `已存在 exact name 为“${selected.expected}”的 Atom，transform new 不会覆盖`,
      { name: selected.expected, paths: selected.matches.map((match) => match.path.join('/')) }
    ) };
  }

  let nextAtoms;
  if (createPath.length === 1) {
    nextAtoms = [...structuredClone(atoms), atom];
  } else {
    const childName = createPath.at(-1);
    const parentPath = createPath.slice(0, -1).join('/');
    const parentMatches = walkAtoms(atoms).filter((match) => match.path.join('/') === parentPath);
    if (parentMatches.length !== 1) {
      return { error: diagnostic(
        parentMatches.length ? 'AMBIGUOUS_ATOM_NAME' : 'ATOM_NOT_FOUND',
        `transform new parent must resolve to one exact Atom: ${parentPath}`,
        { parentPath, matches: parentMatches.map((match) => match.path.join('/')) }
      ) };
    }
    const parentDecision = await authorize(parentMatches[0], 'write', 'children');
    if (parentDecision.decision !== 'allow') {
      const programDenied = parentDecision.matched
        ? programLockDeniedDiagnostic(parentDecision, 'children')
        : null;
      return { error: diagnostic(
        programDenied?.code ?? 'WINDOW_ACCESS_DENIED',
        programDenied?.message ?? '当前窗口无权修改父 Atom 的 children；请反馈派发方',
        programDenied?.details ?? { parentPath }
      ) };
    }
    atom[createNameField.rawKey] = childName;
    nextAtoms = appendNestedAtom(atoms, parentMatches[0], atom);
  }

  const compiled = await validatePrograms(nextAtoms, contextFile, atoms, programScheduler);
  if (!compiled.ok) return { error: compiled.errors[0], warnings: compiled.warnings };
  return {
    atoms: nextAtoms,
    changed: true,
    resultName: createPath.at(-1),
    resultPath: createName,
    warnings: compiled.warnings
  };
}

function programObjectSource(command, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw Object.assign(new Error(`${command}() requires one root JSON object`), { code: 'INVALID_PROGRAM_WORLD_FUNCTION' });
  }
  const fields = Object.entries(request).map(([key, value]) => (
    value === null ? JSON.stringify(key) : `${JSON.stringify(key)}:${JSON.stringify(value)}`
  ));
  return `${command} {${fields.join(',')}}`;
}

export function compileProgramTransform({ request, receiver = createAtomLanguageReceiver() }) {
  const opaqueDetail = request && Object.hasOwn(request, 'detail$replace')
    ? request['detail$replace']
    : undefined;
  if (opaqueDetail !== undefined && typeof opaqueDetail !== 'string') {
    return {
      ok: false,
      errors: [diagnostic(
        'INVALID_PROGRAM_DETAIL_REPLACEMENT',
        'Program detail$replace requires one complete string value'
      )]
    };
  }
  const normalized = opaqueDetail === undefined
    ? request
    : Object.fromEntries([
        ...Object.entries(request).filter(([key]) => key !== 'detail$replace'),
        ['detail.rep.__ATOM_PROGRAM_OPAQUE_REPLACEMENT__', null]
      ]);
  const parsed = receiver.receive(programObjectSource('transform', normalized));
  if (!parsed.ok || parsed.batch || parsed.items.length !== 1) {
    return { ok: false, errors: parsed.errors };
  }
  if (opaqueDetail !== undefined) {
    const fields = parsed.items[0].fields.filter((field) => field.baseKey === 'detail');
    if (fields.length !== 1) {
      return {
        ok: false,
        errors: [diagnostic(
          'CONFLICTING_PROGRAM_DETAIL_REPLACEMENT',
          'Program detail$replace cannot be combined with another detail operation'
        )]
      };
    }
    fields[0].commands = [{ name: 'rep', parameter: opaqueDetail }];
  }
  return {
    ok: true,
    item: parsed.items[0],
    parsed,
    createNew: isCompletePersistentAtomItem(parsed.items[0])
  };
}

async function persistChangedGraph({
  atoms,
  contextFile,
  projectionFile,
  rootName,
  commitWorld,
  expectedRevision,
  correlationId,
  source
}) {
  // Validate the full projection before either active file is changed.
  const validationStartedAt = performance.now();
  projectAtomContext(atoms, { rootName });
  performanceTrace('world-precommit-validation', {
    elapsedMs: Math.round(performance.now() - validationStartedAt)
  });
  if (typeof commitWorld !== 'function') {
    const error = new Error('World mutation requires an explicit commit capability');
    error.code = 'WORLD_COMMIT_CAPABILITY_REQUIRED';
    throw error;
  }
  const commitStartedAt = performance.now();
  await commitWorld({
    expectedRevision,
    nextRevision: revisionOf(atoms),
    facts: structuredClone(atoms),
    correlationId,
    source
  });
  performanceTrace('world-commit', {
    elapsedMs: Math.round(performance.now() - commitStartedAt)
  });
}

export async function executeAtomLanguage(options = {}) {
  const operationStartedAt = performance.now();
  const source = options.source;
  const receiver = options.receiver ?? createAtomLanguageReceiver(options.receiverOptions);
  const parsed = receiver.receive(source);
  const contextFile = resolveAtomContextFile(options.contextFile ?? path.resolve('atom.json'));
  const projectionFile = projectionFileFor(contextFile, options.projectionFile);

  if (sameFile(contextFile, projectionFile)) {
    return {
      ok: false,
      language: 'atom',
      command: parsed.command,
      changed: false,
      contextFile,
      projectionFile,
      warnings: parsed.warnings ?? [],
      errors: [diagnostic(
        'ATOM_GRAPH_PATH_COLLISION',
        'Atom context 与 Graph 页面投影必须是两个不同文件'
      )]
    };
  }

  if (!parsed.ok && !parsed.batch) {
    return {
      ok: false,
      language: 'atom',
      command: parsed.command,
      changed: false,
      contextFile,
      projectionFile,
      warnings: parsed.warnings ?? [],
      errors: parsed.errors
    };
  }

  let atoms;
  try {
    atoms = await readAtomContext(contextFile, { create: parsed.command === 'atom' });
    performanceTrace('world-read-context', {
      elapsedMs: Math.round(performance.now() - operationStartedAt)
    });
  } catch (error) {
    const ambiguous = error.code === 'DUPLICATE_GRAPH_NAME';
    return {
      ok: false,
      language: 'atom',
      command: parsed.command,
      changed: false,
      contextFile,
      projectionFile,
      warnings: parsed.warnings ?? [],
      errors: [diagnostic(
        ambiguous ? 'AMBIGUOUS_ATOM_NAME' : (error.code || 'INVALID_ATOM_CONTEXT'),
        ambiguous
          ? '上下文存在同层重名 Atom；首轮 exact 执行不会猜测目标'
          : error.message,
        { cause: error.code, details: error.details ?? {} }
      )]
    };
  }
  const revisionBefore = revisionOf(atoms);
  if (parsed.command === 'transform' && parsed.batch && !parsed.ok) {
    return failureBase(parsed, contextFile, projectionFile, atoms, parsed.errors);
  }
  if (parsed.command === 'transform' && parsed.batch && parsed.items.length === 0) {
    return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
      'EMPTY_TRANSFORM_BATCH',
      '批量 transform 至少需要一个 Atom 改造'
    )]);
  }
  if (parsed.command === 'transform' && parsed.batch) {
    const unsupported = parsed.items.flatMap((item) => item.fields
      .filter((field) => (
        !['name', 'detail', 'partners'].includes(field.baseKey)
        || (field.baseKey === 'name' && field.commands.some((command) => command.name !== 'mov'))
      ))
      .map((field) => ({ item, field })))[0];
    if (unsupported) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [{
        ...diagnostic(
          'UNSUPPORTED_TRANSFORM_BATCH_AXIS',
          '批量 transform 当前支持已有 Atom 的移动、detail 与 partners 改造',
          { axis: unsupported.field.baseKey }
        ),
        itemIndex: unsupported.item.index
      }]);
    }
  }
  const interaction = {
    id: options.interaction?.id ?? crypto.randomUUID(),
    agent: options.interaction?.agent ?? null
  };
  const requestedProgramRun = parsed.command === 'transform'
    && !parsed.batch
    && parsed.items.length === 1
    ? programRunRequest(parsed.items[0])
    : null;
  let programCycle = { messages: [], locks: [], records: [] };
  if (options.programScheduler) {
    try {
      const unrestricted = createAccessController(atoms, {});
      const preparedWorld = prepareExploreWorld(atoms);
      const reconcilePrograms = options.programMode === 'reconcile'
        || Boolean(requestedProgramRun?.selector);
      const projectPrograms = options.programMode === 'project';
      const programOperation = reconcilePrograms || projectPrograms
        ? options.programScheduler.refresh.bind(options.programScheduler)
        : (typeof options.programScheduler.current === 'function'
          ? options.programScheduler.current.bind(options.programScheduler)
          : options.programScheduler.refresh.bind(options.programScheduler));
      const programStartedAt = performance.now();
      programCycle = await programOperation(atoms, {
        agentOrigin: interaction.agent,
        isolateFailures: true,
        ...(requestedProgramRun?.selector
          ? { programSelector: requestedProgramRun.selector, force: true }
          : {}),
        executeExplore: (request) => executeProgramExplore({
          atoms,
          request,
          receiver,
          accessController: unrestricted,
          agentOrigin: interaction.agent,
          preparedWorld
        })
      });
      if (projectPrograms) {
        programCycle = {
          ...programCycle,
          messages: [],
          transforms: [],
          slotBodies: []
        };
      }
      performanceTrace('program-initial-cycle', {
        elapsedMs: Math.round(performance.now() - programStartedAt),
        transforms: programCycle.transforms?.length ?? 0,
        cached: programCycle.cached === true
      });
    } catch (error) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
      )]);
    }
  }
  const programWarnings = (programCycle.failures ?? []).map((failure) => diagnostic(
    failure.code ?? 'ATOM_PROGRAM_FAILED',
    failure.message ?? 'Python Program failed',
    { ...(failure.details ?? {}), program: failure.programPath }
  ));
  const programRuntimeWarnings = (programCycle.runtimeWarnings ?? []).map((warning) => diagnostic(
    warning.code ?? 'PROGRAM_RUNTIME_WARNING',
    warning.message ?? 'Program runtime reported a recoverable warning',
    warning.details ?? {}
  ));
  const interactionWarnings = [
    ...(parsed.warnings ?? []),
    ...(parsed.command === 'explore' && !requestedProgramRun ? [] : programWarnings),
    ...programRuntimeWarnings
  ];
  let programLockIndex = buildProgramLockIndex({
    revision: revisionBefore,
    results: options.bypassProgramLocks ? [] : programCycle.locks,
    records: programCycle.records
  });
  let accessController = createAccessController(atoms, {
    ...options, programLockIndex, agentPath: interaction.agent?.path ?? null
  });
  const interactionMessages = (programCycle.messages ?? [])
    .filter((message) => authorizeProgramLock({
      lockIndex: programLockIndex,
      targetPath: message.sourceProgramPath,
      operation: 'read',
      field: 'messages',
      agentPath: interaction.agent?.path ?? null,
      agentTypes: graphTypesAtPath(atoms, interaction.agent?.path),
      targetTypes: graphTypesAtPath(atoms, message.sourceProgramPath),
      action: 'explore'
    }).decision === 'allow')
    .map((message) => ({ interactionId: interaction.id, ...message }));
  let programChanged = false;
  const programTransformLogs = [];
  for (const request of programCycle.transforms ?? []) {
    const { sourceProgramRef: _sourceProgramRef, sourceProgramPath, ...transformRequest } = request;
    const compiled = compileProgramTransform({ request: transformRequest, receiver });
    if (!compiled.ok) {
      interactionWarnings.push(diagnostic(
        'INVALID_PROGRAM_TRANSFORM',
        compiled.errors?.[0]?.message ?? 'Program transform 无法编译',
        { program: sourceProgramPath, errors: compiled.errors ?? [] }
      ));
      continue;
    }
    let transformed;
    try {
      transformed = compiled.createNew
        ? await applyCreateTransform({
            atoms,
            item: compiled.item,
            contextFile,
            authorize: accessController.authorize,
            matcherRegistry: receiver.matcherRegistry,
            programScheduler: options.programScheduler
          })
        : await applyTransform({
            atoms,
            item: compiled.item,
            contextFile,
            authorize: accessController.authorize
          });
    } catch (error) {
      interactionWarnings.push(diagnostic(
        error.code ?? 'PROGRAM_TRANSFORM_FAILED', error.message,
        { program: sourceProgramPath }
      ));
      continue;
    }
    if (transformed.error) {
      interactionWarnings.push(diagnostic(
        'PROGRAM_TRANSFORM_REJECTED', transformed.error.message,
        { program: sourceProgramPath, cause: transformed.error.code }
      ));
      continue;
    }
    interactionWarnings.push(...(transformed.warnings ?? []));
    try {
      projectAtomContext(transformed.atoms, { rootName: path.basename(contextFile) });
    } catch (error) {
      interactionWarnings.push(diagnostic(
        error.code ?? 'PROGRAM_TRANSFORM_INVALID_GRAPH', error.message,
        { program: sourceProgramPath }
      ));
      continue;
    }
    const before = revisionOf(atoms);
    atoms = transformed.atoms;
    const after = revisionOf(atoms);
    if (before !== after) {
      programChanged = true;
      programTransformLogs.push({
        id: crypto.randomUUID(),
        operation: 'program-transform',
        source: transformRequest,
        revisionBefore: before,
        revisionAfter: after
      });
    }
  }

  for (const request of programCycle.slotBodies ?? []) {
    const { sourceProgramPath, ...effect } = request;
    const result = await applySlotBodyEffect({
      atoms,
      effect,
      authorize: async ({ path: targetPath }) => {
        const match = walkAtoms(atoms).find((candidate) => candidate.path.join('/') === targetPath);
        if (!match) return { decision: 'deny' };
        return accessController.authorize(match, 'write', 'children');
      }
    });
    if (result.error) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        result.error.code ?? 'PROGRAM_SLOT_BODY_REJECTED',
        result.error.message,
        { program: sourceProgramPath, ...(result.error.details ?? {}) }
      )]);
    }
    try {
      projectAtomContext(result.atoms, { rootName: path.basename(contextFile) });
    } catch (error) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        error.code ?? 'PROGRAM_SLOT_BODY_INVALID_GRAPH',
        error.message,
        { program: sourceProgramPath }
      )]);
    }
    const before = revisionOf(atoms);
    atoms = result.atoms;
    const after = revisionOf(atoms);
    if (before !== after) {
      programChanged = true;
      programTransformLogs.push({
        id: crypto.randomUUID(),
        operation: `slot-body-${effect.action}`,
        source: effect,
        receipt: result.receipt,
        revisionBefore: before,
        revisionAfter: after
      });
    }
  }

  async function reconcileProgramsForWorld(candidateAtoms, initialTriggerEvent = null) {
    if (!options.programScheduler) {
      return {
        atoms: candidateAtoms,
        lockIndex: programLockIndex,
        messages: [],
        transformLogs: [],
        pathChanges: []
      };
    }
    let reconciledAtoms = candidateAtoms;
    const messages = [];
    const transformLogs = [];
    const pathChanges = [];
    let finalLockIndex = programLockIndex;
    let pendingTriggerEvent = initialTriggerEvent;
    const maxPasses = 8;

    for (let pass = 1; pass <= maxPasses; pass += 1) {
      const unrestricted = createAccessController(reconciledAtoms, {});
      const preparedWorld = prepareExploreWorld(reconciledAtoms);
      const refreshStartedAt = performance.now();
      const cycle = await options.programScheduler.refresh(reconciledAtoms, {
        agentOrigin: interaction.agent,
        isolateFailures: true,
        ...(pendingTriggerEvent ? { triggerEvent: pendingTriggerEvent } : {}),
        executeExplore: (request) => executeProgramExplore({
          atoms: reconciledAtoms,
          request,
          receiver,
          accessController: unrestricted,
          agentOrigin: interaction.agent,
          preparedWorld
        })
      });
      performanceTrace('program-reconcile-refresh', {
        pass,
        elapsedMs: Math.round(performance.now() - refreshStartedAt),
        transforms: cycle.transforms?.length ?? 0,
        failures: cycle.failures?.length ?? 0,
        cached: cycle.cached === true
      });
      const cycleWarnings = (cycle.failures ?? []).map((failure) => diagnostic(
        failure.code ?? 'ATOM_PROGRAM_FAILED',
        failure.message ?? 'Python Program failed',
        { ...(failure.details ?? {}), program: failure.programPath }
      ));
      programWarnings.push(...cycleWarnings);
      if (parsed.command !== 'explore') interactionWarnings.push(...cycleWarnings);
      interactionWarnings.push(...(cycle.runtimeWarnings ?? []).map((warning) => diagnostic(
        warning.code ?? 'PROGRAM_RUNTIME_WARNING',
        warning.message ?? 'Program runtime reported a recoverable warning',
        warning.details ?? {}
      )));
      const refreshedLockIndex = buildProgramLockIndex({
        revision: revisionOf(reconciledAtoms),
        results: options.bypassProgramLocks ? [] : cycle.locks,
        records: cycle.records
      });
      finalLockIndex = pendingTriggerEvent
        ? mergeProgramLockIndexes({
          revision: revisionOf(reconciledAtoms),
          previous: finalLockIndex,
          next: refreshedLockIndex,
          replacedSources: new Set(cycle.executedProgramPaths ?? [])
        })
        : refreshedLockIndex;
      const cycleAccessController = createAccessController(reconciledAtoms, {
        ...options,
        programLockIndex: finalLockIndex,
        agentPath: interaction.agent?.path ?? null
      });
      messages.push(...(cycle.messages ?? [])
        .filter((message) => authorizeProgramLock({
          lockIndex: finalLockIndex,
          targetPath: message.sourceProgramPath,
          operation: 'read',
          field: 'messages',
          agentPath: interaction.agent?.path ?? null,
          agentTypes: graphTypesAtPath(reconciledAtoms, interaction.agent?.path),
          targetTypes: graphTypesAtPath(reconciledAtoms, message.sourceProgramPath),
          action: 'explore'
        }).decision === 'allow')
        .map((message) => ({ interactionId: interaction.id, ...message })));

      let passChanged = false;
      const compiledRequests = [];
      for (const request of cycle.transforms ?? []) {
        const { sourceProgramRef: _sourceProgramRef, sourceProgramPath, ...transformRequest } = request;
        const compiled = compileProgramTransform({ request: transformRequest, receiver });
        if (!compiled.ok) {
          interactionWarnings.push(diagnostic(
            'INVALID_PROGRAM_TRANSFORM',
            compiled.errors?.[0]?.message ?? 'Program transform 无法编译',
            { program: sourceProgramPath, errors: compiled.errors ?? [] }
          ));
          continue;
        }
        compiledRequests.push({
          sourceProgramPath,
          transformRequest,
          item: compiled.item,
          createNew: compiled.createNew
        });
      }

      performanceTrace('program-reconcile-plan', {
        pass,
        compiled: compiledRequests.length,
        structural: compiledRequests.filter(({ item, createNew }) => (
          createNew || transformChangesStructure(item)
        )).length
      });
      if (compiledRequests.length === 0 && (cycle.slotBodies?.length ?? 0) === 0) {
        return {
          atoms: reconciledAtoms,
          lockIndex: finalLockIndex,
          messages,
          transformLogs,
          pathChanges
        };
      }
      const applyCompiled = async (baseAtoms, mutateInput, reportFailure) => {
        let candidateAtoms = baseAtoms;
        let exactIndex = mutateInput
          ? createExactTransformIndex(candidateAtoms)
          : null;
        const applied = [];
        let rejected = 0;
        let structuralChanged = 0;
        for (const entry of compiledRequests) {
          let transformed;
          try {
            transformed = entry.createNew
              ? await applyCreateTransform({
                  atoms: candidateAtoms,
                  item: entry.item,
                  contextFile,
                  authorize: cycleAccessController.authorize,
                  matcherRegistry: receiver.matcherRegistry,
                  programScheduler: options.programScheduler
                })
              : await applyTransform({
                  atoms: candidateAtoms,
                  item: entry.item,
                  contextFile,
                  authorize: cycleAccessController.authorize,
                  mutateInput,
                  exactIndex
                });
          } catch (error) {
            if (reportFailure) {
              rejected += 1;
              interactionWarnings.push(diagnostic(
                error.code ?? 'PROGRAM_TRANSFORM_FAILED',
                error.message,
                { program: entry.sourceProgramPath }
              ));
              continue;
            }
            return { failed: true };
          }
          if (transformed.error) {
            if (mutateInput && transformed.rolledBack) {
              exactIndex = createExactTransformIndex(candidateAtoms);
            }
            if (reportFailure) {
              rejected += 1;
              interactionWarnings.push(diagnostic(
                'PROGRAM_TRANSFORM_REJECTED', transformed.error.message,
                { program: entry.sourceProgramPath, cause: transformed.error.code }
              ));
              continue;
            }
            return { failed: true };
          }
          interactionWarnings.push(...(transformed.warnings ?? []));
          candidateAtoms = transformed.atoms;
          applied.push({ ...entry, transformed });
          if (mutateInput && transformed.changed
            && (entry.createNew || transformChangesStructure(entry.item))) {
            structuralChanged += 1;
            exactIndex = createExactTransformIndex(candidateAtoms);
          }
        }
        performanceTrace('program-effect-set', {
          mutateInput,
          applied: applied.length,
          rejected,
          structuralChanged
        });
        return { failed: false, atoms: candidateAtoms, applied };
      };

      const before = revisionOf(reconciledAtoms);
      const applyStartedAt = performance.now();
      let application = await applyCompiled(structuredClone(reconciledAtoms), true, true);
      if (!application.failed) {
        try {
          projectAtomContext(application.atoms, { rootName: path.basename(contextFile) });
        } catch {
          application = { failed: true };
        }
      }
      if (application.failed) {
        application = await applyCompiled(reconciledAtoms, false, true);
      }
      const appliedSlotBodies = [];
      for (const request of cycle.slotBodies ?? []) {
        const { sourceProgramPath, ...effect } = request;
        const slotResult = await applySlotBodyEffect({
          atoms: application.atoms,
          effect,
          authorize: async ({ path: targetPath }) => {
            const match = walkAtoms(application.atoms)
              .find((candidate) => candidate.path.join('/') === targetPath);
            if (!match) return { decision: 'deny' };
            return cycleAccessController.authorize(match, 'write', 'children');
          }
        });
        if (slotResult.error) {
          throw Object.assign(new Error(slotResult.error.message), {
            code: slotResult.error.code ?? 'PROGRAM_SLOT_BODY_REJECTED',
            details: { program: sourceProgramPath, ...(slotResult.error.details ?? {}) }
          });
        }
        application.atoms = slotResult.atoms;
        appliedSlotBodies.push({ sourceProgramPath, effect, receipt: slotResult.receipt });
      }
      const after = revisionOf(application.atoms);
      performanceTrace('program-reconcile-apply', {
        pass,
        elapsedMs: Math.round(performance.now() - applyStartedAt),
        applied: application.applied?.length ?? 0,
        changed: before !== after
      });
      if (before !== after) {
        reconciledAtoms = application.atoms;
        passChanged = true;
        for (const { transformRequest, transformed } of application.applied) {
          if (transformed.sourcePath && transformed.resultPath) {
            pathChanges.push({
              sourcePath: transformed.sourcePath,
              resultPath: transformed.resultPath
            });
          }
          if (transformed.changed !== true) continue;
          transformLogs.push({
            id: crypto.randomUUID(),
            operation: 'program-transform',
            source: transformRequest,
            revisionBefore: before,
            revisionAfter: after
          });
        }
        for (const entry of appliedSlotBodies) {
          transformLogs.push({
            id: crypto.randomUUID(),
            operation: `slot-body-${entry.effect.action}`,
            source: entry.effect,
            receipt: entry.receipt,
            revisionBefore: before,
            revisionAfter: after
          });
        }
        const triggeredNodes = [...new Set(application.applied.flatMap(({ transformed }) => ([
          transformed.sourcePath,
          transformed.resultPath,
          transformed.resultName
        ])).concat(appliedSlotBodies.flatMap(({ receipt }) => ([
          receipt?.body,
          receipt?.target
        ]))).filter(Boolean))];
        pendingTriggerEvent = triggeredNodes.length
          ? { mode: 'transform', nodes: triggeredNodes }
          : null;
      }
      if (!passChanged) {
        return {
          atoms: reconciledAtoms,
          lockIndex: finalLockIndex,
          messages,
          transformLogs,
          pathChanges
        };
      }
    }
    const error = new Error(`Program consequences did not converge after ${maxPasses} passes`);
    error.code = 'ATOM_PROGRAM_RECONCILIATION_LIMIT';
    error.details = { passes: maxPasses };
    throw error;
  }

  function rewritePath(initialPath, pathChanges) {
    return pathChanges.reduce((currentPath, change) => {
      if (currentPath === change.sourcePath
        || currentPath?.startsWith(`${change.sourcePath}/`)) {
        return `${change.resultPath}${currentPath.slice(change.sourcePath.length)}`;
      }
      return currentPath;
    }, initialPath);
  }

  if (programChanged && (parsed.command === 'atom' || parsed.command === 'explore')) {
    let reconciled;
    try {
      reconciled = await reconcileProgramsForWorld(atoms);
    } catch (error) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
      )]);
    }
    atoms = reconciled.atoms;
    programLockIndex = reconciled.lockIndex;
    accessController = createAccessController(atoms, {
      ...options, programLockIndex, agentPath: interaction.agent?.path ?? null
    });
    interactionMessages.push(...reconciled.messages);
    programTransformLogs.push(...reconciled.transformLogs);
  }

  if (parsed.command === 'atom') {
    if (programChanged) {
      await persistChangedGraph({
        atoms, contextFile, projectionFile, rootName: path.basename(contextFile),
        commitWorld: options.commitWorld, expectedRevision: revisionBefore,
        correlationId: interaction.id, source
      });
      for (const record of programTransformLogs) await appendTransformLog(contextFile, record);
    }
    const matches = walkAtoms(atoms);
    const visible = [];
    for (const match of matches) {
      if ((await accessController.authorize(match, 'read', 'name')).decision === 'allow') visible.push(match);
    }
    return {
      ok: true, language: 'atom', command: 'atom', changed: programChanged,
      contextFile, projectionFile, atomCount: visible.length,
      revisionBefore, revisionAfter: revisionOf(atoms), warnings: interactionWarnings, errors: [],
      messages: interactionMessages, interactionId: interaction.id,
      lockState: programLockState(programLockIndex)
    };
  }

  if (parsed.command === 'explore') {
    if (programChanged) {
      await persistChangedGraph({
        atoms, contextFile, projectionFile, rootName: path.basename(contextFile),
        commitWorld: options.commitWorld, expectedRevision: revisionBefore,
        correlationId: interaction.id, source
      });
      for (const record of programTransformLogs) await appendTransformLog(contextFile, record);
    }
    if (!parsed.items.length) {
      return {
        ok: true,
        language: 'atom',
        command: 'explore',
        changed: programChanged,
        newExploration: parsed.newExploration,
        explorationReset: parsed.newExploration,
        contextFile,
        projectionFile,
        revisionBefore,
        revisionAfter: revisionOf(atoms),
        items: [],
        warnings: interactionWarnings,
        errors: [],
        messages: []
      };
    }
    const items = await Promise.all(parsed.items.map((item) => (
      executeExploreItem(atoms, item, receiver.matcherRegistry, accessController, programLockIndex)
    )));
    const errors = items.flatMap((item) => (
      (item.errors ?? []).map((error) => ({ ...error, itemIndex: item.index }))
    ));
    return {
      ok: errors.length === 0,
      language: 'atom',
      command: 'explore',
      changed: programChanged,
      newExploration: parsed.newExploration,
      explorationReset: parsed.newExploration,
      contextFile,
      projectionFile,
      revisionBefore,
      revisionAfter: revisionOf(atoms),
      items,
      warnings: [
        ...interactionWarnings,
        ...relevantProgramWarnings(items, programWarnings),
        ...items.flatMap((item) => item.warnings ?? [])
      ],
      errors,
      messages: relevantProgramMessages(items, interactionMessages),
      lockState: programLockState(programLockIndex)
    };
  }

  if (parsed.command !== 'transform') {
    return failureBase(
      parsed,
      contextFile,
      projectionFile,
      atoms,
      [diagnostic('UNKNOWN_ATOM_LANGUAGE_COMMAND', '无法分派 Atom Language 命令')]
    );
  }
  if (!parsed.batch && parsed.items.length !== 1) {
    return failureBase(
      parsed,
      contextFile,
      projectionFile,
      atoms,
      [diagnostic(
        'TRANSFORM_ITEM_REQUIRED',
        'transform 需要一个 Atom 改造对象或对象数组'
      )]
    );
  }
  if (parsed.batch) {
    if (parsed.createNew) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        'UNSUPPORTED_TRANSFORM_NEW_BATCH',
        '批量 transform 只改造已有 Atom；transform new 仍逐个创建'
      )]);
    }
    const runIndex = parsed.items.findIndex((candidate) => programRunRequest(candidate));
    if (runIndex !== -1) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        'PROGRAM_RUN_BATCH_REJECTED',
        'Program 运行不能与批量 Atom 改造混合',
        { itemIndex: runIndex }
      )]);
    }

    let nextAtoms = structuredClone(atoms);
    let exactIndex = createExactTransformIndex(nextAtoms);
    const results = [];
    const transformLogs = [];
    const transformEventNodes = new Set();
    for (const candidate of parsed.items) {
      let transformed;
      try {
        transformed = await applyTransform({
          atoms: nextAtoms,
          item: candidate,
          contextFile,
          authorize: accessController.authorize,
          mutateInput: true,
          exactIndex
        });
      } catch (error) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          error.code ?? 'TRANSFORM_BATCH_ITEM_FAILED',
          error.message,
          { ...(error.details ?? {}), itemIndex: candidate.index }
        )], { messages: interactionMessages });
      }
      if (transformed.error) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [{
          ...transformed.error,
          itemIndex: candidate.index
        }], { messages: interactionMessages });
      }

      nextAtoms = transformed.atoms;
      if (transformed.changed && transformChangesStructure(candidate)) {
        exactIndex = createExactTransformIndex(nextAtoms);
      }
      const resultMatch = walkAtoms(nextAtoms).find((match) => (
        transformed.resultPath
          ? match.path.join('/') === transformed.resultPath
          : oneStoredField(match.atom, 'name')?.value === transformed.resultName
      ));
      results.push({
        index: candidate.index,
        changed: transformed.changed === true,
        result: resultMatch ? describeAtom(resultMatch, false) : null
      });
      for (const path of [transformed.sourcePath, transformed.resultPath]) {
        if (path) transformEventNodes.add(path);
      }
      if (transformed.logRecord) {
        transformLogs.push({
          ...transformed.logRecord,
          revisionBefore,
          revisionAfter: null
        });
      }
    }

    let revisionAfter = revisionOf(nextAtoms);
    let changed = revisionAfter !== revisionBefore;
    let finalProgramLockIndex = programLockIndex;
    const finalProgramMessages = [];
    if (options.programScheduler) {
      let reconciled;
      try {
        reconciled = await reconcileProgramsForWorld(nextAtoms, {
          mode: 'transform',
          nodes: [...transformEventNodes]
        });
      } catch (error) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
        )]);
      }
      nextAtoms = reconciled.atoms;
      finalProgramLockIndex = reconciled.lockIndex;
      finalProgramMessages.push(...reconciled.messages);
      programTransformLogs.push(...reconciled.transformLogs);
      for (const receipt of results) {
        const rewritten = rewritePath(receipt.result?.path, reconciled.pathChanges);
        if (rewritten && receipt.result) {
          receipt.result.path = rewritten;
          receipt.result.selector = rewritten;
        }
      }
      revisionAfter = revisionOf(nextAtoms);
      changed = revisionAfter !== revisionBefore;
    }
    const finalMatchesByPath = new Map(walkAtoms(nextAtoms).map((match) => [
      match.path.join('/'), match
    ]));
    for (const receipt of results) {
      const finalMatch = finalMatchesByPath.get(receipt.result?.path);
      if (finalMatch) receipt.result = describeAtom(finalMatch, false);
    }
    if (changed) {
      const compiled = await validatePrograms(
        nextAtoms, contextFile, atoms, options.programScheduler
      );
      interactionWarnings.push(...compiled.warnings);
      if (!compiled.ok) {
        return failureBase(parsed, contextFile, projectionFile, atoms, compiled.errors);
      }
      await persistChangedGraph({
        atoms: nextAtoms,
        contextFile,
        projectionFile,
        rootName: path.basename(contextFile),
        commitWorld: options.commitWorld,
        expectedRevision: revisionBefore,
        correlationId: interaction.id,
        source
      });
      for (const record of [...programTransformLogs, ...transformLogs]) {
        try {
          await appendTransformLog(contextFile, {
            ...record,
            revisionAfter: record.revisionAfter ?? revisionAfter
          });
        } catch (error) {
          interactionWarnings.push(diagnostic(
            'TRANSFORM_LOG_APPEND_FAILED',
            '事实已原子提交，但辅助变更日志未能写入',
            { cause: error.code ?? error.message }
          ));
        }
      }
    }
    return {
      ok: true,
      language: 'atom',
      command: 'transform',
      batch: true,
      createNew: false,
      changed,
      contextFile,
      projectionFile,
      revisionBefore,
      revisionAfter,
      results,
      warnings: mergeWarnings(interactionWarnings),
      errors: [],
      messages: [...interactionMessages, ...finalProgramMessages],
      interactionId: interaction.id,
      lockState: programLockState(finalProgramLockIndex)
    };
  }
  const [item] = parsed.items;
  if (!item.ok || parsed.errors.length) {
    return failureBase(
      parsed,
      contextFile,
      projectionFile,
      atoms,
      item.errors.length ? item.errors : parsed.errors
    );
  }

  if (parsed.createNew) {
    const created = await applyCreateTransform({
      atoms,
      item,
      contextFile,
      authorize: accessController.authorize,
      matcherRegistry: receiver.matcherRegistry,
      programScheduler: options.programScheduler
    });
    interactionWarnings.push(...(created.warnings ?? []));
    if (created.error) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [created.error], {
        messages: interactionMessages
      });
    }
    let nextAtoms = created.atoms;
    let postRefresh = {
      atoms: nextAtoms,
      lockIndex: programLockIndex,
      messages: [],
      transformLogs: [],
      pathChanges: []
    };
    if (options.programScheduler) {
      try {
        postRefresh = await reconcileProgramsForWorld(nextAtoms, {
          mode: 'transform', nodes: [created.resultPath]
        });
        nextAtoms = postRefresh.atoms;
      } catch (error) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
        )]);
      }
    }
    const finalCreatePath = rewritePath(created.resultPath, postRefresh.pathChanges);
    await persistChangedGraph({
      atoms: nextAtoms,
      contextFile,
      projectionFile,
      rootName: path.basename(contextFile),
      commitWorld: options.commitWorld,
      expectedRevision: revisionBefore,
      correlationId: interaction.id,
      source
    });
    for (const record of [...programTransformLogs, ...postRefresh.transformLogs]) {
      await appendTransformLog(contextFile, record);
    }
    return {
      ok: true,
      language: 'atom',
      command: 'transform',
      createNew: true,
      changed: true,
      contextFile,
      projectionFile,
      revisionBefore,
      revisionAfter: revisionOf(nextAtoms),
      result: describeAtom(
        walkAtoms(nextAtoms).find((match) => match.path.join('/') === finalCreatePath)
          ?? walkAtoms(nextAtoms).at(-1),
        false
      ),
      warnings: mergeWarnings(interactionWarnings),
      errors: [],
      messages: [...interactionMessages, ...postRefresh.messages],
      interactionId: interaction.id,
      lockState: programLockState(postRefresh.lockIndex)
    };
  }

  const run = programRunRequest(item);
  if (run?.error) {
    return failureBase(parsed, contextFile, projectionFile, atoms, [run.error]);
  }
  if (run) {
    const nextAtoms = atoms;
    const revisionAfter = revisionOf(nextAtoms);
    const changed = programChanged;
    if (changed) {
      await persistChangedGraph({
        atoms: nextAtoms,
        contextFile,
        projectionFile,
        rootName: path.basename(contextFile),
        commitWorld: options.commitWorld,
        expectedRevision: revisionBefore,
        correlationId: interaction.id,
        source
      });
      for (const record of programTransformLogs) await appendTransformLog(contextFile, record);
    }
    const resultMatch = walkAtoms(nextAtoms).find((match) => (
      match.path.join('/') === programCycle.selectedProgram?.path
    ));
    return {
      ok: true,
      language: 'atom',
      command: 'transform',
      createNew: false,
      changed,
      contextFile,
      projectionFile,
      revisionBefore,
      revisionAfter,
      result: resultMatch ? describeAtom(resultMatch, false) : null,
      program: {
        path: programCycle.selectedProgram?.path ?? run.selector,
        runtime: 'python-detail',
        choices: (programCycle.choices ?? []).filter((choice) => (
          choice.sourceProgramPath === programCycle.selectedProgram?.path
        ))
      },
      warnings: interactionWarnings,
      errors: [],
      messages: interactionMessages,
      interactionId: interaction.id,
      lockState: programLockState(programLockIndex)
    };
  }

  const transformed = await applyTransform({
    atoms,
    item,
    contextFile,
    authorize: accessController.authorize
  });
  if (transformed.error) {
    return failureBase(parsed, contextFile, projectionFile, atoms, [transformed.error], { messages: interactionMessages });
  }

  let nextAtoms = transformed.atoms;
  let revisionAfter = revisionOf(nextAtoms);
  let changed = revisionAfter !== revisionBefore;
  let postRefresh = {
    atoms: nextAtoms,
    lockIndex: programLockIndex,
    messages: [],
    transformLogs: [],
    pathChanges: []
  };
  if (changed) {
    const compiled = await validatePrograms(
      nextAtoms, contextFile, atoms, options.programScheduler
    );
    interactionWarnings.push(...compiled.warnings);
    if (!compiled.ok) {
      return failureBase(
        parsed,
        contextFile,
        projectionFile,
        atoms,
        compiled.errors
      );
    }
  }
  if (options.programScheduler) {
    try {
      postRefresh = await reconcileProgramsForWorld(nextAtoms, {
        mode: 'transform',
        nodes: [...new Set([
          transformed.sourcePath,
          transformed.resultPath,
          transformed.resultName
        ].filter(Boolean))]
      });
      nextAtoms = postRefresh.atoms;
      revisionAfter = revisionOf(nextAtoms);
      changed = revisionAfter !== revisionBefore;
    } catch (error) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
      )]);
    }
  }
  if (changed) {
    await persistChangedGraph({
      atoms: nextAtoms,
      contextFile,
      projectionFile,
      rootName: path.basename(contextFile),
      commitWorld: options.commitWorld,
      expectedRevision: revisionBefore,
      correlationId: interaction.id,
      source
    });
    for (const record of [...programTransformLogs, ...postRefresh.transformLogs]) {
      await appendTransformLog(contextFile, record);
    }
    if (transformed.logRecord) {
      await appendTransformLog(contextFile, {
        ...transformed.logRecord,
        revisionBefore,
        revisionAfter
      });
    }
  }
  const finalResultPath = rewritePath(
    transformed.resultPath ?? transformed.resultName,
    postRefresh.pathChanges
  );
  const resultMatch = walkAtoms(nextAtoms).find((match) => (
    match.path.join('/') === finalResultPath
  ));
  return {
    ok: true,
    language: 'atom',
    command: 'transform',
    createNew: false,
    changed,
    contextFile,
    projectionFile,
    revisionBefore,
    revisionAfter,
    result: resultMatch ? describeAtom(resultMatch, false) : null,
    warnings: [
      ...mergeWarnings(interactionWarnings)
    ],
    errors: [],
    messages: [...interactionMessages, ...postRefresh.messages],
    interactionId: interaction.id,
    lockState: programLockState(postRefresh.lockIndex)
  };

}
