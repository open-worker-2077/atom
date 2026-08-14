import crypto from 'node:crypto';
import path from 'node:path';
import { diagnostic } from './errors.mjs';

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
import { appendTransformLog, applyTransform } from './transform-executor.mjs';
import {
  projectAtomContext,
  readAtomContext,
  resolveAtomContextFile
} from './context-store.mjs';
import { buildProgramLockIndex, authorizeProgramLock, programLockDeniedDiagnostic, programLockState } from './program-locks.mjs';
import {
  createAccessController,
  describeAtom,
  executeExploreItem,
  executeProgramExplore,
  fieldsByBase,
  oneStoredField,
  walkAtoms
} from './query-capability.mjs';

export { executeProgramExplore } from './query-capability.mjs';

function revisionOf(atoms) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(atoms))
    .digest('hex');
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

function validatePrograms(atoms, contextFile, previousAtoms = null) {
  void atoms;
  void contextFile;
  void previousAtoms;
  return { ok: true, errors: [], warnings: [] };
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
  const parsed = receiver.receive(programObjectSource('transform', request));
  if (!parsed.ok || parsed.batch || parsed.items.length !== 1) {
    return { ok: false, errors: parsed.errors };
  }
  return { ok: true, item: parsed.items[0], parsed };
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
  projectAtomContext(atoms, { rootName });
  if (typeof commitWorld !== 'function') {
    const error = new Error('World mutation requires an explicit commit capability');
    error.code = 'WORLD_COMMIT_CAPABILITY_REQUIRED';
    throw error;
  }
  await commitWorld({
    expectedRevision,
    nextRevision: revisionOf(atoms),
    facts: structuredClone(atoms),
    correlationId,
    source
  });
}

export async function executeAtomLanguage(options = {}) {
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
      programCycle = await options.programScheduler.refresh(atoms, {
        agentOrigin: interaction.agent,
        isolateFailures: true,
        ...(requestedProgramRun?.selector
          ? { programSelector: requestedProgramRun.selector, force: true }
          : {}),
        executeExplore: (request) => executeProgramExplore({
          atoms, request, receiver, accessController: unrestricted, agentOrigin: interaction.agent
        })
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
  const interactionWarnings = [
    ...(parsed.warnings ?? []),
    ...(parsed.command === 'explore' && !requestedProgramRun ? [] : programWarnings)
  ];
  const programLockIndex = buildProgramLockIndex({
    revision: revisionBefore,
    results: options.bypassProgramLocks ? [] : programCycle.locks,
    records: programCycle.records
  });
  const accessController = createAccessController(atoms, { ...options, programLockIndex });
  const interactionMessages = (programCycle.messages ?? [])
    .filter((message) => authorizeProgramLock({
      lockIndex: programLockIndex,
      targetPath: message.sourceProgramPath,
      operation: 'read',
      field: 'messages'
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
      transformed = await applyTransform({
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
  if (parsed.batch || parsed.items.length !== 1) {
    return failureBase(
      parsed,
      contextFile,
      projectionFile,
      atoms,
      [diagnostic(
        'UNSUPPORTED_TRANSFORM_BATCH',
        '首轮真实 transform 一次只执行一个 Atom 改造'
      )]
    );
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
    const commandFields = item.fields.filter((field) => field.commands?.length);
    if (commandFields.length) {
      return failureBase(
        parsed,
        contextFile,
        projectionFile,
        atoms,
        [diagnostic(
          'TRANSFORM_NEW_COMMANDS_REJECTED',
          'transform new 不接受点号改造指令；请提交完整持久 Atom',
          { fields: commandFields.map((field) => field.rawKey) }
        )]
      );
    }
    const atom = persistentAtomFromItem(item);
    const invalid = validateNewAtom(atom);
    if (invalid) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [invalid]);
    }
    const createNameField = oneStoredField(atom, 'name');
    const createName = createNameField?.value;
    const createPath = createName.split('/');
    const createDecision = await accessController.authorize({
      atom,
      name: createName,
      path: createPath
    }, 'write');
    if (createDecision.decision !== 'allow') {
      const programDenied = createDecision.matched
        ? programLockDeniedDiagnostic(createDecision)
        : null;
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        programDenied?.code ?? 'WINDOW_ACCESS_DENIED',
        programDenied?.message ?? '当前窗口无权执行该改造；请反馈派发方',
        programDenied?.details ?? {}
      )], { messages: interactionMessages });
    }
    const selected = exactMatches(atoms, item, receiver.matcherRegistry);
    if (selected.error) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [selected.error]);
    }
    if (selected.matches.length) {
      return failureBase(
        parsed,
        contextFile,
        projectionFile,
        atoms,
        [diagnostic(
          'DUPLICATE_ATOM_NAME',
          `已存在 exact name 为“${selected.expected}”的 Atom，transform new 不会覆盖`,
          { name: selected.expected, paths: selected.matches.map((match) => match.path.join('/')) }
        )]
      );
    }
    let nextAtoms;
    if (createPath.length === 1) {
      nextAtoms = [...structuredClone(atoms), atom];
    } else {
      const childName = createPath.at(-1);
      const parentPath = createPath.slice(0, -1).join('/');
      const parentMatches = walkAtoms(atoms).filter((match) => match.path.join('/') === parentPath);
      if (parentMatches.length !== 1) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          parentMatches.length ? 'AMBIGUOUS_ATOM_NAME' : 'ATOM_NOT_FOUND',
          `transform new parent must resolve to one exact Atom: ${parentPath}`,
          { parentPath, matches: parentMatches.map((match) => match.path.join('/')) }
        )]);
      }
      atom[createNameField.rawKey] = childName;
      nextAtoms = appendNestedAtom(atoms, parentMatches[0], atom);
    }
    const compiled = validatePrograms(nextAtoms, contextFile, atoms);
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
        walkAtoms(nextAtoms).find((match) => match.path.join('/') === createName)
          ?? walkAtoms(nextAtoms).at(-1),
        false
      ),
      warnings: interactionWarnings,
      errors: [],
      messages: interactionMessages,
      interactionId: interaction.id,
      lockState: programLockState(programLockIndex)
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
        runtime: 'python-detail'
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

  const nextAtoms = transformed.atoms;
  const revisionAfter = revisionOf(nextAtoms);
  const changed = revisionAfter !== revisionBefore;
  let postRefresh = null;
  if (changed) {
    const compiled = validatePrograms(nextAtoms, contextFile, atoms);
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
    if (transformed.logRecord) {
      await appendTransformLog(contextFile, {
        ...transformed.logRecord,
        revisionBefore,
        revisionAfter
      });
    }
    if (options.programScheduler) {
      postRefresh = await executeAtomLanguage({
        source: 'atom',
        contextFile,
        projectionFile,
        interaction,
        programScheduler: options.programScheduler,
        bypassProgramLocks: options.bypassProgramLocks,
        commitWorld: options.commitWorld
      });
    }
  }
  const resultMatch = walkAtoms(nextAtoms).find((match) => (
    oneStoredField(match.atom, 'name')?.value === transformed.resultName
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
      ...mergeWarnings(interactionWarnings, postRefresh?.warnings ?? []),
      ...(!postRefresh?.ok ? [diagnostic(
        'POST_TRANSFORM_PROGRAM_REFRESH_FAILED',
        '数据已写入，但随后 Program 刷新失败；锁和自动化状态可能尚未更新',
        { errors: postRefresh?.errors ?? [] }
      )] : [])
    ],
    errors: [],
    messages: [...interactionMessages, ...(postRefresh?.messages ?? [])],
    interactionId: interaction.id,
    lockState: postRefresh?.lockState ?? programLockState(programLockIndex)
  };

}
