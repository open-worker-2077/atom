import path from 'node:path';
import crypto from 'node:crypto';
import { diagnostic } from './errors.mjs';
import {
  revisionOfWorldFacts,
  sealWorldFactsRevision
} from '../../src/atom-system/world-runtime/world-revision.mjs';
import { WORLD_OUTSIDE_NAME } from './world-root.mjs';

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

function immutableClone(value) {
  const clone = structuredClone(value);
  const freeze = (candidate) => {
    if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return candidate;
    for (const child of Object.values(candidate)) freeze(child);
    return Object.freeze(candidate);
  };
  return freeze(clone);
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

function programResealsModelPath(slotBodies, sourceProgramPath, targetPath) {
  if (typeof sourceProgramPath !== 'string' || typeof targetPath !== 'string') return false;
  return (slotBodies ?? []).some((request) => {
    if (request?.action !== 'seal' || request.sourceProgramPath !== sourceProgramPath
      || typeof request.body !== 'string') return false;
    const modelPath = `${request.body.replace(/\/+$/u, '')}/\u69fd\u6a21`;
    return targetPath === modelPath || targetPath.startsWith(`${modelPath}/`);
  });
}

function programDeclaresSlotSeal(slotBodies, sourceProgramPath) {
  return (slotBodies ?? []).some((request) => (
    request?.action === 'seal' && request.sourceProgramPath === sourceProgramPath
  ));
}
import { createAtomLanguageReceiver } from './receiver.mjs';
import {
  appendTransformLog,
  applyBatchRenames,
  applyTransform,
  createExactTransformIndex,
  isBatchRenameItem,
  prepareTransformRelationIndex,
  transformChangesStructure
} from './transform-executor.mjs';
import {
  legacyAtomContextMetadata,
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
import { normalizeScopedTransformRequest } from './slot-relative-scope.mjs';
import { applyShortcutEffect, breakShortcutTargets } from './shortcut-runtime.mjs';
import { validateAgentDelegation } from './window-lock-v1.mjs';
import {
  createWindowJumpAuthorization,
  parseWindowJumpAuthorization,
  validateWindowJumpAuthorization,
  WINDOW_JUMP_AUTHORIZATION_TYPE
} from './window-jump-authorization.mjs';
import {
  createAccessController,
  inheritPreparedAccessWorld,
  inheritPreparedSlotStructureWorld,
  describeAtom,
  executeExploreItem,
  executeProgramExplore,
  fieldsByBase,
  oneStoredField,
  prepareExploreWorld,
  prepareSlotStructureWorld,
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
  return oneStoredField(match.atom, 'thing')?.parsed.types.map((type) => type.raw) ?? [];
}

function exactMatchAtPath(atoms, targetPath) {
  const parts = `${targetPath ?? ''}`.split('/').filter(Boolean);
  let children = atoms;
  let parent = null;
  const pathParts = [];
  for (const part of parts) {
    const matches = children.flatMap((atom, index) => (
      oneStoredField(atom, 'thing')?.value === part ? [{ atom, index }] : []
    ));
    if (matches.length !== 1) return null;
    pathParts.push(part);
    const match = {
      atom: matches[0].atom,
      index: matches[0].index,
      parent,
      path: [...pathParts]
    };
    parent = match;
    children = oneStoredField(match.atom, 'contain')?.value ?? [];
  }
  return parent;
}

function subtreeContainsTypedProgram(atom) {
  if (!atom) return false;
  if (oneStoredField(atom, 'thing')?.parsed.types.some((type) => type.raw === 'program')) {
    return true;
  }
  return (oneStoredField(atom, 'contain')?.value ?? []).some(subtreeContainsTypedProgram);
}

function transformChangesProgramSurface(beforeAtoms, afterAtoms, transformed) {
  const paths = [...new Set([
    transformed?.sourcePath,
    transformed?.resultPath,
    transformed?.resultName
  ].filter(Boolean))];
  return paths.some((targetPath) => (
    subtreeContainsTypedProgram(exactMatchAtPath(beforeAtoms, targetPath)?.atom)
    || subtreeContainsTypedProgram(exactMatchAtPath(afterAtoms, targetPath)?.atom)
  ));
}

function programDeclarationSurface(atoms) {
  return walkAtoms(atoms).flatMap((match) => {
    const thing = oneStoredField(match.atom, 'thing');
    if (!thing?.parsed.types.some((type) => type.raw === 'program')) return [];
    const situation = oneStoredField(match.atom, 'situation');
    return [{
      path: match.path.join('/'),
      thingKey: thing.rawKey,
      situationKey: situation?.rawKey ?? null,
      situation: situation?.value ?? null
    }];
  });
}

function isLocalizedSituationTransform(item) {
  let situationChanged = false;
  for (const field of item.fields ?? []) {
    if (field.baseKey === 'thing') {
      if ((field.commands?.length ?? 0) > 0) return false;
      continue;
    }
    if (field.baseKey !== 'situation') return false;
    if ((field.commands?.length ?? 0) === 0 && !field.valuePresent) continue;
    situationChanged = true;
  }
  return situationChanged;
}

function isStructurePreservingTransform(item) {
  if ((item.fields?.length ?? 0) !== 1) return false;
  const [field] = item.fields;
  return field.baseKey === 'thing'
    && field.valuePresent
    && (field.commands?.length ?? 0) === 1
    && ['ren', 'mov', 'cpy', 'dsc', 'rst'].includes(field.commands[0].name);
}

function newlyAddedProgramPaths(beforeAtoms, afterAtoms) {
  const previousPaths = new Set(walkAtoms(beforeAtoms).map((match) => match.path.join('/')));
  return walkAtoms(afterAtoms)
    .filter((match) => !previousPaths.has(match.path.join('/'))
      && oneStoredField(match.atom, 'thing')?.parsed.types.some((type) => type.raw === 'program'))
    .map((match) => match.path.join('/'));
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
  const required = ['thing', 'situation', 'contain', 'support'];
  const missing = required.filter((baseKey) => (byBase.get(baseKey) ?? []).length !== 1);
  if (missing.length) {
    return diagnostic(
      'TRANSFORM_NEW_REQUIRES_FOUR_AXES',
      'transform new 首轮要求完整提交 thing、situation、contain、support 四轴',
      { missing }
    );
  }
  const thing = byBase.get('thing')[0].value;
  const situation = byBase.get('situation')[0].value;
  const contain = byBase.get('contain')[0].value;
  const support = byBase.get('support')[0].value;
  if (typeof thing !== 'string' || !thing.trim()) {
    return diagnostic('INVALID_ATOM_NAME', 'Atom thing 必须是非空字符串');
  }
  if (typeof situation !== 'string') {
    return diagnostic('INVALID_ATOM_DETAIL', 'Atom situation 必须是字符串');
  }
  if (!Array.isArray(contain) || !Array.isArray(support)) {
    return diagnostic(
      'INVALID_ATOM_GRAPH_AXES',
      'Atom contain 与 support 必须是数组'
    );
  }
  return null;
}

function nameFieldIn(item) {
  return item.fields.find((field) => field.baseKey === 'thing');
}

function exactMatches(atoms, item, matcherRegistry, candidates = null) {
  const nameField = nameFieldIn(item);
  if (!nameField?.valuePresent || typeof nameField.value !== 'string' || !nameField.value) {
    return {
      error: diagnostic(
        'ATOM_NAME_REQUIRED',
        '首轮 explore/transform 执行需要带 Value 的 thing 精确锚点'
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
    const candidate = oneStoredField(atom, 'thing')?.value;
    return matcher.match(candidate, nameField.value);
  });
  return { matches, expected: nameField.value };
}

function buildFailureBase(parsed, contextFile, projectionFile, atoms, errors, extra = {}) {
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
    || field.baseKey !== 'thing'
    || !field.valuePresent
    || typeof field.value !== 'string'
    || !field.value
  ) {
    return {
      error: diagnostic(
        'INVALID_PROGRAM_RUN',
        'Program 只接受独立的 transform {"thing.run.[EXACT_SCOPE_ROOT]":"Program 名称或路径"}'
      )
    };
  }
  return { selector: field.value, scopeRoot: command.parameter || null };
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

async function validateAgentProgramDelegation({
  beforeAtoms,
  afterAtoms,
  creatorSecurity,
  programScheduler
}) {
  if (JSON.stringify(programDeclarationSurface(beforeAtoms))
    === JSON.stringify(programDeclarationSurface(afterAtoms))) {
    return { ok: true, errors: [] };
  }
  if (typeof programScheduler?.deriveAgentSecurity !== 'function') {
    return {
      ok: false,
      errors: [diagnostic(
        'AGENT_RECONFIGURATION_VALIDATOR_UNAVAILABLE',
        'Agent Program source changes require the Program declaration validator'
      )]
    };
  }
  try {
    const before = await programScheduler.deriveAgentSecurity(beforeAtoms);
    const after = await programScheduler.deriveAgentSecurity(afterAtoms);
    const changed = [...new Set([...before.keys(), ...after.keys()])]
      .filter((programPath) => (
        JSON.stringify(before.get(programPath) ?? null)
          !== JSON.stringify(after.get(programPath) ?? null)
      ));
    if (changed.length > 0 && !creatorSecurity) {
      throw Object.assign(
        new Error('Agent Program changes require a current creator Agent'),
        { code: 'AGENT_RECONFIGURATION_CREATOR_REQUIRED' }
      );
    }
    for (const programPath of changed) {
      const child = after.get(programPath);
      if (child) validateAgentDelegation({ creator: creatorSecurity, child });
    }
    return { ok: true, errors: [] };
  } catch (error) {
    return {
      ok: false,
      errors: [diagnostic(error.code ?? 'INVALID_AGENT_DELEGATION', error.message, error.details ?? {})]
    };
  }
}

function appendNestedAtom(atoms, parentMatch, atom) {
  const lineage = [];
  for (let current = parentMatch; current; current = current.parent) lineage.unshift(current.index);
  function appendAt(items, depth) {
    const index = lineage[depth];
    const nextItems = [...items];
    const nextParent = { ...items[index] };
    nextItems[index] = nextParent;
    const contain = oneStoredField(nextParent, 'contain');
    if (depth === lineage.length - 1) {
      nextParent[contain.rawKey] = [...contain.value, structuredClone(atom)];
    } else {
      nextParent[contain.rawKey] = appendAt(contain.value, depth + 1);
    }
    return nextItems;
  }
  return appendAt(atoms, 0);
}

function removeWindowJumpAuthorization(atoms, operationId) {
  const next = structuredClone(atoms);
  let removed = false;
  function visit(items) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const atom = items[index];
      const types = oneStoredField(atom, 'thing')?.parsed.types.map((type) => type.raw) ?? [];
      if (types.includes(WINDOW_JUMP_AUTHORIZATION_TYPE)) {
        let payload = null;
        try {
          payload = JSON.parse(oneStoredField(atom, 'situation')?.value ?? '');
        } catch {}
        if (payload?.operationId === operationId) {
          items.splice(index, 1);
          removed = true;
          continue;
        }
      }
      const children = oneStoredField(atom, 'contain')?.value;
      if (Array.isArray(children)) visit(children);
    }
  }
  visit(next);
  return { atoms: next, removed };
}

function isCompletePersistentAtomItem(item) {
  const required = new Set(['thing', 'situation', 'contain', 'support']);
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

  const createNameField = oneStoredField(atom, 'thing');
  if (createNameField?.parsed.types.some((type) => type.raw === 'agent')) {
    return { error: diagnostic(
      'AGENT_REGISTRATION_REQUIRED',
      '公开 Transform 不能创建 @agent；请由当前 Program 调用 agent()'
    ) };
  }
  const createdMatches = walkAtoms([atom]);
  if (createdMatches.some((match) => (
    oneStoredField(match.atom, 'thing')?.parsed.types.some((type) => type.raw === 'shortcut')
  ))) {
    return { error: diagnostic('SHORTCUT_PERSISTENCE_FORGERY_DENIED', '公开 Transform 不得创建或伪造内核虚拟引用记录') };
  }
  if (createdMatches.some((match) => (
    oneStoredField(match.atom, 'thing')?.parsed.types.some((type) => (
      type.raw === WINDOW_JUMP_AUTHORIZATION_TYPE
    ))
  ))) {
    return { error: diagnostic(
      'KERNEL_GRAPH_FACT_FORGERY_DENIED',
      '公开 Transform 不得创建或伪造内核保留 Graph 事实'
    ) };
  }
  const createName = createNameField?.value;
  const createPath = createName.split('/');
  const persistedCreatePath = createPath[0] === WORLD_OUTSIDE_NAME
    ? createPath.slice(1).join('/')
    : createName;
  const createDecision = await authorize({ atom, name: createName, path: createPath }, 'write');
  if (createDecision.decision !== 'allow') {
    const programDenied = createDecision.matched
      ? programLockDeniedDiagnostic(createDecision)
      : null;
    return { error: diagnostic(
      programDenied?.code ?? createDecision.code ?? 'WINDOW_ACCESS_DENIED',
      programDenied?.message ?? '当前窗口无权执行该改造；请反馈派发方',
      programDenied?.details ?? {}
    ) };
  }

  const exactCreateMatch = exactMatchAtPath(atoms, persistedCreatePath);
  const selected = exactCreateMatch
    ? { matches: [exactCreateMatch], expected: createName }
    : { matches: [], expected: createName };
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
    const requestedParentPath = createPath.slice(0, -1).join('/');
    const parentPath = requestedParentPath === WORLD_OUTSIDE_NAME
      ? requestedParentPath
      : requestedParentPath.startsWith(`${WORLD_OUTSIDE_NAME}/`)
        ? requestedParentPath.slice(WORLD_OUTSIDE_NAME.length + 1)
        : requestedParentPath;
    const exactParentMatch = exactMatchAtPath(atoms, parentPath);
    const parentMatches = exactParentMatch ? [exactParentMatch] : [];
    if (parentMatches.length !== 1) {
      return { error: diagnostic(
        parentMatches.length ? 'AMBIGUOUS_ATOM_NAME' : 'ATOM_NOT_FOUND',
        `transform new parent must resolve to one exact Atom: ${parentPath}`,
        { parentPath, matches: parentMatches.map((match) => match.path.join('/')) }
      ) };
    }
    const parentDecision = await authorize(
      parentMatches[0], 'write', 'contain', { slotMaterialCreate: true, createdAtom: atom }
    );
    if (parentDecision.decision !== 'allow') {
      const programDenied = parentDecision.matched
        ? programLockDeniedDiagnostic(parentDecision, 'contain')
        : null;
      return { error: diagnostic(
        programDenied?.code ?? parentDecision.code ?? 'WINDOW_ACCESS_DENIED',
        programDenied?.message ?? '当前窗口无权修改父 Atom 的 children；请反馈派发方',
        programDenied?.details ?? { parentPath }
      ) };
    }
    atom[createNameField.rawKey] = childName;
    nextAtoms = appendNestedAtom(atoms, parentMatches[0], atom);
  }

  const introducesProgram = createdMatches.some((match) => (
    oneStoredField(match.atom, 'thing')?.parsed.types.some((type) => type.raw === 'program')
  ));
  const compiled = introducesProgram
    ? await validatePrograms(nextAtoms, contextFile, atoms, programScheduler)
    : { ok: true, errors: [], warnings: [] };
  if (!compiled.ok) return { error: compiled.errors[0], warnings: compiled.warnings };
  return {
    atoms: nextAtoms,
    changed: true,
    resultName: createPath.at(-1),
    resultPath: persistedCreatePath,
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
  const opaqueDetail = request && Object.hasOwn(request, 'situation$replace')
    ? request['situation$replace']
    : undefined;
  if (opaqueDetail !== undefined && typeof opaqueDetail !== 'string') {
    return {
      ok: false,
      errors: [diagnostic(
        'INVALID_PROGRAM_DETAIL_REPLACEMENT',
        'Program situation$replace requires one complete string value'
      )]
    };
  }
  const normalized = opaqueDetail === undefined
    ? request
    : Object.fromEntries([
        ...Object.entries(request).filter(([key]) => key !== 'situation$replace'),
        ['situation.rep.__ATOM_PROGRAM_OPAQUE_REPLACEMENT__', null]
      ]);
  const parsed = receiver.receive(programObjectSource('transform', normalized));
  if (!parsed.ok || parsed.batch || parsed.items.length !== 1) {
    return { ok: false, errors: parsed.errors };
  }
  if (opaqueDetail !== undefined) {
    const fields = parsed.items[0].fields.filter((field) => field.baseKey === 'situation');
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
  source,
  changedPaths = null,
  affectedAtoms = null,
  transformLogRecord = null,
  compatibilityManifest,
  localizedSituationValidation = false,
  structurePreservingValidation = false
}) {
  if (!localizedSituationValidation && !structurePreservingValidation) {
    // Structural, support, type and Program changes retain the complete projection gate.
    const validationStartedAt = performance.now();
    projectAtomContext(atoms, { rootName, allowLegacySupport: Boolean(compatibilityManifest) });
    performanceTrace('world-precommit-validation', {
      elapsedMs: Math.round(performance.now() - validationStartedAt)
    });
  }
  if (typeof commitWorld !== 'function') {
    const error = new Error('World mutation requires an explicit commit capability');
    error.code = 'WORLD_COMMIT_CAPABILITY_REQUIRED';
    throw error;
  }
  const commitStartedAt = performance.now();
  const receipt = await commitWorld({
    expectedRevision,
    nextRevision: revisionOf(atoms),
    facts: atoms,
    correlationId,
    source,
    ...(Array.isArray(changedPaths) && changedPaths.length ? { changedPaths } : {}),
    ...(Array.isArray(affectedAtoms) ? { affectedAtoms } : {}),
    ...(transformLogRecord ? { transformLogRecord } : {})
  });
  performanceTrace('world-commit', {
    elapsedMs: Math.round(performance.now() - commitStartedAt)
  });
  return receipt;
}

export async function executeAtomLanguage(options = {}) {
  const pendingSupportDeliveryClaims = new Set();
  function rememberSupportDeliveryClaims(keys = []) {
    for (const key of keys) if (key) pendingSupportDeliveryClaims.add(key);
  }
  function confirmSupportDeliveryClaims() {
    options.programScheduler?.confirmSupportDeliveries?.([...pendingSupportDeliveryClaims]);
    pendingSupportDeliveryClaims.clear();
  }
  function releaseSupportDeliveryClaims() {
    options.programScheduler?.releaseSupportDeliveries?.([...pendingSupportDeliveryClaims]);
    pendingSupportDeliveryClaims.clear();
  }
  function failureBase(...args) {
    releaseSupportDeliveryClaims();
    return buildFailureBase(...args);
  }
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
    atoms = await readAtomContext(contextFile, {
      create: parsed.command === 'atom',
      compatibilityManifest: options.compatibilityManifest
    });
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
  const preparedTransformWorld = prepareTransformRelationIndex(
    atoms,
    path.basename(contextFile)
  );
  const requestStartAtoms = atoms;
  const preparedTransformAtoms = atoms;
  const revisionBefore = revisionOf(atoms);
  let committedAffectedPaths = [];
  const legacyMetadata = legacyAtomContextMetadata(atoms);
  if (parsed.command === 'transform' && legacyMetadata?.mode === 'legacy-read-only') {
    return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
      'LEGACY_GRAPH_MIGRATION_REQUIRED',
      '存量旧 Graph 已以只读兼容模式加载；完成可验证迁移前禁止普通写入',
      {
        sourceFactsHash: legacyMetadata.sourceFactsHash,
        legacyNodes: legacyMetadata.legacyNodes,
        legacyRelations: legacyMetadata.relations.length,
        isolatedPrograms: legacyMetadata.isolatedProgramPaths.length
      }
    )]);
  }
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
    const renameBatch = parsed.items.every(isBatchRenameItem);
    const maintenanceStructuralBatch = options.trustedMaintenance === true
      && parsed.items.every((item) => item.fields.every((field) => (
        field.baseKey === 'thing'
        && field.commands.every((command) => command.name === 'mov' || command.name === 'ren')
      )));
    const hasRename = parsed.items.some((item) => item.fields.some((field) => (
      field.baseKey === 'thing'
      && field.commands.some((command) => command.name === 'ren')
    )));
    if (hasRename && !renameBatch && !maintenanceStructuralBatch) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        'UNSUPPORTED_MIXED_BATCH_RENAME',
        '批量改名必须由纯 thing.ren 项组成；请将移动、situation 与 support 放入另一批事务'
      )]);
    }
    const unsupported = parsed.items.flatMap((item) => item.fields
      .filter((field) => (
        !['thing', 'situation', 'support'].includes(field.baseKey)
        || (field.baseKey === 'thing' && field.commands.some((command) => (
          command.name !== 'mov'
          && !((renameBatch || maintenanceStructuralBatch) && command.name === 'ren')
        )))
      ))
      .map((field) => ({ item, field })))[0];
    if (unsupported) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [{
        ...diagnostic(
          'UNSUPPORTED_TRANSFORM_BATCH_AXIS',
          '批量 transform 当前支持已有 Atom 的纯批量改名、移动、situation 与 support 改造',
          { axis: unsupported.field.baseKey }
        ),
        itemIndex: unsupported.item.index
      }]);
    }
  }
  const interaction = {
    id: options.interaction?.id ?? crypto.randomUUID(),
    agent: options.interaction?.agent ? structuredClone(options.interaction.agent) : null
  };
  const existingTransformStage = parsed.command === 'transform'
    && typeof options.diagnosticRecorder?.enqueue !== 'function'
    && typeof options.diagnosticRecorder?.findByInteractionId === 'function'
    ? await options.diagnosticRecorder.findByInteractionId(interaction.id).catch(() => null)
    : null;
  const transformStageDiagnostics = existingTransformStage?.type === 'transform-stage'
    ? structuredClone(existingTransformStage.stages)
    : [];
  async function recordTransformStage(stage, startedAt, details = {}) {
    if (parsed.command !== 'transform' || !options.diagnosticRecorder?.record) return;
    transformStageDiagnostics.push({
      stage,
      durationMs: performance.now() - startedAt,
      elapsedMs: performance.now() - operationStartedAt,
      candidateProgramCount: details.candidateProgramCount ?? 0,
      executedProgramCount: details.executedProgramCount ?? 0,
      ...(details.slowestProgramFingerprint ? {
        slowestProgramFingerprint: details.slowestProgramFingerprint
      } : {}),
      ...(details.slowestProgramDurationMs !== undefined ? {
        slowestProgramDurationMs: details.slowestProgramDurationMs
      } : {}),
      commitEntered: details.commitEntered === true
    });
    const terminalStage = details.outcome === 'failure'
      || stage === 'program-projection'
      || (stage === 'commit' && !options.programScheduler);
    if (!terminalStage) return;
    try {
      const diagnostic = {
        id: `${interaction.id}:transform-stage`,
        type: 'transform-stage',
        command: 'transform',
        durationMs: performance.now() - operationStartedAt,
        outcome: details.outcome ?? 'success',
        stages: transformStageDiagnostics
      };
      if (typeof options.diagnosticRecorder.enqueue === 'function') {
        options.diagnosticRecorder.enqueue(diagnostic);
      } else {
        await options.diagnosticRecorder.record(diagnostic);
      }
    } catch {
      // Timing diagnostics are observational and must never alter Transform behavior.
    }
  }
  if (transformStageDiagnostics.length === 0) {
    await recordTransformStage('request', operationStartedAt);
  }
  const requestedProgramRun = parsed.command === 'transform'
    && !parsed.batch
    && parsed.items.length === 1
    ? programRunRequest(parsed.items[0])
    : null;
  const canReusePreparedRuntimeIndexes = parsed.command === 'transform'
    && !parsed.batch
    && parsed.items.length === 1
    && (
      isLocalizedSituationTransform(parsed.items[0])
      || options.programScheduler?.hasPreparedIndexesForRevision?.(
        revisionBefore,
        atoms
      ) === true
    );
  let programCycle = { messages: [], locks: [], records: [] };
  let activeRequestDrivenLocks = [];
  let creatorSecurity = null;
  const candidateProgramScheduler = options.programScheduler
    ? (typeof options.programScheduler.createCandidateRuntime === 'function'
      ? options.programScheduler.createCandidateRuntime()
      : typeof options.programScheduler.deriveAgentSecurity !== 'function'
        ? options.programScheduler
        : null)
    : null;
  if (options.programScheduler) {
    const indexPreparationStartedAt = performance.now();
    try {
      activeRequestDrivenLocks = await options.programScheduler.activeRequestDrivenLocks?.(atoms, {
        preparedIndexesValid: canReusePreparedRuntimeIndexes
      }) ?? [];
      const initialAgentPath = interaction.agent?.path ?? null;
      const initialAgentSecurity = initialAgentPath
        ? immutableClone(options.programScheduler.agentSecurity?.get(initialAgentPath) ?? null)
        : null;
      creatorSecurity = initialAgentSecurity;
      let programAccess = null;
      let preparedWorld = null;
      await recordTransformStage('index-preparation', indexPreparationStartedAt);
      const reconcilePrograms = options.programMode === 'reconcile'
        || Boolean(requestedProgramRun?.selector);
      const projectPrograms = options.programMode === 'project';
      const passivePrograms = options.programMode === 'passive';
      const agentOwnsLocalPrograms = passivePrograms && initialAgentPath
        ? walkAtoms(atoms).some((match) => {
            const candidatePath = match.path.join('/');
            return candidatePath.startsWith(`${initialAgentPath}/`)
              && oneStoredField(match.atom, 'thing')?.parsed.types.some((type) => (
                type.raw === 'program'
              ));
          })
        : false;
      const programOperation = reconcilePrograms || projectPrograms || passivePrograms
        ? options.programScheduler.refresh.bind(options.programScheduler)
        : (typeof options.programScheduler.current === 'function'
          ? options.programScheduler.current.bind(options.programScheduler)
          : options.programScheduler.refresh.bind(options.programScheduler));
      const programStartedAt = performance.now();
      const programOptions = {
        agentOrigin: interaction.agent,
        isolateFailures: true,
        preparedIndexesValid: canReusePreparedRuntimeIndexes,
        ...(parsed.command === 'explore' || agentOwnsLocalPrograms ? {
          allowWindowLockSnapshot: true,
          allowContextIncomplete: true
        } : {}),
        ...(passivePrograms ? { passive: true } : {}),
        ...(passivePrograms ? {
          reuseDormantContextFailureCodes: ['WINDOW_JUMP_DESTINATION_INVALID']
        } : {}),
        ...(projectPrograms ? { prepareAllIndexes: true } : {}),
        ...(requestedProgramRun?.selector
          ? {
              programSelector: requestedProgramRun.selector,
              force: true,
              ...(requestedProgramRun.scopeRoot
                ? { slotScopeRoot: requestedProgramRun.scopeRoot }
                : {})
            }
          : {}),
        executeExplore: (request, executionContext = {}) => executeProgramExplore({
          atoms,
          request,
          receiver,
          accessController: programAccess ??= createAccessController(atoms, {
            ...options,
            agentPath: initialAgentPath,
            agentSecurity: initialAgentSecurity,
            graphLocks: []
          }),
          agentOrigin: interaction.agent,
          scopeRoot: executionContext.scopeRoot ?? null,
          preparedWorld: preparedWorld ??= prepareExploreWorld(atoms)
        })
      };
      try {
        programCycle = await programOperation(atoms, programOptions);
      } catch (error) {
        await recordTransformStage('reconcile', programStartedAt, { outcome: 'failure' });
        throw error;
      }
      await recordTransformStage('reconcile', programStartedAt, {
        ...(programCycle.reconcileSummary ?? {})
      });
      if (projectPrograms && (programCycle.failures?.length ?? 0) > 0) {
        // The first project pass records isolated failures as dormant; settle once so the
        // exact-world passive projection can persist without replaying workers on reads.
        const isolatedFailures = structuredClone(programCycle.failures);
        const initialRuntimeWarnings = structuredClone(programCycle.runtimeWarnings ?? []);
        const settleStartedAt = performance.now();
        let settled;
        try {
          settled = await programOperation(atoms, programOptions);
        } catch (error) {
          await recordTransformStage('reconcile', settleStartedAt, { outcome: 'failure' });
          throw error;
        }
        await recordTransformStage('reconcile', settleStartedAt, {
          ...(settled.reconcileSummary ?? {})
        });
        programCycle = {
          ...settled,
          failures: [...isolatedFailures, ...(settled.failures ?? [])],
          runtimeWarnings: [...initialRuntimeWarnings, ...(settled.runtimeWarnings ?? [])]
        };
      }
      if (projectPrograms || passivePrograms) {
        programCycle = {
          ...programCycle,
          messages: [],
          transforms: [],
          shortcuts: [],
          slotBodies: [],
          agentRegistrations: []
        };
      }
      if ((parsed.command === 'atom' || parsed.command === 'explore')
        && !requestedProgramRun) {
        programCycle = {
          ...programCycle,
          shortcuts: [],
          slotBodies: [],
          agentRegistrations: []
        };
      }
      performanceTrace('program-initial-cycle', {
        elapsedMs: Math.round(performance.now() - programStartedAt),
        transforms: programCycle.transforms?.length ?? 0,
        cached: programCycle.cached === true
      });
    } catch (error) {
      releaseSupportDeliveryClaims();
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
  const fatalJumpFailure = (programCycle.failures ?? []).find((failure) => (
    typeof failure.code === 'string' && failure.code.startsWith('WINDOW_JUMP_')
  ));
  if (fatalJumpFailure && options.programMode !== 'project') {
    return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
      fatalJumpFailure.code,
      fatalJumpFailure.message ?? '窗口跳转候选失败',
      { ...(fatalJumpFailure.details ?? {}), program: fatalJumpFailure.programPath }
    )]);
  }
  const missingSupportDelivery = (programCycle.failures ?? []).find((failure) => (
    failure.code === 'SUPPORT_DELIVERY_REQUIRED'
  ));
  if (missingSupportDelivery && options.programMode !== 'project') {
    return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
      missingSupportDelivery.code,
      missingSupportDelivery.message ?? 'support subscriber requires one typed true delivery',
      { ...(missingSupportDelivery.details ?? {}), program: missingSupportDelivery.programPath }
    )]);
  }
  const activeLocks = [...programCycle.locks, ...activeRequestDrivenLocks];
  let programLockIndex = buildProgramLockIndex({
    revision: revisionBefore,
    results: options.bypassProgramLocks ? [] : activeLocks.filter((lock) => !lock.kind),
    records: programCycle.records
  });
  const graphLocks = activeLocks.filter((lock) => lock.kind);
  let programChanged = false;
  const initialProgramTriggerNodes = [];
  const initialAgentPath = interaction.agent?.path ?? null;
  let accessController = createAccessController(atoms, {
    ...options, programLockIndex, agentPath: initialAgentPath,
    agentSecurity: programCycle.agentSecurity,
    graphLocks,
    ...(atoms === preparedTransformAtoms
      ? { preparedAccessMatches: preparedTransformWorld.matches }
      : {})
  });
  const fatalShortcutFailure = requestedProgramRun
    ? (programCycle.failures ?? []).find((failure) => typeof failure.code === 'string'
      && (failure.code.startsWith('INVALID_SHORTCUT_') || failure.code.startsWith('SHORTCUT_')))
    : null;
  if (fatalShortcutFailure) {
    return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
      fatalShortcutFailure.code, fatalShortcutFailure.message ?? '虚拟引用创建失败'
    )]);
  }
  const programTransformLogs = [];
  for (const effect of programCycle.jumpAuthorizations ?? []) {
    const issuerAgentPath = interaction.agent?.path ?? null;
    const issuerSecurity = issuerAgentPath
      ? options.programScheduler?.agentSecurity?.get(issuerAgentPath) ?? programCycle.agentSecurity
      : null;
    const matches = new Map(walkAtoms(atoms).map((match) => [match.path.join('/'), match]));
    const source = matches.get(effect.sourcePath);
    const window = matches.get(effect.windowPath);
    const destination = matches.get(effect.destinationPath);
    const issuerProgram = matches.get(effect.issuerProgramPath);
    const denied = !issuerAgentPath || !issuerSecurity || !source || !window || !destination
      || !issuerProgram || !issuerSecurity.functions?.includes('jump_authorize')
      || (await accessController.authorize(issuerProgram, 'read', 'thing', {
        programPath: effect.issuerProgramPath
      })).decision !== 'allow'
      || (await accessController.authorize(window, 'write', 'thing', {
        programPath: effect.issuerProgramPath,
        windowLifecycle: { action: 'move', destinationPath: effect.destinationPath }
      })).decision !== 'allow'
      || (await accessController.authorize(source, 'write', 'contain', {
        programPath: effect.issuerProgramPath
      })).decision !== 'allow'
      || (await accessController.authorize(destination, 'read', 'thing', {
        programPath: effect.issuerProgramPath
      })).decision !== 'allow'
      || (await accessController.authorize(destination, 'write', 'contain', {
        programPath: effect.issuerProgramPath,
        windowLifecycle: { action: 'move', destinationPath: effect.destinationPath }
      })).decision !== 'allow';
    if (denied) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        'WINDOW_JUMP_AUTHORIZATION_DENIED',
        '签发窗口无权控制当前窗口与迁移目的地'
      )]);
    }
    const recordsByPath = new Map((programCycle.records ?? []).map((record) => [record.path, record]));
    const existing = walkAtoms(atoms).filter((match) => (
      match.parent?.atom === source.atom
      && oneStoredField(match.atom, 'thing')?.parsed.types.some((type) => (
        type.raw === WINDOW_JUMP_AUTHORIZATION_TYPE
      ))
    ));
    if (existing.length > 0) {
      const payload = existing.length === 1 ? parseWindowJumpAuthorization({
        ...existing[0],
        types: oneStoredField(existing[0].atom, 'thing')?.parsed.types.map((type) => type.raw) ?? [],
        detail: oneStoredField(existing[0].atom, 'situation')?.value ?? ''
      }) : null;
      if (!payload || payload.windowPath !== effect.windowPath
        || payload.sourcePath !== effect.sourcePath
        || payload.destinationPath !== effect.destinationPath
        || payload.issuerAgentPath !== issuerAgentPath
        || payload.issuerProgramPath !== effect.issuerProgramPath) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          'WINDOW_JUMP_AUTHORIZATION_CONFLICT',
          '同一 jump source 已存在另一项未消费迁窗授权'
        )]);
      }
      try {
        validateWindowJumpAuthorization({
          payload,
          windowPath: effect.windowPath,
          sourcePath: effect.sourcePath,
          destinationPath: effect.destinationPath,
          issuerSecurity,
          recordsByPath
        });
      } catch (error) {
        releaseSupportDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          error.code ?? 'WINDOW_JUMP_AUTHORIZATION_INVALID', error.message
        )]);
      }
      continue;
    }
    const before = revisionOf(atoms);
    const operationId = crypto.randomUUID();
    let authorization;
    try {
      authorization = createWindowJumpAuthorization({
        operationId,
        effect,
        issuerAgentPath,
        issuerSecurity,
        recordsByPath
      });
    } catch (error) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        error.code ?? 'WINDOW_JUMP_AUTHORIZATION_INVALID', error.message
      )]);
    }
    atoms = appendNestedAtom(atoms, source, authorization.atom);
    programChanged = true;
    initialProgramTriggerNodes.push(effect.sourcePath);
    programTransformLogs.push({
      id: operationId,
      operation: 'window-jump-authorize',
      source: {
        windowPath: effect.windowPath,
        sourcePath: effect.sourcePath,
        destinationPath: effect.destinationPath,
        issuerProgramPath: effect.issuerProgramPath
      },
      revisionBefore: before,
      revisionAfter: revisionOf(atoms)
    });
    accessController = createAccessController(atoms, {
      ...options, programLockIndex, agentPath: initialAgentPath,
      agentSecurity: programCycle.agentSecurity, graphLocks
    });
  }
  for (const effect of programCycle.shortcuts ?? []) {
    const shortcut = await applyShortcutEffect({
      atoms,
      effect,
      authorize: (match, operation, field, actor = {}) => accessController.authorize(
        match, operation, field, { ...actor, programPath: effect.sourceProgramPath }
      )
    });
    if (shortcut.error) return failureBase(parsed, contextFile, projectionFile, atoms, [shortcut.error]);
    if (shortcut.changed) {
      const before = revisionOf(atoms);
      atoms = shortcut.atoms;
      const after = revisionOf(atoms);
      programChanged = true;
      initialProgramTriggerNodes.push(...(shortcut.triggerPaths ?? []));
      programTransformLogs.push({
        id: crypto.randomUUID(), operation: 'program-shortcut',
        source: effect.action === 'delete'
          ? { action: 'delete', referencePath: effect.referencePath,
            referenceIdentity: effect.referenceIdentity }
          : { action: 'create', placement: effect.placement,
            thing: effect.thing, targetPath: effect.targetPath },
        revisionBefore: before, revisionAfter: after
      });
      accessController = createAccessController(atoms, {
        ...options, programLockIndex, agentPath: initialAgentPath,
        agentSecurity: programCycle.agentSecurity, graphLocks
      });
    }
  }
  const jumpEffects = (programCycle.jumps ?? []).filter((jump) => jump.action !== 'guard');
  const jumpBaseAtoms = atoms;
  if (jumpEffects.length > 1) {
    return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
      'WINDOW_JUMP_CONFLICT', '一个候选事务只能执行一次窗口移动或回收'
    )]);
  }
  if (jumpEffects.length === 1) {
    const jump = jumpEffects[0];
    const agentPath = interaction.agent?.path ?? null;
    if (!agentPath) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        'WINDOW_JUMP_AGENT_REQUIRED', '窗口跳转需要当前交互 Agent 的精确坐标'
      )]);
    }
    if (jump.action === 'move') {
      const currentRecords = programCycle.records ?? [];
      const recordsByPath = new Map(currentRecords.map((record) => [record.path, record]));
      let destinationPath = jump.destinationPath ?? null;
      let consumedAuthorization = null;
      let issuerSecurity = null;
      if (jump.authorizationPath) {
        const authorizationRecord = recordsByPath.get(jump.authorizationPath);
        const payload = parseWindowJumpAuthorization(authorizationRecord);
        if (!payload
          || authorizationRecord.path !== jump.authorizationPath
          || payload.windowPath !== agentPath
          || payload.sourcePath !== jump.sourceProgramPath) {
          return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
            'WINDOW_JUMP_AUTHORIZATION_INVALID',
            'jump.where 返回的受控迁窗授权与当前窗口或注册 Program 不匹配'
          )]);
        }
        issuerSecurity = options.programScheduler?.agentSecurity?.get(payload.issuerAgentPath) ?? null;
        try {
          validateWindowJumpAuthorization({
            payload,
            windowPath: agentPath,
            sourcePath: jump.sourceProgramPath,
            destinationPath: payload.destinationPath,
            issuerSecurity,
            recordsByPath
          });
        } catch (error) {
          return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
            error.code ?? 'WINDOW_JUMP_AUTHORIZATION_INVALID', error.message
          )]);
        }
        destinationPath = payload.destinationPath;
        consumedAuthorization = payload;
      }
      const destination = walkAtoms(atoms).find((candidate) => (
        candidate.path.join('/') === destinationPath
      ));
      if (!destination) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          'WINDOW_JUMP_DESTINATION_INVALID', '跳窗目标在当前候选世界中不存在'
        )]);
      }
      const destinationRead = createAccessController(atoms, {
        ...options,
        programLockIndex,
        agentPath,
        agentSecurity: programCycle.agentSecurity,
        graphLocks
      });
      let moveController = destinationRead;
      if (!consumedAuthorization) {
        if ((await destinationRead.authorize(
          destination, 'read', 'thing', { programPath: jump.sourceProgramPath }
        )).decision !== 'allow') {
          return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
            'WINDOW_JUMP_LOCK_DENIED',
            '执行窗口无横向权限；预传坐标、路径或快捷引用不能替代受控迁窗授权',
            { cause: 'WINDOW_JUMP_AUTHORIZATION_REQUIRED' }
          )]);
        }
      } else {
        const payload = consumedAuthorization;
        const issuerController = createAccessController(atoms, {
          ...options,
          programLockIndex,
          agentPath: payload.issuerAgentPath,
          agentSecurity: issuerSecurity,
          graphLocks
        });
        const source = walkAtoms(atoms).find((candidate) => (
          candidate.path.join('/') === jump.sourceProgramPath
        ));
        const window = walkAtoms(atoms).find((candidate) => (
          candidate.path.join('/') === agentPath
        ));
        const decisions = await Promise.all([
          issuerController.authorize(source, 'read', 'thing', {
            programPath: payload.issuerProgramPath
          }),
          issuerController.authorize(window, 'write', 'thing', {
            programPath: payload.issuerProgramPath,
            windowLifecycle: { action: 'move', destinationPath }
          }),
          issuerController.authorize(destination, 'read', 'thing', {
            programPath: payload.issuerProgramPath
          }),
          issuerController.authorize(destination, 'write', 'contain', {
            programPath: payload.issuerProgramPath,
            windowLifecycle: { action: 'move', destinationPath }
          })
        ]);
        if (decisions.some((decision) => decision.decision !== 'allow')) {
          return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
            'WINDOW_JUMP_AUTHORIZATION_DENIED',
            '签发窗口当前已无权控制窗口或迁移目的地'
          )]);
        }
        moveController = issuerController;
      }
      const compiled = compileProgramTransform({
        request: { [`thing.mov.${destinationPath}`]: agentPath }, receiver
      });
      if (!compiled.ok) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          'WINDOW_JUMP_DESTINATION_INVALID',
          compiled.errors?.[0]?.message ?? '跳窗目标无法编译'
        )]);
      }
      const moved = await applyTransform({
        atoms,
        item: compiled.item,
        contextFile,
        authorize: (match, operation, field, actor = {}) => moveController.authorize(
          match, operation, field, {
            ...actor,
            programPath: jump.sourceProgramPath,
            ...(consumedAuthorization ? { windowJumpAuthorization: true } : {}),
            windowLifecycle: { action: 'move', destinationPath }
          }
        )
      });
      if (moved.error) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          moved.error.code === 'WINDOW_ACCESS_DENIED'
            ? 'WINDOW_JUMP_LOCK_DENIED'
            : 'WINDOW_JUMP_DESTINATION_INVALID',
          moved.error.message,
          { cause: moved.error.code }
        )]);
      }
      atoms = moved.atoms;
      if (consumedAuthorization) {
        const consumed = removeWindowJumpAuthorization(
          atoms, consumedAuthorization.operationId
        );
        if (!consumed.removed) {
          return failureBase(parsed, contextFile, projectionFile, jumpBaseAtoms, [diagnostic(
            'WINDOW_JUMP_AUTHORIZATION_INVALID',
            '受控迁窗授权在候选事务中无法精确消费'
          )]);
        }
        atoms = consumed.atoms;
        programTransformLogs.push({
          id: consumedAuthorization.operationId,
          operation: 'window-jump-authorized-move',
          source: {
            windowPath: agentPath,
            sourcePath: jump.sourceProgramPath,
            destinationPath,
            issuerProgramPath: consumedAuthorization.issuerProgramPath
          }
        });
      }
      programChanged = true;
      initialProgramTriggerNodes.push(moved.resultPath, destinationPath);
      interaction.agent.path = moved.resultPath;
      accessController = createAccessController(atoms, {
        ...options,
        programLockIndex,
        agentPath: interaction.agent.path,
        agentSecurity: programCycle.agentSecurity,
        graphLocks
      });
    } else if (jump.action === 'recycle') {
      const candidate = structuredClone(atoms);
      const selected = walkAtoms(candidate).find((entry) => entry.path.join('/') === agentPath);
      if (!selected) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          'WINDOW_JUMP_AGENT_REQUIRED', '待回收窗口不存在'
        )]);
      }
      const nodeLockController = createAccessController(candidate, {
        ...options, programLockIndex, agentPath,
        agentSecurity: programCycle.agentSecurity,
        graphLocks
      });
      for (const entry of walkAtoms([selected.atom])) {
        const actual = walkAtoms(candidate).find((match) => match.atom === entry.atom);
        if ((await nodeLockController.authorize(
          actual, 'write', 'contain', {
            programPath: jump.sourceProgramPath,
            windowLifecycle: { action: 'recycle' }
          }
        )).decision !== 'allow') {
          return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
            'WINDOW_JUMP_LOCK_DENIED', '节点锁拒绝回收窗口'
          )]);
        }
      }
      const container = selected.parent
        ? oneStoredField(selected.parent.atom, 'contain')?.value
        : candidate;
      container.splice(selected.index, 1);
      breakShortcutTargets(candidate, agentPath);
      atoms = candidate;
      programChanged = true;
      interaction.agent = null;
      accessController = createAccessController(atoms, { ...options, agentPath: null, programLockIndex });
    }
  }
  const interactionMessages = (programCycle.messages ?? [])
    .filter((message) => authorizeProgramLock({
      lockIndex: programLockIndex,
      targetPath: message.sourceProgramPath,
      operation: 'read',
      field: 'messages',
      agentPath: interaction.agent?.path ?? null,
      agentTypes: graphTypesAtPath(atoms, interaction.agent?.path),
      agentIdentity: Boolean(interaction.agent?.path && programCycle.agentSecurity),
      targetTypes: graphTypesAtPath(atoms, message.sourceProgramPath),
      action: 'explore'
    }).decision === 'allow')
    .map((message) => ({ interactionId: interaction.id, ...message }));
  let strictSlotRecompute = false;
  for (const request of programCycle.transforms ?? []) {
    const {
      sourceProgramRef: _sourceProgramRef,
      sourceProgramPath,
      sourceScopeRoot = null,
      ...rawTransformRequest
    } = request;
    let transformRequest;
    try {
      transformRequest = normalizeScopedTransformRequest({
        atoms,
        request: rawTransformRequest,
        scopeRoot: sourceScopeRoot
      });
    } catch (error) {
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        error.code ?? 'INVALID_PROGRAM_TRANSFORM', error.message,
        { program: sourceProgramPath, ...(error.details ?? {}) }
      )]);
    }
    const compiled = compileProgramTransform({ request: transformRequest, receiver });
    if (!compiled.ok) {
      if (programDeclaresSlotSeal(programCycle.slotBodies, sourceProgramPath)) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          'INVALID_PROGRAM_TRANSFORM',
          compiled.errors?.[0]?.message ?? 'Program transform 无法编译',
          { program: sourceProgramPath, errors: compiled.errors ?? [] }
        )]);
      }
      if (jumpEffects.length) {
        return failureBase(parsed, contextFile, projectionFile, jumpBaseAtoms, [diagnostic(
          'WINDOW_JUMP_DOWNSTREAM_FAILED',
          compiled.errors?.[0]?.message ?? '跳窗后的 Program Transform 无法编译',
          { program: sourceProgramPath }
        )]);
      }
      interactionWarnings.push(diagnostic(
        'INVALID_PROGRAM_TRANSFORM',
        compiled.errors?.[0]?.message ?? 'Program transform 无法编译',
        { program: sourceProgramPath, errors: compiled.errors ?? [] }
      ));
      continue;
    }
    let transformed;
    const authorizeProgramEffect = (match, operation, field, actor = {}) => {
      const targetPath = match.path.join('/');
      return accessController.authorize(match, operation, field, {
        ...actor,
        programPath: sourceProgramPath,
        slotReseal: actor.slotReseal === true || programResealsModelPath(
          programCycle.slotBodies, sourceProgramPath, targetPath
        )
      });
    };
    try {
      transformed = compiled.createNew
        ? await applyCreateTransform({
            atoms,
            item: compiled.item,
            contextFile,
            authorize: authorizeProgramEffect,
            matcherRegistry: receiver.matcherRegistry,
            programScheduler: options.programScheduler
          })
        : await applyTransform({
            atoms,
            item: compiled.item,
            contextFile,
            authorize: authorizeProgramEffect
          });
    } catch (error) {
      if (jumpEffects.length) {
        return failureBase(parsed, contextFile, projectionFile, jumpBaseAtoms, [diagnostic(
          'WINDOW_JUMP_DOWNSTREAM_FAILED', error.message,
          { program: sourceProgramPath, cause: error.code }
        )]);
      }
      if (programDeclaresSlotSeal(programCycle.slotBodies, sourceProgramPath)) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          error.code ?? 'PROGRAM_TRANSFORM_FAILED', error.message,
          { program: sourceProgramPath }
        )]);
      }
      interactionWarnings.push(diagnostic(
        error.code ?? 'PROGRAM_TRANSFORM_FAILED', error.message,
        { program: sourceProgramPath }
      ));
      continue;
    }
    if (transformed.error) {
      if (jumpEffects.length) {
        return failureBase(parsed, contextFile, projectionFile, jumpBaseAtoms, [diagnostic(
          'WINDOW_JUMP_DOWNSTREAM_FAILED', transformed.error.message,
          { program: sourceProgramPath, cause: transformed.error.code }
        )]);
      }
      if (programDeclaresSlotSeal(programCycle.slotBodies, sourceProgramPath)) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          transformed.error.code ?? 'PROGRAM_TRANSFORM_REJECTED',
          transformed.error.message,
          { program: sourceProgramPath }
        )]);
      }
      interactionWarnings.push(diagnostic(
        'PROGRAM_TRANSFORM_REJECTED', transformed.error.message,
        { program: sourceProgramPath, cause: transformed.error.code }
      ));
      continue;
    }
    interactionWarnings.push(...(transformed.warnings ?? []));
    try {
      projectAtomContext(transformed.atoms, {
        rootName: path.basename(contextFile),
        allowLegacySupport: Boolean(options.compatibilityManifest)
      });
    } catch (error) {
      if (jumpEffects.length) {
        return failureBase(parsed, contextFile, projectionFile, jumpBaseAtoms, [diagnostic(
          'WINDOW_JUMP_DOWNSTREAM_FAILED', error.message,
          { program: sourceProgramPath, cause: error.code }
        )]);
      }
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
      initialProgramTriggerNodes.push(
        transformed.sourcePath,
        transformed.resultPath,
        transformed.resultName
      );
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
    const { sourceProgramPath, sourceScopeRoot: _sourceScopeRoot, ...effect } = request;
    const result = await applySlotBodyEffect({
      atoms,
      effect,
      sourceProgramPath,
      authorize: async ({ path: targetPath }) => {
        const match = walkAtoms(atoms).find((candidate) => candidate.path.join('/') === targetPath);
        if (!match) return { decision: 'deny' };
        return accessController.authorize(
          match, 'write', 'contain', {
            programPath: sourceProgramPath,
            slotReseal: effect.action === 'seal'
          }
        );
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
      projectAtomContext(result.atoms, {
        rootName: path.basename(contextFile),
        allowLegacySupport: Boolean(options.compatibilityManifest)
      });
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
      initialProgramTriggerNodes.push(
        result.receipt?.body,
        result.receipt?.target,
        ...(result.receipt?.recompute_targets ?? [])
      );
      strictSlotRecompute ||= (result.receipt?.recompute_targets?.length ?? 0) > 0;
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

  async function validateRequestCandidate(candidateAtoms) {
    return validateAgentProgramDelegation({
      beforeAtoms: requestStartAtoms,
      afterAtoms: candidateAtoms,
      creatorSecurity,
      programScheduler: candidateProgramScheduler
    });
  }

  function throwCandidateDelegationFailure(errors) {
    const first = errors[0] ?? diagnostic(
      'INVALID_AGENT_DELEGATION', 'Agent Program declaration change was rejected'
    );
    throw Object.assign(new Error(first.message), {
      code: first.code,
      details: first.details ?? {},
      diagnostics: errors
    });
  }

  async function assertRequestCandidateAuthority(candidateAtoms) {
    const delegated = await validateRequestCandidate(candidateAtoms);
    if (!delegated.ok) throwCandidateDelegationFailure(delegated.errors);
  }

  async function reconcileProgramsForWorld(
    candidateAtoms, initialTriggerEvent = null, failOnProgramFailure = false
  ) {
    if (!options.programScheduler) {
      return {
        atoms: candidateAtoms,
        lockIndex: programLockIndex,
        messages: [],
        transformLogs: [],
        pathChanges: []
      };
    }
    if (!candidateProgramScheduler) {
      throw Object.assign(new Error('Candidate Program evaluation requires an isolated runtime'), {
        code: 'PROGRAM_CANDIDATE_RUNTIME_UNAVAILABLE'
      });
    }
    await assertRequestCandidateAuthority(candidateAtoms);
    const runtimeScheduler = candidateProgramScheduler;
    let reconciledAtoms = candidateAtoms;
    const messages = [];
    const transformLogs = [];
    const pathChanges = [];
    let finalLockIndex = programLockIndex;
    let finalGraphLocks = graphLocks;
    let pendingTriggerEvent = initialTriggerEvent;
    const maxPasses = 8;

    for (let pass = 1; pass <= maxPasses; pass += 1) {
      const cycleAgentPath = interaction.agent?.path ?? null;
      const cycleAgentSecurity = cycleAgentPath
        ? structuredClone(runtimeScheduler.agentSecurity?.get(cycleAgentPath)
          ?? programCycle.agentSecurity ?? null)
        : null;
      let programAccess = null;
      let preparedWorld = null;
      const refreshStartedAt = performance.now();
      let cycle;
      try {
        cycle = await runtimeScheduler.refresh(reconciledAtoms, {
          agentOrigin: interaction.agent,
          isolateFailures: true,
          slotTriggerCycleId: interaction.id,
          ...(pendingTriggerEvent ? { triggerEvent: pendingTriggerEvent } : {}),
          executeExplore: (request, executionContext = {}) => executeProgramExplore({
            atoms: reconciledAtoms,
            request,
            receiver,
            accessController: programAccess ??= createAccessController(reconciledAtoms, {
              ...options,
              programLockIndex: finalLockIndex,
              agentPath: cycleAgentPath,
              agentSecurity: cycleAgentSecurity,
              graphLocks: finalGraphLocks
            }),
            agentOrigin: interaction.agent,
            scopeRoot: executionContext.scopeRoot ?? null,
            preparedWorld: preparedWorld ??= prepareExploreWorld(reconciledAtoms)
          })
        });
      } catch (error) {
        await recordTransformStage('reconcile', refreshStartedAt, { outcome: 'failure' });
        throw error;
      }
      rememberSupportDeliveryClaims(cycle.supportDeliveryClaims);
      await recordTransformStage('reconcile', refreshStartedAt, {
        ...(cycle.reconcileSummary ?? {})
      });
      const blockingFailure = (cycle.failures ?? []).find((failure) => failure.blocking === true);
      if ((failOnProgramFailure && (cycle.failures?.length ?? 0) > 0) || blockingFailure) {
        const failure = blockingFailure ?? cycle.failures[0];
        throw Object.assign(new Error(failure.message ?? '槽例派生重算失败'), {
          code: failure.code ?? 'ATOM_PROGRAM_FAILED',
          details: { ...(failure.details ?? {}), program: failure.programPath }
        });
      }
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
      const executedProgramPaths = new Set(cycle.executedProgramPaths ?? []);
      if (!pendingTriggerEvent || executedProgramPaths.size > 0) {
        const reconciledRevision = revisionOf(reconciledAtoms);
        const refreshedLockIndex = buildProgramLockIndex({
          revision: reconciledRevision,
          results: options.bypassProgramLocks ? [] : cycle.locks,
          records: cycle.records
        });
        finalLockIndex = pendingTriggerEvent
          ? mergeProgramLockIndexes({
            revision: reconciledRevision,
            previous: finalLockIndex,
            next: refreshedLockIndex,
            replacedSources: executedProgramPaths
          })
          : refreshedLockIndex;
      }
      const noProgramEffects = executedProgramPaths.size === 0
        && (cycle.transforms?.length ?? 0) === 0
        && (cycle.messages?.length ?? 0) === 0
        && (cycle.shortcuts?.length ?? 0) === 0
        && (cycle.slotBodies?.length ?? 0) === 0
        && (cycle.jumps?.length ?? 0) === 0
        && (cycle.jumpAuthorizations?.length ?? 0) === 0
        && (cycle.agentRegistrations?.length ?? 0) === 0;
      if (pendingTriggerEvent && cycle.reconcileSummary?.preparedIndexHit === true
        && noProgramEffects) {
        return {
          atoms: reconciledAtoms,
          lockIndex: finalLockIndex,
          messages,
          transformLogs,
          pathChanges
        };
      }
      const cycleAccessController = createAccessController(reconciledAtoms, {
        ...options,
        programLockIndex: finalLockIndex,
        agentPath: interaction.agent?.path ?? null,
        agentSecurity: cycle.agentSecurity ?? programCycle.agentSecurity,
        graphLocks: cycle.locks.filter((lock) => lock.kind)
      });
      finalGraphLocks = cycle.locks.filter((lock) => lock.kind);
      messages.push(...(cycle.messages ?? [])
        .filter((message) => authorizeProgramLock({
          lockIndex: finalLockIndex,
          targetPath: message.sourceProgramPath,
          operation: 'read',
          field: 'messages',
          agentPath: interaction.agent?.path ?? null,
          agentTypes: graphTypesAtPath(reconciledAtoms, interaction.agent?.path),
          agentIdentity: Boolean(interaction.agent?.path && (cycle.agentSecurity ?? programCycle.agentSecurity)),
          targetTypes: graphTypesAtPath(reconciledAtoms, message.sourceProgramPath),
          action: 'explore'
        }).decision === 'allow')
        .map((message) => ({ interactionId: interaction.id, ...message })));

      let passChanged = false;
      const compiledRequests = [];
      for (const request of cycle.transforms ?? []) {
        const {
          sourceProgramRef: _sourceProgramRef,
          sourceProgramPath,
          sourceScopeRoot = null,
          sourceSupportDeliveryClaim = null,
          ...rawTransformRequest
        } = request;
        let transformRequest;
        try {
          transformRequest = normalizeScopedTransformRequest({
            atoms: reconciledAtoms,
            request: rawTransformRequest,
            scopeRoot: sourceScopeRoot
          });
        } catch (error) {
          if (sourceSupportDeliveryClaim
            || programDeclaresSlotSeal(cycle.slotBodies, sourceProgramPath)) {
            throw Object.assign(new Error(error.message), {
              code: error.code ?? 'INVALID_PROGRAM_TRANSFORM',
              details: { program: sourceProgramPath, ...(error.details ?? {}) }
            });
          }
          interactionWarnings.push(diagnostic(
            error.code ?? 'INVALID_PROGRAM_TRANSFORM', error.message,
            { program: sourceProgramPath, ...(error.details ?? {}) }
          ));
          continue;
        }
        const compiled = compileProgramTransform({ request: transformRequest, receiver });
        if (!compiled.ok) {
          if (sourceSupportDeliveryClaim
            || programDeclaresSlotSeal(cycle.slotBodies, sourceProgramPath)) {
            throw Object.assign(new Error(
              compiled.errors?.[0]?.message ?? 'Program transform 无法编译'
            ), {
              code: 'INVALID_PROGRAM_TRANSFORM',
              details: { program: sourceProgramPath, errors: compiled.errors ?? [] }
            });
          }
          interactionWarnings.push(diagnostic(
            'INVALID_PROGRAM_TRANSFORM',
            compiled.errors?.[0]?.message ?? 'Program transform 无法编译',
            { program: sourceProgramPath, errors: compiled.errors ?? [] }
          ));
          continue;
        }
        compiledRequests.push({
          sourceProgramPath,
          sourceSupportDeliveryClaim,
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
      if (compiledRequests.length === 0 && (cycle.shortcuts?.length ?? 0) === 0 && (cycle.slotBodies?.length ?? 0) === 0) {
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
          const authorizeProgramEffect = (match, operation, field, actor = {}) => {
            const targetPath = match.path.join('/');
            return cycleAccessController.authorize(
              match, operation, field, {
                ...actor,
                programPath: entry.sourceProgramPath,
                slotReseal: actor.slotReseal === true || programResealsModelPath(
                  cycle.slotBodies, entry.sourceProgramPath, targetPath
                )
              }
            );
          };
          try {
            transformed = entry.createNew
              ? await applyCreateTransform({
                  atoms: candidateAtoms,
                  item: entry.item,
                  contextFile,
                  authorize: authorizeProgramEffect,
                  matcherRegistry: receiver.matcherRegistry,
                  programScheduler: runtimeScheduler
                })
              : await applyTransform({
                  atoms: candidateAtoms,
                  item: entry.item,
                  contextFile,
                  authorize: authorizeProgramEffect,
                  mutateInput,
                  exactIndex
                });
          } catch (error) {
            if (entry.sourceSupportDeliveryClaim
              || programDeclaresSlotSeal(cycle.slotBodies, entry.sourceProgramPath)) {
              return {
                failed: true,
                fatal: {
                  code: error.code ?? 'PROGRAM_TRANSFORM_FAILED',
                  message: error.message,
                  program: entry.sourceProgramPath
                }
              };
            }
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
            if (entry.sourceSupportDeliveryClaim
              || programDeclaresSlotSeal(cycle.slotBodies, entry.sourceProgramPath)) {
              return {
                failed: true,
                fatal: {
                  code: transformed.error.code ?? 'PROGRAM_TRANSFORM_REJECTED',
                  message: transformed.error.message,
                  program: entry.sourceProgramPath
                }
              };
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
      let shortcutAtoms = structuredClone(reconciledAtoms);
      const appliedShortcuts = [];
      for (const effect of cycle.shortcuts ?? []) {
        const shortcut = await applyShortcutEffect({
          atoms: shortcutAtoms,
          effect,
          authorize: (match, operation, field, actor = {}) => cycleAccessController.authorize(
            match, operation, field, { ...actor, programPath: effect.sourceProgramPath }
          )
        });
        if (shortcut.error) {
          throw Object.assign(new Error(shortcut.error.message), {
            code: shortcut.error.code, details: { program: effect.sourceProgramPath }
          });
        }
        shortcutAtoms = shortcut.atoms;
        if (shortcut.changed) appliedShortcuts.push({ effect, shortcut });
      }
      let application = await applyCompiled(shortcutAtoms, true, true);
      if (application.fatal) {
        throw Object.assign(new Error(application.fatal.message), {
          code: application.fatal.code,
          details: { program: application.fatal.program }
        });
      }
      if (!application.failed) {
        try {
          projectAtomContext(application.atoms, {
            rootName: path.basename(contextFile),
            allowLegacySupport: Boolean(options.compatibilityManifest)
          });
        } catch {
          application = { failed: true };
        }
      }
      if (application.failed) {
        application = await applyCompiled(shortcutAtoms, false, true);
      }
      if (application.fatal) {
        throw Object.assign(new Error(application.fatal.message), {
          code: application.fatal.code,
          details: { program: application.fatal.program }
        });
      }
      const appliedSlotBodies = [];
      for (const request of cycle.slotBodies ?? []) {
        const { sourceProgramPath, sourceScopeRoot: _sourceScopeRoot, ...effect } = request;
        const slotResult = await applySlotBodyEffect({
          atoms: application.atoms,
          effect,
          sourceProgramPath,
          authorize: async ({ path: targetPath }) => {
            const match = walkAtoms(application.atoms)
              .find((candidate) => candidate.path.join('/') === targetPath);
            if (!match) return { decision: 'deny' };
            return cycleAccessController.authorize(
              match, 'write', 'contain', {
                programPath: sourceProgramPath,
                slotReseal: effect.action === 'seal'
              }
            );
          }
        });
        if (slotResult.error) {
          throw Object.assign(new Error(slotResult.error.message), {
            code: slotResult.error.code ?? 'PROGRAM_SLOT_BODY_REJECTED',
            details: { program: sourceProgramPath, ...(slotResult.error.details ?? {}) }
          });
        }
        application.atoms = slotResult.atoms;
        failOnProgramFailure ||= (slotResult.receipt?.recompute_targets?.length ?? 0) > 0;
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
        await assertRequestCandidateAuthority(application.atoms);
        reconciledAtoms = application.atoms;
        passChanged = true;
        for (const entry of appliedShortcuts) {
          transformLogs.push({
            id: crypto.randomUUID(), operation: 'program-shortcut',
            source: entry.effect.action === 'delete'
              ? { action: 'delete', referencePath: entry.effect.referencePath,
                referenceIdentity: entry.effect.referenceIdentity }
              : { action: 'create', placement: entry.effect.placement,
                thing: entry.effect.thing, targetPath: entry.effect.targetPath },
            revisionBefore: before, revisionAfter: after
          });
        }
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
          receipt?.target,
          ...(receipt?.recompute_targets ?? [])
        ]))).filter(Boolean))];
        const affectedPaths = [...new Set(application.applied.flatMap(({ transformed }) => ([
          transformed.sourcePath,
          transformed.resultPath,
          ...(transformed.relationPaths ?? []),
          ...(transformed.shortcutPaths ?? [])
        ])).concat(appliedSlotBodies.flatMap(({ receipt }) => ([
          receipt?.body,
          receipt?.target,
          ...(receipt?.recompute_targets ?? [])
        ]))).filter(Boolean))];
        pendingTriggerEvent = triggeredNodes.length
          ? { mode: 'transform', nodes: triggeredNodes, affectedPaths }
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

  async function refreshProgramProjectionForWorld(candidateAtoms, triggerNodes) {
    if (!options.programScheduler || triggerNodes.length === 0) return programLockIndex;
    if (!candidateProgramScheduler) {
      throw Object.assign(new Error('Candidate Program evaluation requires an isolated runtime'), {
        code: 'PROGRAM_CANDIDATE_RUNTIME_UNAVAILABLE'
      });
    }
    await assertRequestCandidateAuthority(candidateAtoms);
    const currentAgentPath = interaction.agent?.path ?? null;
    const programAccess = createAccessController(candidateAtoms, {
      ...options,
      programLockIndex,
      agentPath: currentAgentPath,
      agentSecurity: currentAgentPath
        ? structuredClone(candidateProgramScheduler.agentSecurity?.get(currentAgentPath)
          ?? programCycle.agentSecurity ?? null)
        : null,
      graphLocks
    });
    const preparedWorld = prepareExploreWorld(candidateAtoms);
    const cycle = await candidateProgramScheduler.refresh(candidateAtoms, {
      agentOrigin: interaction.agent,
      isolateFailures: true,
      triggerEvent: { mode: 'transform', nodes: triggerNodes, affectedPaths: triggerNodes },
      executeExplore: (request, executionContext = {}) => executeProgramExplore({
        atoms: candidateAtoms,
        request,
        receiver,
        accessController: programAccess,
        agentOrigin: interaction.agent,
        scopeRoot: executionContext.scopeRoot ?? null,
        preparedWorld
      })
    });
    return buildProgramLockIndex({
      revision: revisionOf(candidateAtoms),
      results: options.bypassProgramLocks ? [] : cycle.locks,
      records: cycle.records
    });
  }

  async function settleContextFreeProgramProjectionForWorld(candidateAtoms) {
    if (!options.programScheduler) return [];
    const unrestricted = createAccessController(candidateAtoms, {});
    const preparedWorld = prepareExploreWorld(candidateAtoms);
    const refreshOptions = {
      agentOrigin: null,
      isolateFailures: true,
      executeExplore: (request, executionContext = {}) => executeProgramExplore({
        atoms: candidateAtoms,
        request,
        receiver,
        accessController: unrestricted,
        agentOrigin: null,
        scopeRoot: executionContext.scopeRoot ?? null,
        preparedWorld
      })
    };
    let cycle = await options.programScheduler.refresh(candidateAtoms, refreshOptions);
    if ((cycle.failures?.length ?? 0) > 0) {
      cycle = await options.programScheduler.refresh(candidateAtoms, refreshOptions);
    }
    let runtimeWarnings = [
      ...(cycle.runtimeWarnings ?? []),
      ...(cycle.failures ?? []).map((failure) => ({
        code: failure.code ?? 'ATOM_PROGRAM_FAILED',
        message: failure.message ?? 'A Program could not form a context-free projection',
        details: {
          ...(failure.details ?? {}),
          ...(failure.programPath ? { program: failure.programPath } : {})
        }
      }))
    ];
    if (runtimeWarnings.some((warning) => warning.code === 'PROGRAM_PROJECTION_PERSIST_FAILED')
      && options.programScheduler.persistComputedContextFreeProjection) {
      try {
        await options.programScheduler.persistComputedContextFreeProjection(candidateAtoms, {
          isolateFailures: true
        });
        runtimeWarnings = runtimeWarnings.filter((warning) => (
          warning.code !== 'PROGRAM_PROJECTION_PERSIST_FAILED'
        ));
      } catch (error) {
        if (error?.code !== 'PROGRAM_PROJECTION_PERSIST_FAILED') throw error;
      }
    }
    return runtimeWarnings;
  }

  async function commitChangedGraph(candidateAtoms, {
    projectionRebase = null,
    changedPaths = projectionRebase?.changedPaths ?? null,
    affectedAtoms = null,
    transformLogRecord = null,
    localizedSituationValidation = false,
    structurePreservingValidation = false,
    preparedRuntimeRecordsPromise = null
  } = {}) {
    const delegated = await validateRequestCandidate(candidateAtoms);
    if (!delegated.ok) {
      return {
        authorizationFailure: failureBase(
          parsed, contextFile, projectionFile, requestStartAtoms, delegated.errors
        )
      };
    }
    const commitStartedAt = performance.now();
    let receipt = null;
    try {
      receipt = await persistChangedGraph({
        atoms: candidateAtoms,
        contextFile,
        projectionFile,
        rootName: path.basename(contextFile),
        commitWorld: options.commitWorld,
        expectedRevision: revisionBefore,
        correlationId: interaction.id,
        source,
        changedPaths,
        affectedAtoms: affectedAtoms ?? (Array.isArray(changedPaths) ? changedPaths.map((path) => ({
          path,
          axes: ['contain', 'situation', 'support', 'thing']
        })) : null),
        transformLogRecord,
        compatibilityManifest: options.compatibilityManifest,
        localizedSituationValidation,
        structurePreservingValidation
      });
      committedAffectedPaths = [...new Set((receipt?.affectedAtoms ?? [])
        .map(({ path }) => path)
        .filter(Boolean))].sort();
    } catch (error) {
      releaseSupportDeliveryClaims();
      await recordTransformStage('commit', commitStartedAt, {
        commitEntered: true,
        outcome: 'failure'
      });
      throw error;
    }
    confirmSupportDeliveryClaims();
    await recordTransformStage('commit', commitStartedAt, { commitEntered: true });
    let derivedRecoveryPending = false;
    try {
      await options.programScheduler?.rebuildAgentSecurity?.(candidateAtoms);
    } catch (error) {
      derivedRecoveryPending = true;
      options.programScheduler?.invalidateDerivedWorldState?.();
      interactionWarnings.push(diagnostic(
        'AGENT_SECURITY_REBUILD_RECOVERY_PENDING',
        'World facts are committed, but Agent security requires reconstruction on next use',
        { cause: error.code ?? error.name ?? 'AGENT_SECURITY_REBUILD_FAILED' }
      ));
    }
    if (!committedAffectedPaths.length) {
      committedAffectedPaths = Array.isArray(changedPaths)
        ? [...new Set(changedPaths.filter(Boolean))].sort()
        : [];
    }
    if (derivedRecoveryPending) {
      await recordTransformStage('program-projection', performance.now(), {
        candidateProgramCount: 0,
        executedProgramCount: 0
      });
      return receipt;
    }
    try {
      let rebased = null;
      const projectionSettleStartedAt = performance.now();
      if (projectionRebase && options.programScheduler?.rebaseContextFreeProjection) {
        try {
          rebased = await options.programScheduler.rebaseContextFreeProjection(
            projectionRebase.previousAtoms,
            candidateAtoms,
            {
              changedPaths: projectionRebase.changedPaths,
              isolateFailures: true,
              previousRevision: receipt?.beforeRevision ?? revisionBefore,
              revision: receipt?.afterRevision ?? revisionOf(candidateAtoms)
            }
          );
        } catch {
          rebased = null;
        }
      }
      const settleWarnings = rebased?.persisted === true
        ? []
        : await settleContextFreeProgramProjectionForWorld(candidateAtoms);
      if (preparedRuntimeRecordsPromise) {
        try {
          const preparedRuntimeRecords = await preparedRuntimeRecordsPromise;
          await options.programScheduler?.installPreparedRuntimeIndexes?.(
            candidateAtoms,
            preparedRuntimeRecords
          );
        } catch {
          // A failed performance cache never changes an already committed business result.
        }
      }
      await recordTransformStage('program-projection', projectionSettleStartedAt, {
        candidateProgramCount: 0,
        executedProgramCount: 0
      });
      performanceTrace('program-projection-settle', {
        elapsedMs: Math.round(performance.now() - projectionSettleStartedAt),
        rebased: rebased?.persisted === true,
        local: rebased?.local === true,
        reason: rebased?.reason ?? null
      });
      interactionWarnings.push(...settleWarnings.map((warning) => diagnostic(
        warning.code ?? 'PROGRAM_RUNTIME_WARNING',
        warning.message ?? 'Program runtime reported a recoverable warning',
        warning.details ?? {}
      )));
    } catch (error) {
      interactionWarnings.push(diagnostic(
        'PROGRAM_PROJECTION_RECOVERY_PENDING',
        'World facts are committed, but the context-free Program projection requires recovery',
        { cause: error.code ?? error.name ?? 'PROGRAM_PROJECTION_SETTLE_FAILED' }
      ));
    }
    return receipt;
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

  if (programChanged && (
    parsed.command === 'atom' || parsed.command === 'explore' || strictSlotRecompute
  )) {
    let reconciled;
    try {
      const triggerNodes = [...new Set(initialProgramTriggerNodes.filter(Boolean))];
      reconciled = await reconcileProgramsForWorld(
        atoms,
        triggerNodes.length ? { mode: 'transform', nodes: triggerNodes } : null,
        strictSlotRecompute
      );
    } catch (error) {
      releaseSupportDeliveryClaims();
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
      )]);
    }
    atoms = reconciled.atoms;
    programLockIndex = reconciled.lockIndex;
    accessController = createAccessController(atoms, {
      ...options, programLockIndex, agentPath: interaction.agent?.path ?? null,
      agentSecurity: programCycle.agentSecurity
    });
    interactionMessages.push(...reconciled.messages);
    programTransformLogs.push(...reconciled.transformLogs);
  }

  if (parsed.command === 'atom') {
    if (programChanged) {
      const commitReceipt = await commitChangedGraph(atoms);
      if (commitReceipt?.authorizationFailure) return commitReceipt.authorizationFailure;
      for (const record of programTransformLogs) await appendTransformLog(contextFile, record);
    }
    if (options.programMode === 'project' && (programCycle.failures?.length ?? 0) > 0) {
      try {
        const settleWarnings = await settleContextFreeProgramProjectionForWorld(atoms);
        interactionWarnings.push(...settleWarnings.map((warning) => diagnostic(
          warning.code ?? 'PROGRAM_RUNTIME_WARNING',
          warning.message ?? 'Program runtime reported a recoverable warning',
          warning.details ?? {}
        )));
      } catch (error) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          error.code ?? 'ATOM_PROGRAM_PROJECTION_MISSING',
          error.message,
          error.details ?? {}
        )]);
      }
    }
    const matches = walkAtoms(atoms);
    const visible = [];
    for (const match of matches) {
      if ((await accessController.authorize(match, 'read', 'thing')).decision === 'allow') visible.push(match);
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
      const commitReceipt = await commitChangedGraph(atoms);
      if (commitReceipt?.authorizationFailure) return commitReceipt.authorizationFailure;
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
      executeExploreItem(atoms, item, receiver.matcherRegistry, accessController, programLockIndex, null, { graphLocks })
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
    const renameBatch = parsed.items.every(isBatchRenameItem);
    if (renameBatch) {
      const renamed = await applyBatchRenames({
        atoms: nextAtoms,
        items: parsed.items,
        contextFile,
        authorize: accessController.authorize
      });
      if (renamed.error) {
        return failureBase(parsed, contextFile, projectionFile, atoms, [{
          ...renamed.error,
          itemIndex: renamed.itemIndex
        }], { messages: interactionMessages });
      }
      nextAtoms = renamed.atoms;
      const matchesByPath = new Map(walkAtoms(nextAtoms).map((match) => [
        match.path.join('/'), match
      ]));
      for (const renamedItem of renamed.results) {
        const resultMatch = matchesByPath.get(renamedItem.resultPath);
        results.push({
          index: renamedItem.index,
          changed: renamedItem.changed,
          result: resultMatch ? describeAtom(resultMatch, false) : null
        });
        for (const path of [renamedItem.sourcePath, renamedItem.resultPath]) {
          if (path) transformEventNodes.add(path);
        }
      }
      for (const path of [...(renamed.relationPaths ?? []), ...(renamed.shortcutPaths ?? [])]) {
        if (path) transformEventNodes.add(path);
      }
    }
    for (const candidate of renameBatch ? [] : parsed.items) {
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
          : oneStoredField(match.atom, 'thing')?.value === transformed.resultName
      ));
      results.push({
        index: candidate.index,
        changed: transformed.changed === true,
        result: resultMatch ? describeAtom(resultMatch, false) : null
      });
      for (const path of [transformed.sourcePath, transformed.resultPath]) {
        if (path) transformEventNodes.add(path);
      }
      for (const path of [...(transformed.relationPaths ?? []), ...(transformed.shortcutPaths ?? [])]) {
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

    for (const programPath of newlyAddedProgramPaths(atoms, nextAtoms)) {
      transformEventNodes.add(programPath);
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
        releaseSupportDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
        )]);
      }
      nextAtoms = reconciled.atoms;
      finalProgramLockIndex = reconciled.lockIndex;
      finalProgramMessages.push(...reconciled.messages);
      programTransformLogs.push(...reconciled.transformLogs);
      for (const change of reconciled.pathChanges ?? []) {
        for (const path of [change.sourcePath, change.resultPath]) {
          if (path) transformEventNodes.add(path);
        }
      }
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
        releaseSupportDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, compiled.errors);
      }
      const programSurfaceChanged = [...transformEventNodes].some((targetPath) => (
        subtreeContainsTypedProgram(exactMatchAtPath(atoms, targetPath)?.atom)
        || subtreeContainsTypedProgram(exactMatchAtPath(nextAtoms, targetPath)?.atom)
      ));
      if (programSurfaceChanged) {
        const delegated = await validateRequestCandidate(nextAtoms);
        if (!delegated.ok) {
          releaseSupportDeliveryClaims();
          return failureBase(parsed, contextFile, projectionFile, atoms, delegated.errors);
        }
      }
      const commitReceipt = await commitChangedGraph(nextAtoms, {
        changedPaths: [...transformEventNodes]
      });
      if (commitReceipt?.authorizationFailure) return commitReceipt.authorizationFailure;
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
    if (!changed) confirmSupportDeliveryClaims();
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
      affectedPaths: committedAffectedPaths,
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
    if (transformChangesProgramSurface(atoms, nextAtoms, { resultPath: created.resultPath })) {
      const delegated = await validateRequestCandidate(nextAtoms);
      if (!delegated.ok) {
        releaseSupportDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, delegated.errors);
      }
    }
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
          mode: 'transform', nodes: [created.resultPath], affectedPaths: [created.resultPath]
        });
        nextAtoms = postRefresh.atoms;
      } catch (error) {
        releaseSupportDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
        )]);
      }
    }
    const finalCreatePath = rewritePath(created.resultPath, postRefresh.pathChanges);
    const createChangedPaths = [
      created.resultPath,
      ...postRefresh.pathChanges.flatMap((change) => [change.sourcePath, change.resultPath])
    ].filter(Boolean);
    const canRebaseCreateProjection = programTransformLogs.length === 0
      && postRefresh.transformLogs.length === 0
      && postRefresh.pathChanges.length === 0;
    const commitReceipt = await commitChangedGraph(nextAtoms, canRebaseCreateProjection ? {
      projectionRebase: {
        previousAtoms: atoms,
        changedPaths: createChangedPaths
      }
    } : { changedPaths: createChangedPaths });
    if (commitReceipt?.authorizationFailure) return commitReceipt.authorizationFailure;
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
      revisionAfter: commitReceipt?.afterRevision?.replace(/^sha256:/u, '')
        ?? revisionOf(nextAtoms),
      result: describeAtom(
        exactMatchAtPath(nextAtoms, finalCreatePath) ?? walkAtoms(nextAtoms).at(-1),
        false
      ),
      warnings: mergeWarnings(interactionWarnings),
      errors: [],
      messages: [...interactionMessages, ...postRefresh.messages],
      interactionId: interaction.id,
      affectedPaths: committedAffectedPaths,
      lockState: programLockState(postRefresh.lockIndex)
    };
  }

  const run = programRunRequest(item);
  if (run?.error) {
    releaseSupportDeliveryClaims();
    return failureBase(parsed, contextFile, projectionFile, atoms, [run.error]);
  }
  if (run) {
    const nextAtoms = atoms;
    const revisionAfter = revisionOf(nextAtoms);
    const changed = programChanged;
    let finalProgramLockIndex = programLockIndex;
    if (changed && !strictSlotRecompute) {
      try {
        finalProgramLockIndex = await refreshProgramProjectionForWorld(
          nextAtoms,
          [...new Set(initialProgramTriggerNodes.filter(Boolean))]
        );
      } catch (error) {
        releaseSupportDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
        )]);
      }
    }
    if (changed) {
      const commitReceipt = await commitChangedGraph(nextAtoms);
      if (commitReceipt?.authorizationFailure) return commitReceipt.authorizationFailure;
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
      affectedPaths: committedAffectedPaths,
      lockState: programLockState(finalProgramLockIndex)
    };
  }

  const transformApplyStartedAt = performance.now();
  const transformed = await applyTransform({
    atoms,
    item,
    contextFile,
    authorize: accessController.authorize,
    exactIndex: preparedTransformWorld.exactIndex,
    allMatches: preparedTransformWorld.allMatches,
    transactionTransformLog: options.transactionTransformLog ?? []
  });
  if (transformed.error) {
    releaseSupportDeliveryClaims();
    return failureBase(parsed, contextFile, projectionFile, atoms, [transformed.error], { messages: interactionMessages });
  }

  let nextAtoms = transformed.atoms;
  let revisionAfter = revisionBefore;
  let changed = transformed.changed === true || programChanged;
  const programSurfaceChanged = changed
    && transformChangesProgramSurface(atoms, nextAtoms, transformed);
  let postRefresh = {
    atoms: nextAtoms,
    lockIndex: programLockIndex,
    messages: [],
    transformLogs: [],
    pathChanges: []
  };
  if (programSurfaceChanged) {
    const compiled = await validatePrograms(
      nextAtoms, contextFile, atoms, options.programScheduler
    );
    interactionWarnings.push(...compiled.warnings);
    if (!compiled.ok) {
      releaseSupportDeliveryClaims();
      return failureBase(
        parsed,
        contextFile,
        projectionFile,
        atoms,
        compiled.errors
      );
    }
    const delegated = await validateRequestCandidate(nextAtoms);
    if (!delegated.ok) {
      releaseSupportDeliveryClaims();
      return failureBase(parsed, contextFile, projectionFile, atoms, delegated.errors);
    }
  }
  await recordTransformStage('transform-apply', transformApplyStartedAt);
  const transformAffectedPaths = [...new Set([
    transformed.sourcePath,
    transformed.resultPath,
    ...(transformed.relationPaths ?? []),
    ...(transformed.shortcutPaths ?? [])
  ].filter(Boolean))];
  if (options.programScheduler) {
    try {
      postRefresh = await reconcileProgramsForWorld(nextAtoms, {
        mode: 'transform',
        preparedIndexesValid: !programSurfaceChanged,
        preparedSupportIndexValid: !programSurfaceChanged && isLocalizedSituationTransform(item),
        supportBaseRevision: revisionOfWorldFacts(atoms),
        affectedPaths: transformAffectedPaths,
        nodes: [...new Set([
          transformed.sourcePath,
          transformed.resultPath,
          transformed.resultName,
          ...(programSurfaceChanged ? newlyAddedProgramPaths(atoms, nextAtoms) : [])
        ].filter(Boolean))]
      });
      nextAtoms = postRefresh.atoms;
      changed = changed
        || postRefresh.transformLogs.length > 0
        || postRefresh.pathChanges.length > 0;
    } catch (error) {
      releaseSupportDeliveryClaims();
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
      )]);
    }
  }
  if (changed) {
    revisionAfter = sealWorldFactsRevision(nextAtoms).slice('sha256:'.length);
    const transformLogRecord = transformed.logRecord ? {
      ...transformed.logRecord,
      revisionBefore,
      revisionAfter
    } : null;
    if (!programSurfaceChanged && isLocalizedSituationTransform(item)) {
      inheritPreparedAccessWorld(atoms, nextAtoms);
    }
    const canRebaseProjection = programTransformLogs.length === 0
      && postRefresh.transformLogs.length === 0
      && postRefresh.pathChanges.length === 0;
    const transformedPaths = transformAffectedPaths;
    const inheritedSlotStructure = isStructurePreservingTransform(item)
      && inheritPreparedSlotStructureWorld(atoms, nextAtoms, transformedPaths);
    const preparedRuntimeRecordsPromise = canRebaseProjection
      ? Promise.resolve().then(() => {
          prepareTransformRelationIndex(nextAtoms, path.basename(contextFile));
          if (!inheritedSlotStructure) prepareSlotStructureWorld(nextAtoms);
          return options.programScheduler?.prepareRuntimeRecords?.(nextAtoms) ?? null;
        })
      : null;
    const commitReceipt = await commitChangedGraph(nextAtoms, canRebaseProjection ? {
      projectionRebase: {
        previousAtoms: atoms,
        changedPaths: transformedPaths
      },
      localizedSituationValidation: !programSurfaceChanged
        && isLocalizedSituationTransform(item),
      structurePreservingValidation: !programSurfaceChanged
        && isStructurePreservingTransform(item),
      preparedRuntimeRecordsPromise,
      transformLogRecord
    } : {
      changedPaths: [...new Set([
        transformed.sourcePath,
        transformed.resultPath,
        ...(transformed.relationPaths ?? []),
        ...(transformed.shortcutPaths ?? []),
        ...postRefresh.pathChanges.flatMap((change) => [change.sourcePath, change.resultPath])
      ].filter(Boolean))],
      transformLogRecord
    });
    if (commitReceipt?.authorizationFailure) return commitReceipt.authorizationFailure;
    const reversibleRecordCommitted = transformLogRecord
      && commitReceipt?.result?.transformLogRecord?.id === transformLogRecord.id;
    const auditStartedAt = performance.now();
    for (const record of [...programTransformLogs, ...postRefresh.transformLogs]) {
      try {
        await appendTransformLog(contextFile, record);
      } catch (error) {
        if (!reversibleRecordCommitted) throw error;
        interactionWarnings.push(diagnostic(
          'TRANSFORM_LOG_MIRROR_FAILED',
          '事实已由中央事务提交，但辅助 Transform 日志镜像写入失败',
          { cause: error.code ?? error.name }
        ));
      }
    }
    if (transformLogRecord) {
      try {
        await appendTransformLog(contextFile, transformLogRecord);
      } catch (error) {
        if (!reversibleRecordCommitted) throw error;
        interactionWarnings.push(diagnostic(
          'TRANSFORM_LOG_MIRROR_FAILED',
          '事实与可逆记录已由中央事务提交，但辅助 Transform 日志镜像写入失败',
          { cause: error.code ?? error.name }
        ));
      }
    }
    performanceTrace('transform-audit-append', {
      elapsedMs: Math.round(performance.now() - auditStartedAt)
    });
  }
  const resultLookupStartedAt = performance.now();
  const finalResultPath = rewritePath(
    transformed.resultPath ?? transformed.resultName,
    postRefresh.pathChanges
  );
  const resultMatch = walkAtoms(nextAtoms).find((match) => (
    match.path.join('/') === finalResultPath
  ));
  performanceTrace('transform-result-lookup', {
    elapsedMs: Math.round(performance.now() - resultLookupStartedAt)
  });
  if (!changed) confirmSupportDeliveryClaims();
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
    ...(transformed.archive ? { archive: structuredClone(transformed.archive) } : {}),
    warnings: [
      ...mergeWarnings(interactionWarnings)
    ],
    errors: [],
    messages: [...interactionMessages, ...postRefresh.messages],
    interactionId: interaction.id,
    affectedPaths: committedAffectedPaths,
    lockState: programLockState(postRefresh.lockIndex)
  };

}
