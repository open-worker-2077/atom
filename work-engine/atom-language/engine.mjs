import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
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

function relocationPatchPath(value) {
  if (typeof value !== 'string') return value;
  const separator = value.lastIndexOf('/');
  return separator > 0 ? value.slice(0, separator) : value;
}

function programRefreshPatchPaths(refresh) {
  const relocations = refresh?.pathChanges ?? [];
  const relocatedRoots = relocations.flatMap((change) => [change.sourcePath, change.resultPath])
    .filter((value) => typeof value === 'string' && value);
  const stableChanges = (refresh?.changedPaths ?? []).filter((candidate) => (
    !relocatedRoots.some((root) => candidate === root || candidate.startsWith(`${root}/`))
  ));
  return [
    ...stableChanges,
    ...relocations.flatMap((change) => [
      relocationPatchPath(change.sourcePath),
      relocationPatchPath(change.resultPath)
    ])
  ].filter(Boolean);
}

function relevantProgramWarnings(items, warnings) {
  const visiblePaths = visibleExplorePaths(items);
  return warnings.filter((warning) => visiblePaths.has(warning.program));
}

function relevantProgramMessages(items, messages) {
  const visiblePaths = visibleExplorePaths(items);
  return messages.filter((message) => visiblePaths.has(message.sourceProgramPath));
}

function programResealsModelPath(atoms, slotBodies, sourceProgramPath, targetPath) {
  if (typeof sourceProgramPath !== 'string' || typeof targetPath !== 'string') return false;
  return (slotBodies ?? []).some((request) => {
    if (request?.action !== 'seal' || request.sourceProgramPath !== sourceProgramPath
      || typeof request.body !== 'string') return false;
    const modelPath = slotBodyModelPath(atoms, request.body);
    if (!modelPath) return false;
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
  rewriteProgramSourcePathLiterals,
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
import { applySlotBodyEffect, slotBodyModelPath } from './slot-body-runtime.mjs';
import { resolveSlotSignalDeliveries } from './slot-signal-runtime.mjs';
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

function worldChangedAtPaths(beforeAtoms, afterAtoms, paths) {
  return [...new Set(paths.filter(Boolean))].some((targetPath) => (
    !isDeepStrictEqual(
      exactMatchAtPath(beforeAtoms, targetPath)?.atom,
      exactMatchAtPath(afterAtoms, targetPath)?.atom
    )
  ));
}

function graphTypesAtPath(atoms, targetPath) {
  if (!targetPath) return [];
  const match = walkAtoms(atoms).find((candidate) => candidate.path.join('/') === targetPath);
  if (!match) return [];
  return oneStoredField(match.atom, 'thing')?.parsed.types.map((type) => type.raw) ?? [];
}

function graphRecordsByPath(atoms) {
  return new Map(walkAtoms(atoms).map((match) => {
    const thing = oneStoredField(match.atom, 'thing');
    return [match.path.join('/'), {
      path: match.path.join('/'),
      types: thing?.parsed.types.map((type) => type.raw) ?? [],
      detail: oneStoredField(match.atom, 'situation')?.value ?? ''
    }];
  }));
}

function owningAgentPath(agentSecurity, programPath) {
  if (!agentSecurity || typeof programPath !== 'string') return null;
  return [...agentSecurity.keys()]
    .filter((candidate) => (
      programPath === candidate || programPath.startsWith(`${candidate}/`)
    ))
    .sort((left, right) => right.length - left.length)[0] ?? null;
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
    children = oneStoredField(match.atom, 'slot')?.value ?? [];
  }
  return parent;
}

function subtreeSlotsTypedProgram(atom) {
  if (!atom) return false;
  if (oneStoredField(atom, 'thing')?.parsed.types.some((type) => type.raw === 'program')) {
    return true;
  }
  return (oneStoredField(atom, 'slot')?.value ?? []).some(subtreeSlotsTypedProgram);
}

function transformChangesProgramSurface(beforeAtoms, afterAtoms, transformed) {
  const paths = [...new Set([
    transformed?.sourcePath,
    transformed?.resultPath,
    transformed?.resultName
  ].filter(Boolean))];
  return paths.some((targetPath) => (
    subtreeSlotsTypedProgram(exactMatchAtPath(beforeAtoms, targetPath)?.atom)
    || subtreeSlotsTypedProgram(exactMatchAtPath(afterAtoms, targetPath)?.atom)
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

function relocatedProgramDeclarationSurface(atoms, pathChanges = [], simultaneous = false) {
  const finalChanges = simultaneous
    ? [...pathChanges].sort((left, right) => right.sourcePath.length - left.sourcePath.length) : null;
  const rewritePath = (value) => {
    if (finalChanges) {
      const change = finalChanges.find(({ sourcePath }) => value === sourcePath || value?.startsWith(`${sourcePath}/`));
      return change ? `${change.resultPath}${value.slice(change.sourcePath.length)}` : value;
    }
    return pathChanges.reduce((current, { sourcePath, resultPath }) => (
    current === sourcePath || current?.startsWith(`${sourcePath}/`)
      ? `${resultPath}${current.slice(sourcePath.length)}`
      : current
    ), value);
  };
  return programDeclarationSurface(atoms)
    .map((declaration) => ({
      ...declaration,
      path: rewritePath(declaration.path),
      situation: rewriteProgramSourcePathLiterals(declaration.situation, pathChanges)
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
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
  const required = ['thing', 'situation', 'slot', 'strut'];
  const missing = required.filter((baseKey) => (byBase.get(baseKey) ?? []).length !== 1);
  if (missing.length) {
    return diagnostic(
      'TRANSFORM_NEW_REQUIRES_FOUR_AXES',
      'transform new 首轮要求完整提交 thing、situation、slot、strut 四轴',
      { missing }
    );
  }
  const thing = byBase.get('thing')[0].value;
  const situation = byBase.get('situation')[0].value;
  const slot = byBase.get('slot')[0].value;
  const strut = byBase.get('strut')[0].value;
  if (typeof thing !== 'string' || !thing.trim()) {
    return diagnostic('INVALID_ATOM_NAME', 'Atom thing 必须是非空字符串');
  }
  if (typeof situation !== 'string') {
    return diagnostic('INVALID_ATOM_DETAIL', 'Atom situation 必须是字符串');
  }
  if (!Array.isArray(slot) || !Array.isArray(strut)) {
    return diagnostic(
      'INVALID_ATOM_GRAPH_AXES',
      'Atom slot 与 strut 必须是数组'
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
  programScheduler,
  declarationRelocations = [],
  simultaneousRelocations = false
}) {
  if (JSON.stringify(programDeclarationSurface(beforeAtoms))
    === JSON.stringify(programDeclarationSurface(afterAtoms))) {
    return { ok: true, errors: [] };
  }
  if (declarationRelocations.length > 0
    && JSON.stringify(relocatedProgramDeclarationSurface(beforeAtoms, declarationRelocations, simultaneousRelocations))
      === JSON.stringify(relocatedProgramDeclarationSurface(afterAtoms))) {
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
    const slot = oneStoredField(nextParent, 'slot');
    if (depth === lineage.length - 1) {
      nextParent[slot.rawKey] = [...slot.value, structuredClone(atom)];
    } else {
      nextParent[slot.rawKey] = appendAt(slot.value, depth + 1);
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
      const children = oneStoredField(atom, 'slot')?.value;
      if (Array.isArray(children)) visit(children);
    }
  }
  visit(next);
  return { atoms: next, removed };
}

function isCompletePersistentAtomItem(item) {
  const required = new Set(['thing', 'situation', 'slot', 'strut']);
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
      '公开 Transform 不能创建退役 Agent Key；请使用含字面量 agent({...}) 声明的 Program'
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
      parentMatches[0], 'write', 'slot', { slotMaterialCreate: true, createdAtom: atom }
    );
    if (parentDecision.decision !== 'allow') {
      const programDenied = parentDecision.matched
        ? programLockDeniedDiagnostic(parentDecision, 'slot')
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
  postCommitEvent = null,
  subsequentOf = null,
  compatibilityManifest,
  localizedSituationValidation = false,
  structurePreservingValidation = false
}) {
  if (!localizedSituationValidation && !structurePreservingValidation) {
    // Structural, strut, type and Program changes retain the complete projection gate.
    const validationStartedAt = performance.now();
    projectAtomContext(atoms, { rootName, allowLegacyStrut: Boolean(compatibilityManifest) });
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
    ...(postCommitEvent ? { postCommitEvent } : {}),
    ...(subsequentOf ? { subsequentOf } : {}),
    ...(Array.isArray(changedPaths) && changedPaths.length ? { changedPaths } : {}),
    ...(Array.isArray(affectedAtoms) ? { affectedAtoms } : {}),
    ...(transformLogRecord ? { transformLogRecord } : {})
  });
  performanceTrace('world-commit', {
    elapsedMs: Math.round(performance.now() - commitStartedAt)
  });
  return receipt;
}

async function notifyCommittedSafely(options, result) {
  try {
    await options.onCommitted(structuredClone(result));
    return [];
  } catch (error) {
    return [diagnostic('ATOM_COMMITTED_NOTIFICATION_FAILED',
      '来源事实已提交，但回执通知失败；可用原交互标识重读结果',
      { cause: error.code ?? error.message, correlationId: result.interactionId })];
  }
}

function recoveredProgramResult(execution, atoms, { contextFile, projectionFile }, outcome, extras = {}) {
  const { event, sourceReceipt } = execution;
  const resultAt = selector => {
    const match = exactMatchAtPath(atoms, selector);
    return match ? describeAtom(match, false) : null;
  };
  return { ok: true, language: 'atom', command: 'transform', changed: true,
    createNew: event.createNew === true, ...(event.batch ? { batch: true } : {}), contextFile, projectionFile,
    revisionBefore: sourceReceipt.beforeRevision.replace(/^sha256:/u, ''),
    revisionAfter: outcome.revisionAfter,
    ...(event.batch ? { results: event.resultPaths.map((selector, index) => ({ index, changed: true, result: resultAt(selector) })) }
      : { result: resultAt(event.resultPaths[0]) }),
    ...(event.archive ? { archive: event.archive } : {}),
    warnings: outcome.status === 'failed' ? [diagnostic('ATOM_SUBSEQUENT_EXECUTION_FAILED',
      '来源事实已提交，但后续 Program 执行失败', { cause: outcome.errors?.[0]?.code })]
      : outcome.status === 'pending' ? [diagnostic('ATOM_SUBSEQUENT_EXECUTION_PENDING',
        '来源事实已提交；后续 Program 运行待恢复', { correlationId: `${sourceReceipt.correlationId}:subsequent` })] : [],
    errors: [], messages: [], interactionId: sourceReceipt.correlationId,
    affectedPaths: [...new Set([...(sourceReceipt.affectedAtoms ?? []), ...(execution.childReceipt?.affectedAtoms ?? [])]
      .map(({ path }) => path))], lockState: [], ...extras, subsequentExecution: outcome };
}

export async function executeAtomLanguage(options = {}) {
  const postcommit = typeof options.onCommitted === 'function' ? [] : null;
  const result = await executeAtomLanguageInteraction(options, postcommit);
  if (postcommit?.length && postcommit.sourceNotified !== true
    && result?.ok === true && result.changed === true) {
    postcommit.sourceNotified = true;
    result.warnings = mergeWarnings([...(result.warnings ?? []), ...await notifyCommittedSafely(options, result)]);
  }
  for (const finish of postcommit ?? []) {
    const warnings = await finish();
    result.warnings = mergeWarnings([...(result.warnings ?? []), ...warnings]);
  }
  return result;
}

async function executeAtomLanguageInteraction(options, postcommit) {
  const pendingStrutDeliveryClaims = new Set();
  const pendingSlotSignalClaims = new Set();
  function rememberStrutDeliveryClaims(keys = []) {
    for (const key of keys) if (key) pendingStrutDeliveryClaims.add(key);
  }
  function rememberSlotSignalClaims(keys = []) {
    for (const key of keys) if (key) pendingSlotSignalClaims.add(key);
  }
  function confirmStrutDeliveryClaims() {
    options.programScheduler?.confirmStrutDeliveries?.([...pendingStrutDeliveryClaims]);
    options.programScheduler?.confirmSlotSignals?.([...pendingSlotSignalClaims]);
    pendingStrutDeliveryClaims.clear();
    pendingSlotSignalClaims.clear();
  }
  function releaseStrutDeliveryClaims() {
    options.programScheduler?.releaseStrutDeliveries?.([...pendingStrutDeliveryClaims]);
    options.programScheduler?.releaseSlotSignals?.([...pendingSlotSignalClaims]);
    pendingStrutDeliveryClaims.clear();
    pendingSlotSignalClaims.clear();
  }
  function failureBase(...args) {
    releaseStrutDeliveryClaims();
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
  if (options.programExecution?.outcome && options.programExecution.outcome.status !== 'pending') {
    return recoveredProgramResult(options.programExecution, atoms, { contextFile, projectionFile }, options.programExecution.outcome);
  }
  if (options.programExecution?.event.enabled && !options.programScheduler) {
    return recoveredProgramResult(options.programExecution, atoms, { contextFile, projectionFile }, {
      status: 'pending', sourceRevision: options.programExecution.sourceReceipt.afterRevision.replace(/^sha256:/u, ''),
      revisionAfter: revisionBefore, errors: []
    });
  }
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
        '批量改名必须由纯 thing.ren 项组成；请将移动、situation 与 strut 放入另一批事务'
      )]);
    }
    const unsupported = parsed.items.flatMap((item) => item.fields
      .filter((field) => (
        !['thing', 'situation', 'strut'].includes(field.baseKey)
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
          '批量 transform 当前支持已有 Atom 的纯批量改名、移动、situation 与 strut 改造',
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
  let candidateProgramScheduler = null;
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
      const passivePrograms = options.programMode === 'passive' || Boolean(options.programExecution);
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
          programRoot: executionContext.programRoot ?? null,
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
          slotSignals: [],
          jumps: [],
          jumpAuthorizations: [],
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
      releaseStrutDeliveryClaims();
      return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
        error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
      )]);
    }
  }
  candidateProgramScheduler = options.programScheduler
    ? (typeof options.programScheduler.createCandidateRuntime === 'function'
      ? options.programScheduler.createCandidateRuntime()
      : typeof options.programScheduler.deriveAgentSecurity !== 'function'
        ? options.programScheduler
        : null)
    : null;
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
  const missingStrutDelivery = (programCycle.failures ?? []).find((failure) => (
    failure.code === 'STRUT_DELIVERY_REQUIRED'
  ));
  if (missingStrutDelivery && options.programMode !== 'project') {
    return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
      missingStrutDelivery.code,
      missingStrutDelivery.message ?? 'strut subscriber requires one typed true delivery',
      { ...(missingStrutDelivery.details ?? {}), program: missingStrutDelivery.programPath }
    )]);
  }
  const missingSlotSignal = (programCycle.failures ?? []).find((failure) => (
    failure.code === 'SLOT_SIGNAL_REQUIRED'
  ));
  if (missingSlotSignal && options.programMode !== 'project') {
    return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
      missingSlotSignal.code,
      missingSlotSignal.message ?? 'signal() requires one active Slot signal invocation',
      { ...(missingSlotSignal.details ?? {}), program: missingSlotSignal.programPath }
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
  const initialProgramTransformTriggerNodes = [];
  const initialProgramRelocations = [];
  const initialAgentPath = interaction.agent?.path ?? null;
  let accessController = createAccessController(atoms, {
    ...options, programLockIndex, agentPath: initialAgentPath,
    agentSecurity: programCycle.agentSecurity,
    graphLocks,
    ...(atoms === preparedTransformAtoms
      ? { preparedAccessMatches: preparedTransformWorld.matches }
      : {})
  });
  const accessControllerForProgramEffect = (sourceProgramPath, sourceScopeRoot = null) => {
    const sourceAgentSecurity = candidateProgramScheduler?.agentSecurity?.get(sourceProgramPath)
      ?? options.programScheduler?.agentSecurity?.get(sourceProgramPath)
      ?? null;
    if (!sourceAgentSecurity) return accessController;
    return createAccessController(atoms, {
      ...options,
      programLockIndex,
      agentPath: sourceScopeRoot ?? sourceProgramPath,
      agentSecurity: structuredClone(sourceAgentSecurity),
      graphLocks
    });
  };
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
      || (await accessController.authorize(source, 'write', 'slot', {
        programPath: effect.issuerProgramPath
      })).decision !== 'allow'
      || (await accessController.authorize(destination, 'read', 'thing', {
        programPath: effect.issuerProgramPath
      })).decision !== 'allow'
      || (await accessController.authorize(destination, 'write', 'slot', {
        programPath: effect.issuerProgramPath,
        slotMaterialMove: true,
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
        releaseStrutDeliveryClaims();
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
          issuerController.authorize(destination, 'write', 'slot', {
            programPath: payload.issuerProgramPath,
            slotMaterialMove: true,
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
      if (agentPath !== moved.resultPath) {
        initialProgramRelocations.push({ sourcePath: agentPath, resultPath: moved.resultPath });
      }
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
          actual, 'write', 'slot', {
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
        ? oneStoredField(selected.parent.atom, 'slot')?.value
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
      sourceProgramRoot = null,
      ...rawTransformRequest
    } = request;
    let transformRequest;
    try {
      transformRequest = normalizeScopedTransformRequest({
        atoms,
        request: rawTransformRequest,
        scopeRoot: sourceScopeRoot,
        programRoot: sourceProgramRoot
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
    const effectAccessController = accessControllerForProgramEffect(sourceProgramPath, sourceScopeRoot);
    const authorizeProgramEffect = (match, operation, field, actor = {}) => {
      const targetPath = match.path.join('/');
      return effectAccessController.authorize(match, operation, field, {
        ...actor,
        programPath: sourceProgramPath,
        slotReseal: actor.slotReseal === true || programResealsModelPath(
          atoms, programCycle.slotBodies, sourceProgramPath, targetPath
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
            programScheduler: candidateProgramScheduler
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
        allowLegacyStrut: Boolean(options.compatibilityManifest)
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
      const relocation = transformRelocation(transformed);
      if (relocation) initialProgramRelocations.push(relocation);
      initialProgramTriggerNodes.push(
        transformed.sourcePath,
        transformed.resultPath,
        transformed.resultName
      );
      initialProgramTransformTriggerNodes.push(
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
          match, 'write', 'slot', {
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
        allowLegacyStrut: Boolean(options.compatibilityManifest)
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

  let requestDeclarationRelocations = [];

  async function validateRequestCandidate(
    candidateAtoms, declarationRelocations = requestDeclarationRelocations
  ) {
    return validateAgentProgramDelegation({
      beforeAtoms: requestStartAtoms,
      afterAtoms: candidateAtoms,
      creatorSecurity,
      programScheduler: candidateProgramScheduler,
      declarationRelocations,
      simultaneousRelocations: parsed.batch && parsed.items.every(isBatchRenameItem)
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

  async function assertRequestCandidateAuthority(
    candidateAtoms, declarationRelocations = requestDeclarationRelocations
  ) {
    const delegated = await validateRequestCandidate(candidateAtoms, declarationRelocations);
    if (!delegated.ok) throwCandidateDelegationFailure(delegated.errors);
  }

  async function reconcileProgramsForWorld(
    candidateAtoms, initialTriggerEvent = null, failOnProgramFailure = false,
    declarationRelocations = requestDeclarationRelocations
  ) {
    if (!options.programScheduler) {
      return {
        atoms: candidateAtoms,
        lockIndex: programLockIndex,
        messages: [],
        transformLogs: [],
        pathChanges: [],
        changedPaths: []
      };
    }
    if (!candidateProgramScheduler) {
      throw Object.assign(new Error('Candidate Program evaluation requires an isolated runtime'), {
        code: 'PROGRAM_CANDIDATE_RUNTIME_UNAVAILABLE'
      });
    }
    await assertRequestCandidateAuthority(candidateAtoms, declarationRelocations);
    const runtimeScheduler = candidateProgramScheduler;
    let reconciledAtoms = candidateAtoms;
    const messages = [];
    const transformLogs = [];
    const pathChanges = [];
    const programChangedPaths = new Set();
    let finalLockIndex = programLockIndex;
    let finalGraphLocks = graphLocks;
    const pendingTriggerEvents = Array.isArray(initialTriggerEvent)
      ? [...initialTriggerEvent]
      : initialTriggerEvent ? [initialTriggerEvent] : [];
    const pendingAuthorizedTriggers = new Map();
    const maxPasses = 8;

    async function applyTriggeredJumpAuthorizations(baseAtoms, effects, relocations) {
      if ((effects?.length ?? 0) === 0) {
        return { atoms: baseAtoms, changed: false, triggerPaths: [], triggerContexts: [], logs: [] };
      }
      const normalized = effects.map((effect) => ({
        windowPath: rewritePath(effect.windowPath, relocations),
        sourcePath: rewritePath(effect.sourcePath, relocations),
        destinationPath: rewritePath(effect.destinationPath, relocations),
        issuerProgramPath: rewritePath(effect.issuerProgramPath, relocations)
      }));
      const destinationsBySource = new Map();
      for (const effect of normalized) {
        const signature = JSON.stringify({
          windowPath: effect.windowPath,
          destinationPath: effect.destinationPath,
          issuerProgramPath: effect.issuerProgramPath
        });
        const signatures = destinationsBySource.get(effect.sourcePath) ?? new Set();
        signatures.add(signature);
        destinationsBySource.set(effect.sourcePath, signatures);
      }
      if ([...destinationsBySource.values()].some((signatures) => signatures.size > 1)) {
        return { error: diagnostic(
          'WINDOW_JUMP_AUTHORIZATION_CONFLICT',
          '同一 jump source 不能在一个触发周期签发多个不同迁窗目标'
        ) };
      }

      let nextAtoms = baseAtoms;
      const triggerPaths = [];
      const triggerContexts = [];
      const logs = [];
      for (const effect of normalized.filter((entry, index, entries) => (
        entries.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(entry)) === index
      ))) {
        const issuerAgentPath = owningAgentPath(runtimeScheduler.agentSecurity, effect.issuerProgramPath);
        const issuerSecurity = issuerAgentPath
          ? runtimeScheduler.agentSecurity.get(issuerAgentPath) ?? null
          : null;
        const matches = new Map(walkAtoms(nextAtoms).map((match) => [match.path.join('/'), match]));
        const source = matches.get(effect.sourcePath);
        const window = matches.get(effect.windowPath);
        const destination = matches.get(effect.destinationPath);
        const issuerProgram = matches.get(effect.issuerProgramPath);
        if (!issuerAgentPath || !issuerSecurity || !source || !window || !destination
          || !issuerProgram || !issuerSecurity.functions?.includes('jump_authorize')) {
          return { error: diagnostic(
            'WINDOW_JUMP_AUTHORIZATION_DENIED',
            '触发签发方无权控制当前窗口与迁移目的地'
          ) };
        }
        const issuerController = createAccessController(nextAtoms, {
          ...options,
          programLockIndex: finalLockIndex,
          agentPath: issuerAgentPath,
          agentSecurity: structuredClone(issuerSecurity),
          graphLocks: finalGraphLocks
        });
        const authorizationChecks = [
          ['issuer-program-read', issuerController.authorize(issuerProgram, 'read', 'thing', {
            programPath: effect.issuerProgramPath
          })],
          ['window-move', issuerController.authorize(window, 'write', 'thing', {
            programPath: effect.issuerProgramPath,
            windowLifecycle: { action: 'move', destinationPath: effect.destinationPath }
          })],
          ['authorization-source-write', issuerController.authorize(source, 'write', 'slot', {
            programPath: effect.issuerProgramPath
          })],
          ['destination-read', issuerController.authorize(destination, 'read', 'thing', {
            programPath: effect.issuerProgramPath
          })],
          ['destination-receive-window', issuerController.authorize(destination, 'write', 'slot', {
            programPath: effect.issuerProgramPath,
            slotMaterialMove: true,
            windowLifecycle: { action: 'move', destinationPath: effect.destinationPath }
          })]
        ];
        const decisions = await Promise.all(authorizationChecks.map(([, pending]) => pending));
        if (decisions.some((decision) => decision.decision !== 'allow')) {
          return { error: diagnostic(
            'WINDOW_JUMP_AUTHORIZATION_DENIED',
            '触发签发方当前无权控制窗口或迁移目的地',
            { deniedChecks: authorizationChecks
              .map(([name], index) => ({ name, decision: decisions[index] }))
              .filter((entry) => entry.decision.decision !== 'allow') }
          ) };
        }
        const recordsByPath = graphRecordsByPath(nextAtoms);
        const existing = [...matches.values()].filter((match) => (
          match.parent?.atom === source.atom
          && oneStoredField(match.atom, 'thing')?.parsed.types.some((type) => (
            type.raw === WINDOW_JUMP_AUTHORIZATION_TYPE
          ))
        ));
        if (existing.length > 0) {
          const existingRecord = existing.length === 1
            ? recordsByPath.get(existing[0].path.join('/')) : null;
          const payload = parseWindowJumpAuthorization(existingRecord);
          if (!payload || payload.windowPath !== effect.windowPath
            || payload.sourcePath !== effect.sourcePath
            || payload.destinationPath !== effect.destinationPath
            || payload.issuerAgentPath !== issuerAgentPath
            || payload.issuerProgramPath !== effect.issuerProgramPath) {
            return { error: diagnostic(
              'WINDOW_JUMP_AUTHORIZATION_CONFLICT',
              '同一 jump source 已存在另一项未消费迁窗授权'
            ) };
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
            return { error: diagnostic(
              error.code ?? 'WINDOW_JUMP_AUTHORIZATION_INVALID', error.message
            ) };
          }
          triggerPaths.push(effect.sourcePath);
          triggerContexts.push({
            sourcePath: effect.sourcePath,
            windowPath: effect.windowPath
          });
          continue;
        }
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
          return { error: diagnostic(
            error.code ?? 'WINDOW_JUMP_AUTHORIZATION_INVALID', error.message
          ) };
        }
        const before = revisionOf(nextAtoms);
        nextAtoms = appendNestedAtom(nextAtoms, source, authorization.atom);
        triggerPaths.push(effect.sourcePath);
        triggerContexts.push({
          sourcePath: effect.sourcePath,
          windowPath: effect.windowPath
        });
        logs.push({
          id: operationId,
          operation: 'window-jump-authorize',
          source: { ...effect },
          revisionBefore: before,
          revisionAfter: revisionOf(nextAtoms)
        });
      }
      return {
        atoms: nextAtoms,
        changed: revisionOf(nextAtoms) !== revisionOf(baseAtoms),
        triggerPaths,
        triggerContexts,
        logs
      };
    }

    async function applyTriggeredJump(baseAtoms, effects) {
      const moves = (effects ?? []).filter((effect) => effect.action !== 'guard');
      if (moves.length === 0) {
        return { atoms: baseAtoms, changed: false, triggerPaths: [], relocations: [], logs: [] };
      }
      if (moves.length > 1) {
        return { error: diagnostic(
          'WINDOW_JUMP_CONFLICT',
          '一个触发周期只能迁移或回收一个执行 Agent 窗口'
        ) };
      }
      const [jump] = moves;
      const agentPath = owningAgentPath(runtimeScheduler.agentSecurity, jump.sourceProgramPath);
      if (!agentPath) {
        return { error: diagnostic(
          'WINDOW_JUMP_AGENT_REQUIRED',
          '触发迁窗的注册 Program 不属于任何已声明执行 Agent'
        ) };
      }
      if (jump.action !== 'move' || !jump.authorizationPath) {
        return { error: diagnostic(
          'WINDOW_JUMP_AUTHORIZATION_REQUIRED',
          '自动迁窗只接受由上级签发的一次性受控迁窗授权'
        ) };
      }
      const recordsByPath = graphRecordsByPath(baseAtoms);
      const authorizationRecord = recordsByPath.get(jump.authorizationPath);
      const payload = parseWindowJumpAuthorization(authorizationRecord);
      if (!payload || payload.windowPath !== agentPath
        || payload.sourcePath !== jump.sourceProgramPath) {
        return { error: diagnostic(
          'WINDOW_JUMP_AUTHORIZATION_INVALID',
          '触发迁窗授权与执行 Agent 或注册 Program 不匹配'
        ) };
      }
      const issuerSecurity = runtimeScheduler.agentSecurity.get(payload.issuerAgentPath) ?? null;
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
        return { error: diagnostic(
          error.code ?? 'WINDOW_JUMP_AUTHORIZATION_INVALID', error.message
        ) };
      }
      const matches = new Map(walkAtoms(baseAtoms).map((match) => [match.path.join('/'), match]));
      const source = matches.get(jump.sourceProgramPath);
      const window = matches.get(agentPath);
      const destination = matches.get(payload.destinationPath);
      if (!source || !window || !destination || !issuerSecurity) {
        return { error: diagnostic(
          'WINDOW_JUMP_AUTHORIZATION_INVALID',
          '触发迁窗授权绑定的 Graph 节点已失效'
        ) };
      }
      const issuerController = createAccessController(baseAtoms, {
        ...options,
        programLockIndex: finalLockIndex,
        agentPath: payload.issuerAgentPath,
        agentSecurity: structuredClone(issuerSecurity),
        graphLocks: finalGraphLocks
      });
      const decisions = await Promise.all([
        issuerController.authorize(source, 'read', 'thing', {
          programPath: payload.issuerProgramPath
        }),
        issuerController.authorize(window, 'write', 'thing', {
          programPath: payload.issuerProgramPath,
          windowLifecycle: { action: 'move', destinationPath: payload.destinationPath }
        }),
        issuerController.authorize(destination, 'read', 'thing', {
          programPath: payload.issuerProgramPath
        }),
        issuerController.authorize(destination, 'write', 'slot', {
          programPath: payload.issuerProgramPath,
          slotMaterialMove: true,
          windowLifecycle: { action: 'move', destinationPath: payload.destinationPath }
        })
      ]);
      if (decisions.some((decision) => decision.decision !== 'allow')) {
        return { error: diagnostic(
          'WINDOW_JUMP_AUTHORIZATION_DENIED',
          '签发方当前已无权控制执行 Agent 或迁移目的地'
        ) };
      }
      const compiled = compileProgramTransform({
        request: { [`thing.mov.${payload.destinationPath}`]: agentPath }, receiver
      });
      if (!compiled.ok) {
        return { error: diagnostic(
          'WINDOW_JUMP_DESTINATION_INVALID',
          compiled.errors?.[0]?.message ?? '触发迁窗目标无法编译'
        ) };
      }
      const moved = await applyTransform({
        atoms: baseAtoms,
        item: compiled.item,
        contextFile,
        authorize: (match, operation, field, actor = {}) => issuerController.authorize(
          match, operation, field, {
            ...actor,
            programPath: jump.sourceProgramPath,
            windowJumpAuthorization: true,
            windowLifecycle: { action: 'move', destinationPath: payload.destinationPath }
          }
        )
      });
      if (moved.error) {
        return { error: diagnostic(
          moved.error.code === 'WINDOW_ACCESS_DENIED'
            ? 'WINDOW_JUMP_LOCK_DENIED' : 'WINDOW_JUMP_DESTINATION_INVALID',
          moved.error.message,
          { cause: moved.error.code }
        ) };
      }
      const consumed = removeWindowJumpAuthorization(moved.atoms, payload.operationId);
      if (!consumed.removed) {
        return { error: diagnostic(
          'WINDOW_JUMP_AUTHORIZATION_INVALID',
          '触发迁窗授权无法在候选事务中精确消费'
        ) };
      }
      return {
        atoms: consumed.atoms,
        changed: true,
        triggerPaths: [moved.resultPath, payload.destinationPath],
        relocations: [{ sourcePath: agentPath, resultPath: moved.resultPath }],
        logs: [{
          id: payload.operationId,
          operation: 'window-jump-authorized-move',
          source: {
            windowPath: agentPath,
            sourcePath: jump.sourceProgramPath,
            destinationPath: payload.destinationPath,
            issuerProgramPath: payload.issuerProgramPath
          }
        }]
      };
    }

    for (let pass = 1; pass <= maxPasses; pass += 1) {
      const pendingTriggerEvent = pendingTriggerEvents.shift() ?? null;
      const authorizedPaths = [...new Set((pendingTriggerEvent?.nodes ?? [])
        .map((node) => pendingAuthorizedTriggers.get(node))
        .filter(Boolean))];
      const authorizedAgentPath = authorizedPaths.length === 1
        ? authorizedPaths[0] : null;
      for (const node of pendingTriggerEvent?.nodes ?? []) {
        pendingAuthorizedTriggers.delete(node);
      }
      const cycleAgentPath = authorizedAgentPath ?? interaction.agent?.path ?? null;
      const cycleAgentOrigin = authorizedAgentPath
        ? { path: authorizedAgentPath }
        : interaction.agent;
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
          agentOrigin: cycleAgentOrigin,
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
            agentOrigin: cycleAgentOrigin,
            scopeRoot: executionContext.scopeRoot ?? null,
            programRoot: executionContext.programRoot ?? null,
            preparedWorld: preparedWorld ??= prepareExploreWorld(reconciledAtoms)
          })
        });
      } catch (error) {
        await recordTransformStage('reconcile', refreshStartedAt, { outcome: 'failure' });
        throw error;
      }
      rememberStrutDeliveryClaims(cycle.strutDeliveryClaims);
      rememberSlotSignalClaims(cycle.slotSignalClaims);
      await recordTransformStage('reconcile', refreshStartedAt, {
        ...(cycle.reconcileSummary ?? {})
      });
      const blockingFailure = (cycle.failures ?? []).find((failure) => (
        failure.blocking === true || failure.code === 'SLOT_SIGNAL_REQUIRED'
      ));
      if (((failOnProgramFailure || pendingTriggerEvent)
        && (cycle.failures?.length ?? 0) > 0) || blockingFailure) {
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
        jumps: cycle.jumps?.length ?? 0,
        jumpAuthorizations: cycle.jumpAuthorizations?.length ?? 0,
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
        && (cycle.slotSignals?.length ?? 0) === 0
        && (cycle.jumps?.length ?? 0) === 0
        && (cycle.jumpAuthorizations?.length ?? 0) === 0
        && (cycle.agentRegistrations?.length ?? 0) === 0;
      if (pendingTriggerEvent && cycle.reconcileSummary?.preparedIndexHit === true
        && noProgramEffects && pendingTriggerEvents.length === 0) {
        return {
          atoms: reconciledAtoms,
          lockIndex: finalLockIndex,
          messages,
          transformLogs,
          pathChanges,
          changedPaths: [...programChangedPaths]
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
      const slotSignalClaimsByProgram = new Map();
      for (const claim of cycle.slotSignalClaims ?? []) {
        const programPath = claim.split('\0', 1)[0];
        if (programPath && !slotSignalClaimsByProgram.has(programPath)) {
          slotSignalClaimsByProgram.set(programPath, claim);
        }
      }
      for (const request of cycle.transforms ?? []) {
        const {
          sourceProgramRef: _sourceProgramRef,
          sourceProgramPath,
          sourceScopeRoot = null,
          sourceProgramRoot = null,
          sourceStrutDeliveryClaim = null,
          ...rawTransformRequest
        } = request;
        const sourceSlotSignalClaim = slotSignalClaimsByProgram.get(sourceProgramPath) ?? null;
        let transformRequest;
        try {
          transformRequest = normalizeScopedTransformRequest({
            atoms: reconciledAtoms,
            request: rawTransformRequest,
            scopeRoot: sourceScopeRoot,
            programRoot: sourceProgramRoot
          });
        } catch (error) {
          if (sourceStrutDeliveryClaim || sourceSlotSignalClaim
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
          if (sourceStrutDeliveryClaim || sourceSlotSignalClaim
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
          sourceScopeRoot,
          sourceProgramRoot,
          sourceStrutDeliveryClaim,
          sourceSlotSignalClaim,
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
      if (compiledRequests.length === 0
        && (cycle.shortcuts?.length ?? 0) === 0
        && (cycle.slotBodies?.length ?? 0) === 0
        && (cycle.slotSignals?.length ?? 0) === 0
        && (cycle.jumpAuthorizations?.length ?? 0) === 0
        && (cycle.jumps?.filter((jump) => jump.action !== 'guard').length ?? 0) === 0
        && pendingTriggerEvents.length === 0) {
        return {
          atoms: reconciledAtoms,
          lockIndex: finalLockIndex,
          messages,
          transformLogs,
          pathChanges,
          changedPaths: [...programChangedPaths]
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
          const sourceAgentSecurity = runtimeScheduler.agentSecurity?.get(entry.sourceProgramPath)
            ?? null;
          const effectAccessController = sourceAgentSecurity
            ? createAccessController(candidateAtoms, {
                ...options,
                programLockIndex: finalLockIndex,
                agentPath: entry.sourceScopeRoot ?? entry.sourceProgramPath,
                agentSecurity: structuredClone(sourceAgentSecurity),
                graphLocks: finalGraphLocks
              })
            : cycleAccessController;
          const authorizeProgramEffect = (match, operation, field, actor = {}) => {
            const targetPath = match.path.join('/');
            return effectAccessController.authorize(
              match, operation, field, {
                ...actor,
                programPath: entry.sourceProgramPath,
                slotReseal: actor.slotReseal === true || programResealsModelPath(
                  candidateAtoms, cycle.slotBodies, entry.sourceProgramPath, targetPath
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
            if (entry.sourceStrutDeliveryClaim || entry.sourceSlotSignalClaim
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
              if (pendingTriggerEvent) {
                interactionWarnings.push(diagnostic(
                  error.code ?? 'PROGRAM_TRANSFORM_FAILED',
                  error.message,
                  { program: entry.sourceProgramPath, ...(error.details ?? {}) }
                ));
                return {
                  failed: true,
                  fatal: {
                    code: error.code ?? 'PROGRAM_TRANSFORM_FAILED',
                    message: error.message,
                    program: entry.sourceProgramPath,
                    details: error.details ?? {}
                  }
                };
              }
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
            if (entry.sourceStrutDeliveryClaim || entry.sourceSlotSignalClaim
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
              if (pendingTriggerEvent) {
                interactionWarnings.push(diagnostic(
                  'PROGRAM_TRANSFORM_REJECTED', transformed.error.message,
                  { program: entry.sourceProgramPath, cause: transformed.error.code }
                ));
                return {
                  failed: true,
                  fatal: {
                    code: 'PROGRAM_TRANSFORM_REJECTED',
                    message: transformed.error.message,
                    program: entry.sourceProgramPath,
                    details: {
                      cause: transformed.error.code,
                      ...(transformed.error.details ?? {})
                    }
                  }
                };
              }
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
          details: { program: application.fatal.program, ...(application.fatal.details ?? {}) }
        });
      }
      if (!application.failed) {
        try {
          projectAtomContext(application.atoms, {
            rootName: path.basename(contextFile),
            allowLegacyStrut: Boolean(options.compatibilityManifest)
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
          details: { program: application.fatal.program, ...(application.fatal.details ?? {}) }
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
              match, 'write', 'slot', {
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
      const applicationRelocations = (application.applied ?? []).flatMap(({ transformed }) => {
        const relocation = transformRelocation(transformed);
        return relocation ? [relocation] : [];
      });
      const authorization = await applyTriggeredJumpAuthorizations(
        application.atoms,
        cycle.jumpAuthorizations,
        [...pathChanges, ...applicationRelocations]
      );
      if (authorization.error) {
        if ((cycle.slotSignalClaims?.length ?? 0) > 0) {
          throw Object.assign(new Error(authorization.error.message), {
            code: authorization.error.code,
            details: authorization.error.details ?? {}
          });
        }
        interactionWarnings.push(authorization.error);
      } else {
        application.atoms = authorization.atoms;
        for (const context of authorization.triggerContexts ?? []) {
          pendingAuthorizedTriggers.set(context.sourcePath, context.windowPath);
        }
      }
      const jump = await applyTriggeredJump(application.atoms, cycle.jumps);
      if (jump.error) {
        if ((cycle.slotSignalClaims?.length ?? 0) > 0) {
          throw Object.assign(new Error(jump.error.message), {
            code: jump.error.code,
            details: jump.error.details ?? {}
          });
        }
        interactionWarnings.push(jump.error);
      } else {
        application.atoms = jump.atoms;
      }
      const cycleRelocations = [
        ...applicationRelocations,
        ...(jump.relocations ?? [])
      ];
      const rewrittenSlotRecipients = rewritePendingSlotTriggerEvents(
        pendingTriggerEvents, cycleRelocations
      );
      if (rewrittenSlotRecipients.length) {
        if (typeof runtimeScheduler.refreshPreparedTriggerOwnership !== 'function') {
          throw Object.assign(new Error('Candidate runtime cannot refresh trigger ownership'), {
            code: 'PROGRAM_TRIGGER_OWNERSHIP_REFRESH_UNAVAILABLE'
          });
        }
        await runtimeScheduler.refreshPreparedTriggerOwnership(
          application.atoms, cycleRelocations
        );
      }
      const relocatedSlotSignals = (cycle.slotSignals ?? []).map((effect) => ({
        ...rewriteSlotSignalPaths(effect, [...pathChanges, ...cycleRelocations])
      }));
      const deliveries = resolveSlotSignalDeliveries(
        application.atoms,
        relocatedSlotSignals,
        {
          revision: revisionOf(application.atoms),
          createId: () => crypto.randomUUID()
        }
      );
      const slotTriggerEvent = deliveries.length
        ? {
          mode: 'slot',
          nodes: [...new Set(deliveries.map(({ recipientPath }) => recipientPath))],
          signals: deliveries
        }
        : null;
      const after = revisionOf(application.atoms);
      performanceTrace('program-reconcile-apply', {
        pass,
        elapsedMs: Math.round(performance.now() - applyStartedAt),
        applied: application.applied?.length ?? 0,
        changed: before !== after
      });
      if (before !== after) {
        await assertRequestCandidateAuthority(application.atoms, [
          ...declarationRelocations,
          ...pathChanges,
          ...cycleRelocations
        ]);
        reconciledAtoms = application.atoms;
        passChanged = true;
        for (const entry of appliedShortcuts) {
          if (entry.shortcut.resultPath) programChangedPaths.add(entry.shortcut.resultPath);
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
          const relocation = transformRelocation(transformed);
          if (relocation) pathChanges.push(relocation);
          if (transformed.changed !== true) continue;
          for (const changedPath of [
            transformed.sourcePath,
            transformed.resultPath,
            ...(transformed.relationPaths ?? []),
            ...(transformed.shortcutPaths ?? [])
          ]) {
            if (changedPath) programChangedPaths.add(changedPath);
          }
          transformLogs.push({
            id: crypto.randomUUID(),
            operation: 'program-transform',
            source: transformRequest,
            revisionBefore: before,
            revisionAfter: after
          });
        }
        transformLogs.push(
          ...(authorization.logs ?? []),
          ...(jump.logs ?? [])
        );
        for (const relocation of jump.relocations ?? []) {
          pathChanges.push(relocation);
        }
        for (const entry of appliedSlotBodies) {
          for (const changedPath of [
            entry.receipt?.body,
            entry.receipt?.target,
            ...(entry.receipt?.recompute_targets ?? [])
          ]) {
            if (changedPath) programChangedPaths.add(changedPath);
          }
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
        ]))).concat(
          authorization.triggerPaths ?? [],
          jump.triggerPaths ?? []
        ).filter(Boolean))];
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
        if (triggeredNodes.length) {
          pendingTriggerEvents.push({ mode: 'transform', nodes: triggeredNodes, affectedPaths });
        }
      }
      if (!passChanged && (authorization.triggerPaths?.length ?? 0) > 0) {
        const triggerPaths = [...new Set(authorization.triggerPaths.filter(Boolean))];
        pendingTriggerEvents.push({
          mode: 'transform', nodes: triggerPaths, affectedPaths: triggerPaths
        });
        passChanged = true;
      }
      if (slotTriggerEvent) pendingTriggerEvents.push(slotTriggerEvent);
      if (!passChanged && pendingTriggerEvents.length === 0) {
        return {
          atoms: reconciledAtoms,
          lockIndex: finalLockIndex,
          messages,
          transformLogs,
          pathChanges,
          changedPaths: [...programChangedPaths]
        };
      }
    }
    const error = new Error(`Program consequences did not converge after ${maxPasses} passes`);
    error.code = 'ATOM_PROGRAM_RECONCILIATION_LIMIT';
    error.details = { passes: maxPasses };
    throw error;
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
        programRoot: executionContext.programRoot ?? null,
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

  let sourceCommandId = options.programExecution?.sourceReceipt?.commandId ?? null;
  let unchangedSourceEvent = null;
  function postCommitEvent(trigger, resultPaths, extra = {}) {
    return { ...structuredClone(trigger), resultPaths: resultPaths.filter(Boolean),
      interaction: { id: interaction.id, agent: interaction.agent?.path ? { path: interaction.agent.path } : null },
      binding: options.interactionBinding ?? JSON.stringify({ source, agent: interaction.agent?.path ?? null }),
      enabled: Boolean(options.programScheduler) && options.trustedMaintenance !== true,
      ...extra };
  }

  async function commitChangedGraph(candidateAtoms, {
    projectionRebase = null,
    changedPaths = projectionRebase?.changedPaths ?? null,
    affectedAtoms = null,
    transformLogRecord = null,
    localizedSituationValidation = false,
    structurePreservingValidation = false,
    preparedRuntimeRecordsPromise = null,
    expectedRevision = revisionBefore,
    correlationId = interaction.id,
    allowEmpty = false,
    subsequent = false,
    postCommitEvent: sourceEvent = null
  } = {}) {
    function rememberCommittedAffectedPaths(commitReceipt) {
      const affected = commitReceipt?.affectedAtoms ?? commitReceipt?.result?.affectedAtoms ?? [];
      committedAffectedPaths = [...new Set([
        ...committedAffectedPaths,
        ...affected.map(({ path }) => path).filter(Boolean)
      ])].sort();
    }
    const delegated = await validateRequestCandidate(candidateAtoms);
    if (!delegated.ok) {
      if (subsequent) {
        const first = delegated.errors[0] ?? diagnostic(
          'INVALID_AGENT_DELEGATION', 'Agent Program declaration change was rejected'
        );
        throw Object.assign(new Error(first.message), {
          code: first.code,
          details: first.details ?? {},
          diagnostics: delegated.errors
        });
      }
      return {
        authorizationFailure: failureBase(
          parsed, contextFile, projectionFile, requestStartAtoms, delegated.errors
        )
      };
    }
    if (subsequent && !sourceCommandId && unchangedSourceEvent) {
      sourceEvent = { ...unchangedSourceEvent, sourceChanged: false, effectsCommitted: true };
      correlationId = interaction.id;
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
        expectedRevision,
        correlationId,
        source,
        changedPaths,
        affectedAtoms: affectedAtoms ?? (Array.isArray(changedPaths) ? changedPaths.map((path) => ({
          path,
          axes: ['slot', 'situation', 'strut', 'thing']
        })) : null),
        transformLogRecord,
        postCommitEvent: sourceEvent,
        subsequentOf: subsequent ? sourceCommandId : null,
        compatibilityManifest: options.compatibilityManifest,
        localizedSituationValidation,
        structurePreservingValidation
      });
      rememberCommittedAffectedPaths(receipt);
      if (sourceEvent) sourceCommandId = receipt?.commandId ?? null;
    } catch (error) {
      if (allowEmpty && error?.code === 'EMPTY_WORLD_PATCH') {
        confirmStrutDeliveryClaims();
        return null;
      }
      if (subsequent && error?.details?.receipt?.afterRevision) {
        rememberCommittedAffectedPaths(error.details.receipt);
        confirmStrutDeliveryClaims();
        error.committedReceipt = error.details.receipt;
        throw error;
      }
      if (sourceEvent && error?.details?.receipt?.afterRevision) {
        receipt = error.details.receipt;
        sourceCommandId = receipt.commandId;
        rememberCommittedAffectedPaths(receipt);
        interactionWarnings.push(diagnostic(error.code ?? 'WORLD_COMMITTED_AUXILIARY_PENDING',
          error.message, { cause: error.details.cause, sourceCommandId }));
      } else {
        releaseStrutDeliveryClaims();
        await recordTransformStage('commit', commitStartedAt, {
          commitEntered: true,
          outcome: 'failure'
        });
        throw error;
      }
    }
    confirmStrutDeliveryClaims();
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
        ? [...new Set([...committedAffectedPaths, ...changedPaths.filter(Boolean)])].sort()
        : committedAffectedPaths;
    }
    if (derivedRecoveryPending) {
      await recordTransformStage('program-projection', performance.now(), {
        candidateProgramCount: 0,
        executedProgramCount: 0
      });
      return receipt;
    }
    async function finishProgramProjection() {
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
      return interactionWarnings;
    }
    if (postcommit) postcommit.push(finishProgramProjection);
    else await finishProgramProjection();
    return receipt;
  }

  async function notifySourceCommitted(result) {
    if (!postcommit || postcommit.sourceNotified === true) return;
    postcommit.sourceNotified = true;
    interactionWarnings.push(...await notifyCommittedSafely(options, result));
  }

  async function subsequentFailureDetails(error) {
    releaseStrutDeliveryClaims();
    const latestAtoms = await readAtomContext(contextFile, {
      compatibilityManifest: options.compatibilityManifest
    });
    const errors = Array.isArray(error?.diagnostics) && error.diagnostics.length > 0
      ? structuredClone(error.diagnostics)
      : [diagnostic(error?.code ?? 'ATOM_PROGRAM_FAILED', error?.message ?? String(error), {
          ...(error?.details ?? {})
        })];
    const revisionAfter = revisionOf(latestAtoms);
    const committed = Boolean(error?.committedReceipt?.afterRevision);
    return {
      latestAtoms,
      revisionAfter,
      status: committed ? 'completed' : 'failed',
      errors: committed ? [] : errors,
      warning: committed
        ? errors[0]
        : diagnostic(
            'ATOM_SUBSEQUENT_EXECUTION_FAILED',
            '来源事实已提交，但后续 Program 执行失败',
            { cause: errors[0].code }
          )
    };
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

  function rewriteSlotSignalPaths(signal, pathChanges) {
    const sourceKey = Object.hasOwn(signal, 'sourceProgramPath')
      ? 'sourceProgramPath'
      : 'sourcePath';
    const sourcePath = rewritePath(signal[sourceKey], pathChanges);
    const recipientPath = Object.hasOwn(signal, 'recipientPath')
      ? rewritePath(signal.recipientPath, pathChanges)
      : undefined;
    if (sourcePath === signal[sourceKey]
      && (!Object.hasOwn(signal, 'recipientPath') || recipientPath === signal.recipientPath)) {
      return signal;
    }
    return {
      ...signal,
      [sourceKey]: sourcePath,
      ...(Object.hasOwn(signal, 'recipientPath') ? { recipientPath } : {})
    };
  }

  function transformRelocation(transformed) {
    if (!transformed.sourcePath || !transformed.resultPath
      || transformed.sourcePath === transformed.resultPath
      || transformed.structuralCommand === 'cpy') return null;
    return {
      sourcePath: transformed.sourcePath,
      resultPath: transformed.resultPath
    };
  }

  function rewritePendingSlotTriggerEvents(events, pathChanges) {
    if (pathChanges.length === 0) return [];
    const rewrittenRecipientPaths = new Set();
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.mode !== 'slot') continue;
      const signals = event.signals.map((signal) => rewriteSlotSignalPaths(signal, pathChanges));
      if (signals.every((signal, signalIndex) => signal === event.signals[signalIndex])) {
        continue;
      }
      const rewrittenRecipients = [...new Set(signals.flatMap((signal, signalIndex) => (
        signal.recipientPath !== event.signals[signalIndex].recipientPath
          ? [signal.recipientPath]
          : []
      )))];
      events[index] = {
        ...event,
        nodes: [...new Set(signals.map(({ recipientPath }) => recipientPath))],
        signals
      };
      for (const recipientPath of rewrittenRecipients) {
        rewrittenRecipientPaths.add(recipientPath);
      }
    }
    return [...rewrittenRecipientPaths];
  }

  if (options.programExecution) {
    const execution = options.programExecution;
    const { event } = execution;
    const sourceRevision = execution.sourceReceipt.afterRevision.replace(/^sha256:/u, '');
    let refreshed = { atoms, lockIndex: programLockIndex, messages: [], transformLogs: [], pathChanges: [], changedPaths: [] };
    try {
      if (event.interaction.agent?.path && !exactMatchAtPath(atoms, event.interaction.agent.path)) {
        throw Object.assign(new Error('原交互 Agent 在当前世界中已不存在'), { code: 'PROGRAM_SOURCE_AGENT_NOT_FOUND' });
      }
      for (const selector of event.resultPaths) {
        const match = exactMatchAtPath(atoms, selector);
        if (!match) throw Object.assign(new Error(`后续执行来源已不存在：${selector}`), { code: 'PROGRAM_SOURCE_PATH_NOT_FOUND' });
        const decision = await accessController.authorize(match, 'write');
        if (decision.decision !== 'allow') throw Object.assign(new Error('当前 Agent 无权恢复来源后续执行'), {
          code: decision.code ?? 'WINDOW_ACCESS_DENIED'
        });
      }
      if (event.enabled) {
        const { mode, nodes, affectedPaths, action } = event;
        refreshed = await reconcileProgramsForWorld(atoms, { mode, nodes, affectedPaths, ...(action ? { action } : {}) });
      }
      const changedPaths = programRefreshPatchPaths(refreshed);
      if (worldChangedAtPaths(atoms, refreshed.atoms, changedPaths)) {
        const receipt = await commitChangedGraph(refreshed.atoms, { changedPaths,
          expectedRevision: revisionBefore, correlationId: `${interaction.id}:subsequent`, subsequent: true, allowEmpty: true });
        execution.childReceipt = receipt;
      } else confirmStrutDeliveryClaims();
      for (const record of refreshed.transformLogs) {
        await appendTransformLog(contextFile, record).catch(error => interactionWarnings.push(diagnostic(
          'TRANSFORM_LOG_APPEND_FAILED', '后续事实已提交，但辅助日志写入失败', { cause: error.code ?? error.message })));
      }
      execution.event = { ...event, resultPaths: event.resultPaths.map(selector => rewritePath(selector, refreshed.pathChanges)) };
      return recoveredProgramResult(execution, refreshed.atoms, { contextFile, projectionFile }, {
        status: 'completed', sourceRevision, revisionAfter: revisionOf(refreshed.atoms), errors: []
      }, { messages: refreshed.messages, warnings: interactionWarnings, lockState: programLockState(refreshed.lockIndex) });
    } catch (error) {
      const failure = await subsequentFailureDetails(error);
      return recoveredProgramResult(execution, failure.latestAtoms, { contextFile, projectionFile }, {
        status: failure.status, sourceRevision, revisionAfter: failure.revisionAfter, errors: failure.errors
      }, { warnings: mergeWarnings(interactionWarnings, failure.warning) });
    }
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
      releaseStrutDeliveryClaims();
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
    const batchDeclarationRelocations = [];
    const transformLogs = [];
    const transformEventNodes = new Set();
    const renameEventNodes = new Set();
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
        if (renamedItem.sourcePath !== renamedItem.resultPath) {
          batchDeclarationRelocations.push({ sourcePath: renamedItem.sourcePath, resultPath: renamedItem.resultPath });
        }
        const resultMatch = matchesByPath.get(renamedItem.resultPath);
        results.push({
          index: renamedItem.index,
          changed: renamedItem.changed,
          result: resultMatch ? describeAtom(resultMatch, false) : null
        });
        for (const path of [renamedItem.sourcePath, renamedItem.resultPath]) {
          if (path) {
            transformEventNodes.add(path);
            renameEventNodes.add(path);
          }
        }
      }
      // All rewritten references belong in the reversible fact patch, while
      // only the selected rename roots generate business Transform events.
      for (const path of [
        ...(renamed.relationPaths ?? []),
        ...(renamed.programSourcePaths ?? []),
        ...(renamed.shortcutPaths ?? [])
      ]) {
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
          exactIndex,
          rewriteProgramPathReferences: true
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
      if ((transformed.structuralCommand === 'mov' || isBatchRenameItem(candidate))
        && transformed.sourcePath && transformed.resultPath
        && transformed.sourcePath !== transformed.resultPath) {
        batchDeclarationRelocations.push({
          sourcePath: transformed.sourcePath,
          resultPath: transformed.resultPath
        });
      }
      for (const path of [
        ...(transformed.relationPaths ?? []),
        ...(transformed.programSourcePaths ?? []),
        ...(transformed.shortcutPaths ?? [])
      ]) {
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

    for (const programPath of renameBatch ? [] : newlyAddedProgramPaths(atoms, nextAtoms)) {
      transformEventNodes.add(programPath);
    }
    let revisionAfter = revisionOf(nextAtoms);
    let changed = revisionAfter !== revisionBefore;
    const sourceChanged = changed;
    let sourceRevision = revisionBefore;
    let sourceAtoms = structuredClone(nextAtoms);
    requestDeclarationRelocations = batchDeclarationRelocations;
    let finalProgramLockIndex = programLockIndex;
    const finalProgramMessages = [];
    let subsequentChanged = false;
    let subsequentChangedPaths = [];
    unchangedSourceEvent = postCommitEvent({ mode: 'transform',
          nodes: [...(renameBatch ? renameEventNodes : transformEventNodes)], affectedPaths: [...transformEventNodes] },
        results.map(({ result }) => result?.path), { batch: true,
          enabled: Boolean(options.programScheduler) && options.trustedMaintenance !== true
            && (requestDeclarationRelocations.length === 0 || renameBatch) });
    if (sourceChanged) {
      const sourceProgramSurfaceChanged = [...transformEventNodes].some((targetPath) => (
        subtreeSlotsTypedProgram(exactMatchAtPath(atoms, targetPath)?.atom)
        || subtreeSlotsTypedProgram(exactMatchAtPath(nextAtoms, targetPath)?.atom)
      ));
      const compiled = await validatePrograms(
        nextAtoms, contextFile, atoms, candidateProgramScheduler
      );
      interactionWarnings.push(...compiled.warnings);
      if (!compiled.ok) {
        releaseStrutDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, compiled.errors);
      }
      const delegated = await validateRequestCandidate(nextAtoms, batchDeclarationRelocations);
      if (!delegated.ok) {
        releaseStrutDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, delegated.errors);
      }
      const sourceReceipt = await commitChangedGraph(nextAtoms, {
        changedPaths: [...transformEventNodes],
        ...(!sourceProgramSurfaceChanged ? {
          projectionRebase: {
            previousAtoms: atoms,
            changedPaths: [...transformEventNodes]
          }
        } : {}),
        postCommitEvent: unchangedSourceEvent
      });
      if (sourceReceipt?.authorizationFailure) return sourceReceipt.authorizationFailure;
      sourceRevision = sourceReceipt?.afterRevision?.replace(/^sha256:/u, '')
        ?? revisionOf(nextAtoms);
      revisionAfter = sourceRevision;
      sourceAtoms = structuredClone(nextAtoms);
      for (const record of transformLogs) {
        try {
          await appendTransformLog(contextFile, { ...record, revisionAfter: sourceRevision });
        } catch (error) {
          interactionWarnings.push(diagnostic('TRANSFORM_LOG_APPEND_FAILED',
            '来源事实已提交，但辅助变更日志未能写入',
            { cause: error.code ?? error.message }));
        }
      }
      await notifySourceCommitted({
        ok: true, language: 'atom', command: 'transform', batch: true,
        createNew: false, changed: true, contextFile, projectionFile,
        revisionBefore, revisionAfter: sourceRevision, results,
        warnings: mergeWarnings(interactionWarnings, diagnostic(
          'ATOM_SUBSEQUENT_EXECUTION_PENDING',
          '来源事实已提交；后续 Program 运行待完成',
          { correlationId: `${interaction.id}:subsequent` }
        )), errors: [],
        messages: [...interactionMessages], interactionId: interaction.id,
        affectedPaths: committedAffectedPaths,
        lockState: programLockState(programLockIndex),
        subsequentExecution: {
          status: 'pending', sourceRevision, revisionAfter: sourceRevision, errors: []
        }
      });
    }
    if (options.programScheduler && options.trustedMaintenance !== true
      && (requestDeclarationRelocations.length === 0 || renameBatch)) {
      let reconciled;
      try {
        reconciled = await reconcileProgramsForWorld(nextAtoms, {
          mode: 'transform',
          nodes: [...(renameBatch ? renameEventNodes : transformEventNodes)]
        });
      } catch (error) {
        releaseStrutDeliveryClaims();
        const failure = diagnostic(
          error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
        );
        return {
          ok: true, language: 'atom', command: 'transform', batch: true,
          createNew: false, changed: sourceChanged, contextFile, projectionFile,
          revisionBefore, revisionAfter: sourceRevision, results,
          warnings: mergeWarnings(interactionWarnings, diagnostic(
            'ATOM_SUBSEQUENT_EXECUTION_FAILED',
            '来源事实已提交，但后续 Program 执行失败',
            { cause: failure.code }
          )), errors: [],
          messages: [...interactionMessages], interactionId: interaction.id,
          affectedPaths: committedAffectedPaths,
          lockState: programLockState(programLockIndex),
          subsequentExecution: {
            status: 'failed', sourceRevision, revisionAfter: sourceRevision, errors: [failure]
          }
        };
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
      changed = sourceChanged
        || reconciled.transformLogs.length > 0
        || reconciled.pathChanges.length > 0;
      subsequentChanged = worldChangedAtPaths(sourceAtoms, nextAtoms, [
        ...transformEventNodes,
        ...programRefreshPatchPaths(reconciled)
      ]);
      subsequentChangedPaths = programRefreshPatchPaths(reconciled);
    }
    const finalMatchesByPath = new Map(walkAtoms(nextAtoms).map((match) => [
      match.path.join('/'), match
    ]));
    for (const receipt of results) {
      const finalMatch = finalMatchesByPath.get(receipt.result?.path);
      if (finalMatch) receipt.result = describeAtom(finalMatch, false);
    }
    const effectsChanged = subsequentChanged;
    if (effectsChanged) {
      try {
        const commitReceipt = await commitChangedGraph(nextAtoms, {
          changedPaths: [...new Set([
            ...transformEventNodes,
            ...subsequentChangedPaths
          ])],
          expectedRevision: sourceRevision,
          correlationId: `${interaction.id}:subsequent`,
          allowEmpty: true,
          subsequent: true
        });
        revisionAfter = commitReceipt?.afterRevision?.replace(/^sha256:/u, '')
          ?? revisionOf(nextAtoms);
      } catch (error) {
        const failed = await subsequentFailureDetails(error);
        const latestMatches = new Map(walkAtoms(failed.latestAtoms).map((match) => [
          match.path.join('/'), match
        ]));
        for (const receipt of results) {
          const latest = latestMatches.get(receipt.result?.path);
          if (latest) receipt.result = describeAtom(latest, false);
        }
        return {
          ok: true, language: 'atom', command: 'transform', batch: true,
          createNew: false, changed: sourceChanged || failed.status === 'completed', contextFile, projectionFile,
          revisionBefore, revisionAfter: failed.revisionAfter, results,
          warnings: mergeWarnings(interactionWarnings, failed.warning), errors: [],
          messages: [
            ...interactionMessages,
            ...(failed.status === 'completed' ? finalProgramMessages : [])
          ], interactionId: interaction.id,
          affectedPaths: committedAffectedPaths,
          lockState: programLockState(
            failed.status === 'completed' ? finalProgramLockIndex : programLockIndex
          ),
          subsequentExecution: {
            status: failed.status, sourceRevision, revisionAfter: failed.revisionAfter,
            errors: failed.errors
          }
        };
      }
      for (const record of programTransformLogs) {
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
    } else {
      confirmStrutDeliveryClaims();
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
      affectedPaths: committedAffectedPaths,
      lockState: programLockState(finalProgramLockIndex),
      subsequentExecution: {
        status: 'completed', sourceRevision, revisionAfter, errors: []
      }
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
      programScheduler: candidateProgramScheduler
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
        releaseStrutDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, delegated.errors);
      }
    } else {
      confirmStrutDeliveryClaims();
    }
    const sourceReceipt = await commitChangedGraph(nextAtoms, {
      changedPaths: [created.resultPath],
      ...(!subtreeSlotsTypedProgram(exactMatchAtPath(nextAtoms, created.resultPath)?.atom) ? {
        projectionRebase: {
          previousAtoms: atoms,
          changedPaths: [created.resultPath]
        }
      } : {}),
      postCommitEvent: postCommitEvent({ mode: 'transform', nodes: [created.resultPath], affectedPaths: [created.resultPath] },
        [created.resultPath], { createNew: true })
    });
    if (sourceReceipt?.authorizationFailure) return sourceReceipt.authorizationFailure;
    const sourceRevision = sourceReceipt?.afterRevision?.replace(/^sha256:/u, '')
      ?? revisionOf(nextAtoms);
    const sourceAtoms = structuredClone(nextAtoms);
    await notifySourceCommitted({
      ok: true, language: 'atom', command: 'transform', createNew: true,
      changed: true, contextFile, projectionFile, revisionBefore,
      revisionAfter: sourceRevision,
      result: describeAtom(exactMatchAtPath(nextAtoms, created.resultPath), false),
      warnings: mergeWarnings(interactionWarnings, diagnostic(
        'ATOM_SUBSEQUENT_EXECUTION_PENDING',
        '来源事实已提交；后续 Program 运行待完成',
        { correlationId: `${interaction.id}:subsequent` }
      )), errors: [],
      messages: [...interactionMessages], interactionId: interaction.id,
      affectedPaths: committedAffectedPaths,
      lockState: programLockState(programLockIndex),
      subsequentExecution: {
        status: 'pending', sourceRevision, revisionAfter: sourceRevision, errors: []
      }
    });
    let postRefresh = {
      atoms: nextAtoms,
      lockIndex: programLockIndex,
      messages: [],
      transformLogs: [],
      pathChanges: []
    };
    if (options.programScheduler && options.trustedMaintenance !== true
      && requestDeclarationRelocations.length === 0) {
      try {
        postRefresh = await reconcileProgramsForWorld(nextAtoms, {
          mode: 'transform', nodes: [created.resultPath], affectedPaths: [created.resultPath]
        });
        nextAtoms = postRefresh.atoms;
      } catch (error) {
        releaseStrutDeliveryClaims();
        const failure = diagnostic(
          error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
        );
        return {
          ok: true, language: 'atom', command: 'transform', createNew: true,
          changed: true, contextFile, projectionFile, revisionBefore,
          revisionAfter: sourceRevision,
          result: describeAtom(exactMatchAtPath(nextAtoms, created.resultPath), false),
          warnings: mergeWarnings(interactionWarnings, diagnostic(
            'ATOM_SUBSEQUENT_EXECUTION_FAILED',
            '来源事实已提交，但后续 Program 执行失败',
            { cause: failure.code }
          )), errors: [],
          messages: [...interactionMessages], interactionId: interaction.id,
          affectedPaths: committedAffectedPaths,
          lockState: programLockState(programLockIndex),
          subsequentExecution: {
            status: 'failed', sourceRevision, revisionAfter: sourceRevision, errors: [failure]
          }
        };
      }
    }
    const finalCreatePath = rewritePath(created.resultPath, postRefresh.pathChanges);
    const createChangedPaths = [
      created.resultPath,
      ...programRefreshPatchPaths(postRefresh)
    ].filter(Boolean);
    const effectsChanged = worldChangedAtPaths(
      sourceAtoms, nextAtoms, programRefreshPatchPaths(postRefresh)
    );
    let revisionAfter = sourceRevision;
    if (effectsChanged) {
      try {
        const commitReceipt = await commitChangedGraph(nextAtoms, {
          changedPaths: createChangedPaths,
          expectedRevision: sourceRevision,
          correlationId: `${interaction.id}:subsequent`,
          allowEmpty: true,
          subsequent: true
        });
        revisionAfter = commitReceipt?.afterRevision?.replace(/^sha256:/u, '')
          ?? revisionOf(nextAtoms);
      } catch (error) {
        const failed = await subsequentFailureDetails(error);
        const latest = exactMatchAtPath(
          failed.latestAtoms,
          failed.status === 'completed' ? finalCreatePath : created.resultPath
        );
        return {
          ok: true, language: 'atom', command: 'transform', createNew: true,
          changed: true, contextFile, projectionFile, revisionBefore,
          revisionAfter: failed.revisionAfter,
          result: latest ? describeAtom(latest, false) : null,
          warnings: mergeWarnings(interactionWarnings, failed.warning), errors: [],
          messages: [
            ...interactionMessages,
            ...(failed.status === 'completed' ? postRefresh.messages : [])
          ], interactionId: interaction.id,
          affectedPaths: committedAffectedPaths,
          lockState: programLockState(
            failed.status === 'completed' ? postRefresh.lockIndex : programLockIndex
          ),
          subsequentExecution: {
            status: failed.status, sourceRevision, revisionAfter: failed.revisionAfter,
            errors: failed.errors
          }
        };
      }
    } else {
      confirmStrutDeliveryClaims();
    }
    for (const record of [...programTransformLogs, ...postRefresh.transformLogs]) {
      try {
        await appendTransformLog(contextFile, record);
      } catch (error) {
        interactionWarnings.push(diagnostic(
          'TRANSFORM_LOG_APPEND_FAILED',
          '后续 effects 已提交，但辅助变更日志未能写入',
          { cause: error.code ?? error.name }
        ));
      }
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
      revisionAfter,
      result: describeAtom(
        exactMatchAtPath(nextAtoms, finalCreatePath) ?? walkAtoms(nextAtoms).at(-1),
        false
      ),
      warnings: mergeWarnings(interactionWarnings),
      errors: [],
      messages: [...interactionMessages, ...postRefresh.messages],
      interactionId: interaction.id,
      affectedPaths: committedAffectedPaths,
      lockState: programLockState(postRefresh.lockIndex),
      subsequentExecution: {
        status: 'completed', sourceRevision, revisionAfter, errors: []
      }
    };
  }

  const run = programRunRequest(item);
  if (run?.error) {
    releaseStrutDeliveryClaims();
    return failureBase(parsed, contextFile, projectionFile, atoms, [run.error]);
  }
  if (run) {
    const explicitRunErrors = interactionWarnings.filter((error) => (
      error.code === 'ATOM_PROGRAM_FAILED'
      || error.code === 'PROGRAM_TRANSFORM_REJECTED'
      || error.code === 'PROGRAM_EFFECT_REJECTED'
    ));
    if (explicitRunErrors.length > 0) {
      return failureBase(parsed, contextFile, projectionFile, atoms, explicitRunErrors);
    }
    let nextAtoms = atoms;
    let revisionAfter = revisionOf(nextAtoms);
    let changed = programChanged;
    let finalProgramLockIndex = programLockIndex;
    const finalProgramMessages = [];
    const initialTriggerEvents = [];
    if (initialProgramRelocations.length > 0
      && (programCycle.slotSignals?.length ?? 0) > 0) {
      if (typeof candidateProgramScheduler?.refreshPreparedTriggerOwnership !== 'function') {
        releaseStrutDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          'PROGRAM_TRIGGER_OWNERSHIP_REFRESH_UNAVAILABLE',
          'Candidate runtime cannot refresh trigger ownership'
        )]);
      }
      try {
        await candidateProgramScheduler.refreshPreparedTriggerOwnership(
          nextAtoms, initialProgramRelocations
        );
      } catch (error) {
        releaseStrutDeliveryClaims();
        return failureBase(parsed, contextFile, projectionFile, atoms, [diagnostic(
          error.code ?? 'PROGRAM_TRIGGER_OWNERSHIP_REFRESH_FAILED',
          error.message,
          error.details ?? {}
        )]);
      }
    }
    const relocatedInitialSlotSignals = (programCycle.slotSignals ?? []).map((effect) => (
      rewriteSlotSignalPaths(effect, initialProgramRelocations)
    ));
    const initialDeliveries = resolveSlotSignalDeliveries(
      nextAtoms,
      relocatedInitialSlotSignals,
      {
        revision: revisionOf(nextAtoms),
        createId: () => crypto.randomUUID()
      }
    );
    if (initialDeliveries.length) {
      initialTriggerEvents.push({
        mode: 'slot',
        nodes: [...new Set(initialDeliveries.map(({ recipientPath }) => recipientPath))],
        signals: initialDeliveries
      });
    }
    if (changed && !strictSlotRecompute && initialProgramTransformTriggerNodes.length > 0) {
      const relocatedSlotSources = new Set(relocatedInitialSlotSignals.flatMap((effect, index) => (
        effect.sourceProgramPath !== programCycle.slotSignals?.[index]?.sourceProgramPath
          ? [effect.sourceProgramPath]
          : []
      )));
      const triggerNodes = [...new Set(initialProgramTransformTriggerNodes.filter((node) => (
        node && !relocatedSlotSources.has(node)
      )))];
      if (triggerNodes.length) {
        initialTriggerEvents.push({
          mode: 'transform', nodes: triggerNodes, affectedPaths: triggerNodes
        });
      }
    }
    if (initialTriggerEvents.length > 0) {
      try {
        const reconciled = await reconcileProgramsForWorld(nextAtoms, initialTriggerEvents);
        nextAtoms = reconciled.atoms;
        finalProgramLockIndex = reconciled.lockIndex;
        finalProgramMessages.push(...reconciled.messages);
        programTransformLogs.push(...reconciled.transformLogs);
        revisionAfter = revisionOf(nextAtoms);
        changed ||= revisionAfter !== revisionBefore;
      } catch (error) {
        releaseStrutDeliveryClaims();
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
    if (!changed) confirmStrutDeliveryClaims();
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
      messages: [...interactionMessages, ...finalProgramMessages],
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
    transactionTransformLog: options.transactionTransformLog ?? [],
    rewriteProgramPathReferences: true
  });
  if (transformed.error) {
    releaseStrutDeliveryClaims();
    return failureBase(parsed, contextFile, projectionFile, atoms, [transformed.error], { messages: interactionMessages });
  }

  let nextAtoms = transformed.atoms;
  let revisionAfter = revisionBefore;
  let changed = transformed.changed === true || programChanged;
  const declarationRelocations = (transformed.structuralCommand === 'mov' || isBatchRenameItem(item))
    && transformed.sourcePath && transformed.resultPath
    && transformed.sourcePath !== transformed.resultPath
    ? [{ sourcePath: transformed.sourcePath, resultPath: transformed.resultPath }]
    : [];
  requestDeclarationRelocations = declarationRelocations;
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
      nextAtoms, contextFile, atoms, candidateProgramScheduler
    );
    interactionWarnings.push(...compiled.warnings);
    if (!compiled.ok) {
      releaseStrutDeliveryClaims();
      return failureBase(
        parsed,
        contextFile,
        projectionFile,
        atoms,
        compiled.errors
      );
    }
    const delegated = await validateRequestCandidate(nextAtoms, declarationRelocations);
    if (!delegated.ok) {
      releaseStrutDeliveryClaims();
      return failureBase(parsed, contextFile, projectionFile, atoms, delegated.errors);
    }
  }
  await recordTransformStage('transform-apply', transformApplyStartedAt);
  const transformAffectedPaths = [...new Set([
    transformed.sourcePath,
    transformed.resultPath,
    ...(transformed.relationPaths ?? []),
    ...(transformed.programSourcePaths ?? []),
    ...(transformed.shortcutPaths ?? [])
  ].filter(Boolean))];
  const requestedTransformActions = item.fields.flatMap((field) => (
    (field.transformActions ?? []).map((action) => ({
      ...action,
      axis: field.baseKey
    }))
  ));
  const transformAction = requestedTransformActions.length === 1
    ? Object.freeze({
      targetPath: transformed.sourcePath,
      action: requestedTransformActions[0].name,
      parameter: requestedTransformActions[0].parameter,
      payload: null,
      source: options.interactionSource ?? 'cli'
    })
    : null;
  const sourceChanged = changed;
  let sourceAtoms = structuredClone(nextAtoms);
  let sourceRevision = revisionBefore;
  const sourceTransformLogRecord = transformed.logRecord && sourceChanged ? {
    ...transformed.logRecord,
    revisionBefore,
    revisionAfter: sealWorldFactsRevision(nextAtoms).slice('sha256:'.length)
  } : null;
  unchangedSourceEvent = postCommitEvent({ mode: 'transform',
    ...(transformAction ? { action: transformAction } : {}),
    affectedPaths: isBatchRenameItem(item)
      ? [transformed.sourcePath, transformed.resultPath].filter(Boolean) : transformAffectedPaths,
    nodes: [...new Set([transformed.sourcePath, transformed.resultPath, transformed.resultName,
      ...(programSurfaceChanged && !isBatchRenameItem(item) ? newlyAddedProgramPaths(atoms, nextAtoms) : [])].filter(Boolean))]
  }, [transformed.resultPath ?? transformed.resultName], {
    enabled: Boolean(options.programScheduler) && options.trustedMaintenance !== true
      && (declarationRelocations.length === 0 || isBatchRenameItem(item)),
    ...(transformed.archive ? { archive: structuredClone(transformed.archive) } : {})
  });
  if (sourceChanged) {
    if (!programSurfaceChanged && isLocalizedSituationTransform(item)) {
      inheritPreparedAccessWorld(atoms, nextAtoms);
    }
    const sourceReceipt = await commitChangedGraph(nextAtoms, {
      changedPaths: transformAffectedPaths,
      ...(!programSurfaceChanged ? {
        projectionRebase: {
          previousAtoms: atoms,
          changedPaths: transformAffectedPaths
        }
      } : {}),
      localizedSituationValidation: !programSurfaceChanged
        && isLocalizedSituationTransform(item),
      structurePreservingValidation: !programSurfaceChanged
        && isStructurePreservingTransform(item),
      transformLogRecord: sourceTransformLogRecord,
      postCommitEvent: unchangedSourceEvent
    });
    if (sourceReceipt?.authorizationFailure) return sourceReceipt.authorizationFailure;
    sourceRevision = sourceReceipt?.afterRevision?.replace(/^sha256:/u, '')
      ?? revisionOf(nextAtoms);
    revisionAfter = sourceRevision;
    sourceAtoms = structuredClone(nextAtoms);
    if (sourceTransformLogRecord) {
      try {
        await appendTransformLog(contextFile, sourceTransformLogRecord);
      } catch (error) {
        if (sourceReceipt?.result?.transformLogRecord?.id !== sourceTransformLogRecord.id) throw error;
        interactionWarnings.push(diagnostic(
          'TRANSFORM_LOG_MIRROR_FAILED',
          '事实与可逆记录已由中央事务提交，但辅助 Transform 日志镜像写入失败',
          { cause: error.code ?? error.name }
        ));
      }
    }
    const sourceMatch = walkAtoms(nextAtoms).find((match) => (
      match.path.join('/') === (transformed.resultPath ?? transformed.resultName)
    ));
    await notifySourceCommitted({
      ok: true,
      language: 'atom',
      command: 'transform',
      createNew: false,
      changed: true,
      contextFile,
      projectionFile,
      revisionBefore,
      revisionAfter: sourceRevision,
      result: sourceMatch ? describeAtom(sourceMatch, false) : null,
      warnings: mergeWarnings(interactionWarnings, diagnostic(
        'ATOM_SUBSEQUENT_EXECUTION_PENDING',
        '来源事实已提交；后续 Program 运行待完成',
        { correlationId: `${interaction.id}:subsequent` }
      )),
      errors: [],
      messages: [...interactionMessages],
      interactionId: interaction.id,
      affectedPaths: committedAffectedPaths,
      lockState: programLockState(programLockIndex),
      subsequentExecution: {
        status: 'pending', sourceRevision, revisionAfter: sourceRevision, errors: []
      }
    });
  }
  if (options.programScheduler && options.trustedMaintenance !== true
    && (requestDeclarationRelocations.length === 0 || isBatchRenameItem(item))) {
    try {
      postRefresh = await reconcileProgramsForWorld(nextAtoms, {
        mode: 'transform',
        ...(transformAction ? { action: transformAction } : {}),
        preparedIndexesValid: !programSurfaceChanged,
        preparedStrutIndexValid: !programSurfaceChanged && isLocalizedSituationTransform(item),
        strutBaseRevision: revisionOfWorldFacts(atoms),
        affectedPaths: isBatchRenameItem(item)
          ? [transformed.sourcePath, transformed.resultPath].filter(Boolean)
          : transformAffectedPaths,
        nodes: [...new Set([
          transformed.sourcePath,
          transformed.resultPath,
          transformed.resultName,
          ...(programSurfaceChanged && !isBatchRenameItem(item) ? newlyAddedProgramPaths(atoms, nextAtoms) : [])
        ].filter(Boolean))]
      }, false, declarationRelocations);
      nextAtoms = postRefresh.atoms;
      changed = changed
        || postRefresh.transformLogs.length > 0
        || postRefresh.pathChanges.length > 0;
    } catch (error) {
      releaseStrutDeliveryClaims();
      const failure = diagnostic(
        error.code ?? 'ATOM_PROGRAM_FAILED', error.message, error.details ?? {}
      );
      return {
        ok: true,
        language: 'atom',
        command: 'transform',
        createNew: false,
        changed: sourceChanged,
        contextFile,
        projectionFile,
        revisionBefore,
        revisionAfter: sourceRevision,
        result: describeAtom(
          exactMatchAtPath(nextAtoms, transformed.resultPath ?? transformed.resultName), false
        ),
        ...(transformed.archive ? { archive: structuredClone(transformed.archive) } : {}),
        warnings: mergeWarnings(interactionWarnings, diagnostic(
          'ATOM_SUBSEQUENT_EXECUTION_FAILED',
          '来源事实已提交，但后续 Program 执行失败',
          { cause: failure.code }
        )),
        errors: [],
        messages: [...interactionMessages],
        interactionId: interaction.id,
        affectedPaths: committedAffectedPaths,
        lockState: programLockState(programLockIndex),
        subsequentExecution: {
          status: 'failed', sourceRevision, revisionAfter: sourceRevision, errors: [failure]
        }
      };
    }
  }
  const effectsChanged = worldChangedAtPaths(
    sourceAtoms, nextAtoms, programRefreshPatchPaths(postRefresh)
  );
  if (effectsChanged) {
    try {
      const commitReceipt = await commitChangedGraph(nextAtoms, {
        changedPaths: [...new Set([
          ...programRefreshPatchPaths(postRefresh)
        ].filter(Boolean))],
        expectedRevision: sourceRevision,
        correlationId: `${interaction.id}:subsequent`,
        allowEmpty: true,
        subsequent: true
      });
      revisionAfter = commitReceipt?.afterRevision?.replace(/^sha256:/u, '')
        ?? revisionOf(nextAtoms);
    } catch (error) {
      const failed = await subsequentFailureDetails(error);
      const latestResultPath = failed.status === 'completed'
        ? rewritePath(
            transformed.resultPath ?? transformed.resultName,
            postRefresh.pathChanges
          )
        : transformed.resultPath ?? transformed.resultName;
      const latestResult = exactMatchAtPath(failed.latestAtoms, latestResultPath);
      return {
        ok: true, language: 'atom', command: 'transform', createNew: false,
        changed: sourceChanged || failed.status === 'completed', contextFile, projectionFile, revisionBefore,
        revisionAfter: failed.revisionAfter,
        result: latestResult ? describeAtom(latestResult, false) : null,
        ...(transformed.archive ? { archive: structuredClone(transformed.archive) } : {}),
        warnings: mergeWarnings(interactionWarnings, failed.warning), errors: [],
        messages: [
          ...interactionMessages,
          ...(failed.status === 'completed' ? postRefresh.messages : [])
        ], interactionId: interaction.id,
        affectedPaths: committedAffectedPaths,
        lockState: programLockState(
          failed.status === 'completed' ? postRefresh.lockIndex : programLockIndex
        ),
        subsequentExecution: {
          status: failed.status, sourceRevision, revisionAfter: failed.revisionAfter,
          errors: failed.errors
        }
      };
    }
    for (const record of [...programTransformLogs, ...postRefresh.transformLogs]) {
      try {
        await appendTransformLog(contextFile, record);
      } catch (error) {
        interactionWarnings.push(diagnostic('TRANSFORM_LOG_APPEND_FAILED',
          '后续 effects 已提交，但辅助变更日志未能写入',
          { cause: error.code ?? error.name }));
      }
    }
  } else {
    confirmStrutDeliveryClaims();
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
  if (!changed) confirmStrutDeliveryClaims();
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
    lockState: programLockState(postRefresh.lockIndex),
    subsequentExecution: {
      status: 'completed', sourceRevision, revisionAfter, errors: []
    }
  };

}
