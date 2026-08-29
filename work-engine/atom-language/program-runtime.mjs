import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { legacyAtomContextMetadata } from './context-store.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { executeProgramExplore, oneStoredField, prepareExploreWorld, walkAtoms } from './query-capability.mjs';
import { matchesExactSelector } from './exact-selector.mjs';
import { normalizeTypePredicate } from './program-locks.mjs';
import { slotProgramInvocationsForEvent } from './slot-body-plan-runtime.mjs';
import { shortcutMetadata } from './shortcut-runtime.mjs';
import { WORLD_OUTSIDE_NAME } from './world-root.mjs';
import { programDiagnosticIdentity } from '../../src/atom-system/world-runtime/year-ring.mjs';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_WORKERS = 16;
const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'program-worker.py');
const preparedRecordSnapshots = new WeakMap();
const preparedProgramSnapshots = new WeakMap();
const isolatedProgramPathsByRecords = new WeakMap();

function freezePrepared(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezePrepared(child);
  return Object.freeze(value);
}

function fields(atom) {
  const result = new Map();
  for (const [key, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(key, { descriptionSymbolWarnings: false });
    if (!parsed.errors.length && !result.has(parsed.baseKey)) result.set(parsed.baseKey, { parsed, value });
  }
  return result;
}

function worldRecords(atoms) {
  const worldRevision = revisionOfWorldFacts(atoms).slice('sha256:'.length);
  const cached = preparedRecordSnapshots.get(atoms);
  if (cached?.worldRevision === worldRevision) return cached.records;
  const records = [];
  function visit(atom, parentRef, parentPath, address) {
    const stored = fields(atom);
    const name = stored.get('thing')?.value;
    const atomPath = [...parentPath, name].join('/');
    const ref = crypto.createHash('sha256').update(`${worldRevision}:${address}`).digest('base64url').slice(0, 24);
    const record = {
      ref,
      name,
      detail: stored.get('situation')?.value ?? '',
      path: atomPath,
      types: stored.get('thing')?.parsed.types.map((type) => type.raw) ?? [],
      parentRef,
      childrenRefs: [],
      partners: structuredClone(stored.get('support')?.value ?? [])
    };
    if (record.types.includes('shortcut')) {
      const metadata = shortcutMetadata(atom);
      record.shortcutIdentity = metadata?.referenceId ?? null;
      record.shortcutTargetPath = metadata?.target?.state === 'linked'
        ? metadata.target.path
        : null;
    }
    records.push(record);
    for (const [index, child] of (stored.get('contain')?.value ?? []).entries()) {
      const childRecord = visit(child, ref, [...parentPath, name], `${address}/${index}`);
      record.childrenRefs.push(childRecord.ref);
    }
    return record;
  }
  for (const [index, atom] of atoms.entries()) visit(atom, null, [], `${index}`);
  const legacy = legacyAtomContextMetadata(atoms);
  if (legacy) {
    isolatedProgramPathsByRecords.set(records, new Set(legacy.isolatedProgramPaths ?? []));
  }
  const prepared = freezePrepared(records);
  if (legacy) isolatedProgramPathsByRecords.set(prepared, new Set(legacy.isolatedProgramPaths ?? []));
  preparedRecordSnapshots.set(atoms, { worldRevision, records: prepared });
  return prepared;
}

function programRecords(records, selector = null) {
  const cachedPrograms = Object.isFrozen(records)
    ? preparedProgramSnapshots.get(records)
    : null;
  if (cachedPrograms && !selector) return cachedPrograms;
  if (cachedPrograms) {
    const matches = cachedPrograms.filter((program) => matchesExactSelector(
      program.path.split('/'), program.name, selector
    ));
    if (matches.length === 1) return matches;
    const error = new Error(matches.length
      ? `Program name is ambiguous: ${selector}`
      : `Program not found: ${selector}`);
    error.code = matches.length ? 'AMBIGUOUS_PROGRAM_NAME' : 'PROGRAM_NOT_FOUND';
    error.details = { program: selector, paths: matches.map((program) => program.path) };
    throw error;
  }
  const recordsByRef = new Map(records.map((record) => [record.ref, record]));
  const isolatedPaths = isolatedProgramPathsByRecords.get(records) ?? new Set();
  const defaultBackups = records.filter((record) => (
    record.types.includes('backup') && record.types.includes('default')
  ));
  if (defaultBackups.length > 1) {
    const error = new Error('World contains multiple typed default backup roots');
    error.code = 'AMBIGUOUS_DEFAULT_BACKUP';
    error.details = { paths: defaultBackups.map((record) => record.path) };
    throw error;
  }
  const [defaultBackup] = defaultBackups;
  const insideDefaultBackup = new Map();
  const isInsideDefaultBackup = (record) => {
    if (!record) return false;
    if (insideDefaultBackup.has(record.ref)) return insideDefaultBackup.get(record.ref);
    const lineage = [];
    let current = record;
    while (current && !insideDefaultBackup.has(current.ref)) {
      lineage.push(current);
      if (current.ref === defaultBackup?.ref) break;
      current = current.parentRef ? recordsByRef.get(current.parentRef) : null;
    }
    let inactive = current
      ? insideDefaultBackup.get(current.ref)
        ?? (current.ref === defaultBackup?.ref)
      : false;
    while (lineage.length) {
      insideDefaultBackup.set(lineage.pop().ref, inactive);
    }
    return inactive;
  };
  let programs = records.filter((record) => (
    record.types.includes('program')
    && !isolatedPaths.has(record.path)
    && record.detail.trim()
    && !isInsideDefaultBackup(record)
  ));
  if (Object.isFrozen(records)) {
    programs = Object.freeze(programs);
    preparedProgramSnapshots.set(records, programs);
  }
  if (!selector) return programs;
  const matches = programs.filter((program) => matchesExactSelector(
    program.path.split('/'), program.name, selector
  ));
  if (matches.length === 1) return matches;
  const error = new Error(matches.length
    ? `Program name is ambiguous: ${selector}`
    : `Program not found: ${selector}`);
  error.code = matches.length ? 'AMBIGUOUS_PROGRAM_NAME' : 'PROGRAM_NOT_FOUND';
  error.details = { program: selector, paths: matches.map((program) => program.path) };
  throw error;
}

function fingerprint(records, programs, agentOrigin, isolateFailures) {
  return crypto.createHash('sha256').update(JSON.stringify({
    worldKey: worldRevisionKey(records),
    programs: programs.map((program) => program.ref),
    agentOrigin: agentOrigin ? { path: agentOrigin.path } : null,
    isolateFailures
  })).digest('hex');
}

function programSetFingerprint(programs, isolateFailures, records) {
  const recordsByRef = new Map(records.map((record) => [record.ref, record]));
  return crypto.createHash('sha256').update(JSON.stringify({
    programs: programs.map((program) => {
      const definition = semanticRecord(program, recordsByRef);
      // An @agent Program is the security/window declaration carried by the
      // Agent node. Ordinary business children are its managed contents, not
      // part of that declaration's executable definition.
      return program.types.includes('agent')
        ? { ...definition, childrenPaths: [] }
        : definition;
    }),
    isolateFailures
  })).digest('hex');
}

function sourceDefinitionFingerprint(programs) {
  return crypto.createHash('sha256').update(JSON.stringify(programs.map((program) => ({
    path: program.path,
    detail: program.detail,
    types: program.types
  })))).digest('hex');
}

function agentSecurityFingerprint(programs) {
  return sourceDefinitionFingerprint(programs.filter((program) => program.types.includes('agent')));
}

function requestDrivenLockFingerprint(records, programs, securityFingerprint, locks = []) {
  const recordsByPath = new Map(records.map((record) => [record.path, record]));
  const dependencyPaths = [...new Set(locks.flatMap((lock) => ([
    ...(lock.targets?.paths ?? []),
    ...(lock.allowed_windows?.paths ?? []),
    ...(lock.allowed_programs?.paths ?? [])
  ])))].sort();
  return crypto.createHash('sha256').update(JSON.stringify({
    programs: sourceDefinitionFingerprint(programs),
    securityFingerprint,
    dependencies: dependencyPaths.map((path) => ({
      path,
      types: recordsByPath.get(path)?.types ?? null
    }))
  })).digest('hex');
}

function reusableProgramSetFingerprint(programs, dependencyPrograms, isolateFailures, records) {
  return crypto.createHash('sha256').update(JSON.stringify({
    selectedPrograms: programSetFingerprint(programs, isolateFailures, records),
    availablePrograms: programSetFingerprint(dependencyPrograms, isolateFailures, records)
  })).digest('hex');
}

function agentScopePath(agentOrigin) {
  return typeof agentOrigin?.path === 'string' && agentOrigin.path
    ? agentOrigin.path
    : null;
}

function owningAgentPath(program, recordsByRef) {
  let record = program;
  while (record) {
    if (record.types.includes('agent')) return record.path;
    record = record.parentRef ? recordsByRef.get(record.parentRef) ?? null : null;
  }
  return null;
}

function programUsesJump(program) {
  return /\bjump\s*\(/u.test(program.detail);
}

function contextualProgramSetFingerprint(
  programs, dependencyPrograms, isolateFailures, scopePath, records
) {
  return crypto.createHash('sha256').update(JSON.stringify({
    programSet: reusableProgramSetFingerprint(
      programs, dependencyPrograms, isolateFailures, records
    ),
    scopePath
  })).digest('hex');
}

function requestsDependOnAgent(requests) {
  return requests.some((request) => (
    !request?.thing
    || request.thing === '.'
    || (typeof request.thing === 'string' && request.thing.startsWith('./'))
  ));
}

function reusableCandidates(
  cache, programs, isolateFailures, agentOrigin, records, dependencyPrograms = programs
) {
  const scopePath = agentScopePath(agentOrigin);
  const contextualKey = contextualProgramSetFingerprint(
    programs, dependencyPrograms, isolateFailures, scopePath, records
  );
  const globalKey = reusableProgramSetFingerprint(
    programs, dependencyPrograms, isolateFailures, records
  );
  return [
    [contextualKey, cache.get(contextualKey)],
    [globalKey, cache.get(globalKey)]
  ].filter(([, entry]) => entry
    && (entry.contextDependent !== true || entry.scopePath === scopePath)
    && !(entry.contextIncomplete === true && scopePath));
}

function programMayResolveAnotherProgram(program) {
  return /\b(?:jump|use_program)\b/u.test(program.detail);
}

function reusableProgramCandidates(
  cache, program, isolateFailures, agentOrigin, records, availablePrograms
) {
  const completeSetCandidates = reusableCandidates(
    cache, [program], isolateFailures, agentOrigin, records, availablePrograms
  );
  if (completeSetCandidates.length || programMayResolveAnotherProgram(program)) {
    return completeSetCandidates;
  }
  return reusableCandidates(
    cache, [program], isolateFailures, agentOrigin, records, [program]
  );
}

function semanticRecord(record, recordsByRef) {
  return {
    path: record.path,
    name: record.name,
    detail: record.detail,
    types: record.types,
    parentPath: record.parentRef ? recordsByRef.get(record.parentRef)?.path ?? null : null,
    childrenPaths: record.childrenRefs.map((ref) => recordsByRef.get(ref)?.path ?? null),
    partners: record.partners
  };
}

function programExploreRecord(match, recordsByPath) {
  const marker = match?.resolvedThroughShortcut;
  if (!marker) return recordsByPath.get(match?.path) ?? null;
  const reference = recordsByPath.get(marker.path);
  const target = reference?.shortcutTargetPath
    ? recordsByPath.get(reference.shortcutTargetPath)
    : null;
  if (!reference
    || !reference.types.includes('shortcut')
    || reference.shortcutIdentity !== marker.identity
    || !target) {
    throw Object.assign(
      new Error(`Program explore returned an invalid shortcut resolution: ${marker.path}`),
      { code: 'INVALID_PROGRAM_EXPLORE_RESULT' }
    );
  }
  return { ...target, shortcutReference: reference };
}

function dependencySnapshot(request, matches, state) {
  const records = matches.flatMap((match) => {
    const record = programExploreRecord(match, state.recordsByPath);
    return record ? [record, record.shortcutReference].filter(Boolean) : [];
  });
  return {
    request,
    matches: [...new Map(records.map((record) => [record.path, record])).values()]
      .map((record) => semanticRecord(record, state.recordsByRef))
  };
}

function rememberDependencySnapshot(state, request, matches) {
  const key = JSON.stringify(request);
  if (!state.snapshots.has(key)) {
    state.snapshots.set(key, Promise.resolve(dependencySnapshot(request, matches, state)));
  }
}

async function dependencyMatchPaths(requests, state) {
  const snapshots = await Promise.all(requests.map((request) => (
    state.snapshots.get(JSON.stringify(request))
  )).filter(Boolean));
  return [...new Set(snapshots.flatMap((snapshot) => (
    (snapshot.matches ?? []).map((match) => match.path).filter(Boolean)
  )))];
}

async function dependencyFingerprint(requests, executeExplore, records, cache = null) {
  const state = cache ?? {
    recordsByPath: new Map(records.map((record) => [record.path, record])),
    recordsByRef: new Map(records.map((record) => [record.ref, record])),
    snapshots: new Map()
  };
  const snapshots = await Promise.all(requests.map((request) => {
    const key = JSON.stringify(request);
    if (!state.snapshots.has(key)) {
      state.snapshots.set(key, (async () => {
        try {
          const matches = await executeExplore(structuredClone(request));
          return dependencySnapshot(request, matches, state);
        } catch (error) {
          return {
            request,
            error: {
              code: error?.code ?? 'PROGRAM_DEPENDENCY_QUERY_FAILED',
              message: error?.message ?? 'Program dependency query failed',
              details: error?.details ?? {}
            }
          };
        }
      })());
    }
    return state.snapshots.get(key);
  }));
  return crypto.createHash('sha256').update(JSON.stringify(snapshots)).digest('hex');
}

async function evaluateSlotSupportExpr(expr, { recordsByPath, evaluateProgram }) {
  if (typeof expr?.thing === 'string') return recordsByPath.has(expr.thing);
  if (typeof expr?.['thing@program'] === 'string') {
    return evaluateProgram(expr['thing@program']);
  }
  if (Array.isArray(expr?.and)) {
    for (const child of expr.and) {
      if (await evaluateSlotSupportExpr(child, { recordsByPath, evaluateProgram }) === false) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(expr?.or)) {
    for (const child of expr.or) {
      if (await evaluateSlotSupportExpr(child, { recordsByPath, evaluateProgram }) === true) {
        return true;
      }
    }
    return false;
  }
  throw Object.assign(new Error('槽体采用修订包含无法求值的 support 前件'), {
    code: 'INVALID_SLOT_SUPPORT_EXPR'
  });
}

function rebindLocks(locks, previousRecords, records) {
  const oldPathByRef = new Map(previousRecords.map((record) => [record.ref, record.path]));
  const newRefByPath = new Map(records.map((record) => [record.path, record.ref]));
  return locks.map((lock) => {
    const rebound = {
      ...structuredClone(lock),
      sourceProgramRef: newRefByPath.get(lock.sourceProgramPath) ?? lock.sourceProgramRef
    };
    if (lock.kind === 'node' || lock.kind === 'contain') {
      return newRefByPath.has(lock.path) ? rebound : null;
    }
    rebound.targets = Array.isArray(lock.targets?.paths) ? structuredClone(lock.targets) : {
      ...structuredClone(lock.targets),
      refs: lock.targets.refs.map((ref) => newRefByPath.get(oldPathByRef.get(ref))).filter(Boolean)
    };
    return Array.isArray(rebound.targets?.paths) || rebound.targets.refs.length
      ? rebound
      : null;
  }).filter(Boolean);
}

function mergeDerivedLocks(...collections) {
  const unique = new Map();
  for (const lock of collections.flat()) {
    unique.set(JSON.stringify(lock), structuredClone(lock));
  }
  return [...unique.values()];
}

function worldRevisionKey(records) {
  return records[0]?.ref ?? 'empty-world';
}

function requestMayObserveEvent(request, eventNodes) {
  const selector = request?.thing;
  if (typeof selector !== 'string' || !selector.trim()
    || selector === '.' || selector.startsWith('./')) return true;
  const target = selector.trim();
  return [...eventNodes].some((node) => (
    node === target
    || node.endsWith(`/${target}`)
    || target.startsWith(`${node}/`)
    || node.startsWith(`${target}/`)
  ));
}

function worldKeyFromRevision(revision, atoms) {
  if (!atoms.length) return 'empty-world';
  const canonical = `${revision}`.replace(/^sha256:/u, '');
  return crypto.createHash('sha256').update(`${canonical}:0`).digest('base64url').slice(0, 24);
}

function exactAtomAddress(atoms, selector) {
  const parts = `${selector ?? ''}`.split('/').filter(Boolean);
  let children = atoms;
  let current = null;
  let address = '';
  for (const part of parts) {
    const matches = children.flatMap((atom, index) => (
      oneStoredField(atom, 'thing')?.value === part ? [{ atom, index }] : []
    ));
    if (matches.length !== 1) return null;
    current = matches[0].atom;
    address = address ? `${address}/${matches[0].index}` : `${matches[0].index}`;
    children = oneStoredField(current, 'contain')?.value ?? [];
  }
  return current ? { atom: current, address } : null;
}

function subtreeContainsProgram(atom) {
  if (!atom) return false;
  if (oneStoredField(atom, 'thing')?.parsed.types.some((type) => type.raw === 'program')) {
    return true;
  }
  return (oneStoredField(atom, 'contain')?.value ?? []).some(subtreeContainsProgram);
}

function pathsIntersect(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function localProjectionRebaseEligible(previousAtoms, atoms, changedPaths, stored) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return false;
  const dependencyPaths = stored.exploreReadPaths ?? [];
  if (changedPaths.some((changed) => dependencyPaths.some((path) => pathsIntersect(changed, path)))) {
    return false;
  }
  const lockPaths = (stored.locks ?? []).flatMap((lock) => ([
    lock.sourceProgramPath,
    lock.path,
    ...(lock.targets?.paths ?? []),
    ...(lock.allowed_windows?.paths ?? []),
    ...(lock.allowed_programs?.paths ?? [])
  ])).filter(Boolean);
  if (changedPaths.some((changed) => lockPaths.some((path) => pathsIntersect(changed, path)))) {
    return false;
  }
  if ((stored.locks ?? []).some((lock) => (
    Array.isArray(lock.targets?.refs) && !Array.isArray(lock.targets?.paths)
  ))) return false;
  return !changedPaths.some((changed) => (
    subtreeContainsProgram(exactAtomAddress(previousAtoms, changed)?.atom)
    || subtreeContainsProgram(exactAtomAddress(atoms, changed)?.atom)
  ));
}

function rebindPathLocks(locks, atoms, revision) {
  return locks.map((lock) => {
    const source = lock.sourceProgramPath
      ? exactAtomAddress(atoms, lock.sourceProgramPath)
      : null;
    if (lock.sourceProgramPath && !source) return null;
    if ((lock.kind === 'node' || lock.kind === 'contain')
      && !exactAtomAddress(atoms, lock.path)) return null;
    return {
      ...structuredClone(lock),
      ...(source ? {
        sourceProgramRef: crypto.createHash('sha256')
          .update(`${`${revision}`.replace(/^sha256:/u, '')}:${source.address}`)
          .digest('base64url')
          .slice(0, 24)
      } : {})
    };
  }).filter(Boolean);
}

function canonicalGraphPath(path) {
  const prefix = `${WORLD_OUTSIDE_NAME}/`;
  return typeof path === 'string' && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function resolveExactPathFromCurrentContext(atoms, selector) {
  if (!Array.isArray(atoms) || typeof selector !== 'string' || !selector) return null;
  const matches = walkAtoms(atoms).filter((match) => matchesExactSelector(
    match.path,
    oneStoredField(match.atom, 'thing')?.value,
    selector
  ));
  return matches.length === 1 ? canonicalGraphPath(matches[0].path.join('/')) : null;
}

export function validateProgramResult(result, records, program, options = {}) {
  const { scopeRoot = null, supportDecision = false, resolveExactPath = null } = options;
  if (!result?.ok) {
    const error = new Error(result?.error?.message || 'Python Program failed');
    error.code = typeof result?.error?.code === 'string'
      ? result.error.code
      : 'ATOM_PROGRAM_FAILED';
    error.details = { program: program.path, type: result?.error?.type };
    throw error;
  }
  const knownRefs = new Set(records.map((record) => record.ref));
  const recordsByRef = new Map(records.map((record) => [record.ref, record]));
  const recordsByPath = new Map(records.map((record) => [record.path, record]));
  const locks = (result.locks ?? []).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw Object.assign(new Error('lock() result must be a JSON object'), { code: 'INVALID_PROGRAM_LOCK' });
    }
    const refs = entry.targets?.refs;
    const paths = entry.targets?.paths;
    if (Array.isArray(entry.actions) || Array.isArray(entry.labels)) {
      const scope = entry.targets?.scope ?? 'exact';
      const indexedTargetPath = Array.isArray(paths) && paths.length === 1
        ? canonicalGraphPath(paths[0])
        : (Array.isArray(refs) && refs.length === 1 && knownRefs.has(refs[0])
          ? recordsByRef.get(refs[0]).path
          : null);
      const resolvedLivePath = Array.isArray(paths) && paths.length === 1 && typeof resolveExactPath === 'function'
        ? canonicalGraphPath(resolveExactPath(paths[0]))
        : null;
      const targetPath = typeof indexedTargetPath === 'string' && recordsByPath.has(indexedTargetPath)
        ? indexedTargetPath
        : resolvedLivePath;
      const targetExists = typeof targetPath === 'string' && targetPath.length > 0;
      if (typeof indexedTargetPath === 'string' && !targetExists) {
        throw Object.assign(new Error('lock target path does not resolve in the current Graph'), {
          code: 'INVALID_PROGRAM_LOCK_TARGET'
        });
      }
      if (!targetExists
        || (paths !== undefined && refs !== undefined)
        || !['exact', 'subtree'].includes(scope)
        || !Array.isArray(entry.actions) || entry.actions.length === 0
        || entry.actions.some((action) => !['explore', 'transform'].includes(action))
        || new Set(entry.actions).size !== entry.actions.length
        || !Array.isArray(entry.labels) || entry.labels.length === 0
        || entry.labels.some((label) => typeof label !== 'string' || !label)
        || new Set(entry.labels).size !== entry.labels.length
        || Object.keys(entry).some((key) => !['targets', 'actions', 'labels'].includes(key))
        || Object.keys(entry.targets ?? {}).some((key) => !['refs', 'paths', 'scope'].includes(key))) {
        throw Object.assign(new Error('lock() requires one range, actions, and labels'), {
          code: 'INVALID_PROGRAM_LOCK'
        });
      }
      return {
        kind: scope === 'subtree' ? 'contain' : 'node',
        path: targetPath,
        actions: [...entry.actions],
        labels: [...entry.labels],
        sourceProgramPath: program.path
      };
    }
    const usesPaths = paths !== undefined;
    if (usesPaths
      ? (!Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length
        || paths.some((path) => typeof path !== 'string' || !recordsByPath.has(path)))
      : (!Array.isArray(refs) || !refs.length || refs.some((ref) => !knownRefs.has(ref)))) {
      throw Object.assign(new Error('lock targets contain an unknown exact Atom coordinate'), {
        code: 'INVALID_PROGRAM_LOCK_TARGET'
      });
    }
    const targetKeys = Object.keys(entry.targets ?? {});
    const targetScope = entry.targets?.scope ?? 'exact';
    if ((usesPaths && refs !== undefined)
      || targetKeys.some((key) => !['refs', 'paths', 'scope'].includes(key))
      || !['exact', 'subtree'].includes(targetScope)) {
      throw Object.assign(new Error('lock.targets.scope must be exact or subtree'), {
        code: 'INVALID_PROGRAM_LOCK_TARGET_SCOPE'
      });
    }
    if (!['write', 'read_write'].includes(entry.mode)) {
      throw Object.assign(new Error('lock.mode must be write or read_write'), { code: 'INVALID_PROGRAM_LOCK_MODE' });
    }
    const fields = entry.fields ?? ['thing', 'situation', 'contain', 'support'];
    if (!Array.isArray(fields) || !fields.length
      || fields.some((field) => !['thing', 'situation', 'contain', 'support', 'messages'].includes(field))) {
      throw Object.assign(new Error('lock.fields contains an unsupported Atom field'), { code: 'INVALID_PROGRAM_LOCK_FIELDS' });
    }
    const protect = entry.protect ?? { atom: true, messages: false };
    if (!protect || typeof protect !== 'object' || Array.isArray(protect)
      || typeof (protect.atom ?? true) !== 'boolean'
      || typeof (protect.messages ?? false) !== 'boolean') {
      throw Object.assign(new Error('lock.protect must be a JSON object of booleans'), { code: 'INVALID_PROGRAM_LOCK_PROTECT' });
    }
    let allowedWindows;
    if (entry.allowed_windows !== undefined) {
      const value = entry.allowed_windows;
      const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
      const paths = value?.paths;
      if (keys.length !== 1 || !['paths', 'types', 'relation'].includes(keys[0])) {
        throw Object.assign(new Error('lock.allowed_windows requires exactly one of paths, types or relation'), {
          code: 'INVALID_PROGRAM_LOCK_ALLOWED_WINDOWS'
        });
      }
      if (keys[0] === 'paths') {
        if (!Array.isArray(paths) || paths.length === 0
          || paths.some((path) => typeof path !== 'string' || !path.includes('/'))
          || new Set(paths).size !== paths.length
          || paths.some((path) => {
            const record = recordsByPath.get(path);
            return !record || !record.types?.includes('agent');
          })) {
          throw Object.assign(new Error('lock.allowed_windows.paths must contain unique exact full paths resolving to @agent Atoms'), {
            code: 'INVALID_PROGRAM_LOCK_ALLOWED_WINDOWS'
          });
        }
        allowedWindows = { paths: [...paths] };
      } else if (keys[0] === 'types') {
        allowedWindows = {
          types: normalizeTypePredicate(value.types, {
            code: 'INVALID_PROGRAM_LOCK_WINDOW_TYPES',
            label: 'lock.allowed_windows.types'
          })
        };
      } else {
        if (value.relation !== 'target_within_window_parent') {
          throw Object.assign(new Error('lock.allowed_windows.relation only supports target_within_window_parent'), {
            code: 'INVALID_PROGRAM_LOCK_WINDOW_RELATION'
          });
        }
        allowedWindows = { relation: value.relation };
      }
    }
    let allowedPrograms;
    if (entry.allowed_programs !== undefined) {
      const value = entry.allowed_programs;
      const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
      if (keys.length !== 1 || keys[0] !== 'paths'
        || !Array.isArray(value.paths) || value.paths.length === 0
        || new Set(value.paths).size !== value.paths.length
        || value.paths.some((path) => {
          const record = recordsByPath.get(path);
          return !record || !record.types?.includes('program');
        })) {
        throw Object.assign(new Error('lock.allowed_programs.paths must contain unique exact paths resolving to @program Atoms'), {
          code: 'INVALID_PROGRAM_LOCK_ALLOWED_PROGRAMS'
        });
      }
      allowedPrograms = { paths: [...value.paths] };
    }
    let when;
    if (entry.when !== undefined) {
      const value = entry.when;
      const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
      if (keys.length === 0 || keys.some((key) => !['target_types', 'actions'].includes(key))) {
        throw Object.assign(new Error('lock.when only supports target_types and actions'), {
          code: 'INVALID_PROGRAM_LOCK_WHEN'
        });
      }
      const actions = value.actions;
      if (actions !== undefined && (!Array.isArray(actions) || actions.length === 0
        || actions.some((action) => !['explore', 'transform'].includes(action))
        || new Set(actions).size !== actions.length)) {
        throw Object.assign(new Error('lock.when.actions requires unique explore or transform values'), {
          code: 'INVALID_PROGRAM_LOCK_ACTIONS'
        });
      }
      when = {
        ...(value.target_types !== undefined ? {
          target_types: normalizeTypePredicate(value.target_types, {
            code: 'INVALID_PROGRAM_LOCK_TARGET_TYPES',
            label: 'lock.when.target_types'
          })
        } : {}),
        ...(actions !== undefined ? { actions: [...actions] } : {})
      };
    }
    let refresh;
    if (entry.refresh !== undefined) {
      const value = entry.refresh;
      const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
      if (keys.length !== 1 || keys[0] !== 'policy' || value.policy !== 'on_request') {
        throw Object.assign(new Error('lock.refresh only supports {"policy":"on_request"}'), {
          code: 'INVALID_PROGRAM_LOCK_REFRESH'
        });
      }
      refresh = { policy: 'on_request' };
      if (!usesPaths) {
        throw Object.assign(new Error('request-driven locks require literal exact Graph paths'), {
          code: 'REQUEST_DRIVEN_LOCK_LITERAL_REQUIRED'
        });
      }
    }
    return {
      ...structuredClone(entry),
      targets: {
        ...(usesPaths ? { paths: [...paths] } : { refs: [...refs] }),
        ...(targetScope === 'subtree' ? { scope: 'subtree' } : {})
      },
      fields, protect: { atom: protect.atom ?? true, messages: protect.messages ?? false },
      ...(allowedWindows ? { allowed_windows: allowedWindows } : {}),
      ...(allowedPrograms ? { allowed_programs: allowedPrograms } : {}),
      ...(when ? { when } : {}),
      ...(refresh ? { refresh } : {}),
      sourceProgramRef: program.ref, sourceProgramPath: program.path
    };
  });
  const messages = (result.messages ?? []).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !['info', 'warning', 'error'].includes(entry.level)
      || typeof entry.text !== 'string') {
      throw Object.assign(new Error('message() requires level and text in one JSON object'), { code: 'INVALID_PROGRAM_MESSAGE' });
    }
    if (entry.data !== undefined && JSON.stringify(entry.data).length > 65_536) {
      throw Object.assign(new Error('message.data exceeds 65536 serialized characters'), { code: 'INVALID_PROGRAM_MESSAGE' });
    }
    return { ...structuredClone(entry), sourceProgramRef: program.ref, sourceProgramPath: program.path };
  });
  const transforms = (result.transforms ?? []).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw Object.assign(new Error('transform() requires one JSON object'), { code: 'INVALID_PROGRAM_TRANSFORM' });
    }
    return {
      ...structuredClone(entry),
      sourceProgramRef: program.ref,
      sourceProgramPath: program.path,
      ...(scopeRoot ? { sourceScopeRoot: scopeRoot } : {})
    };
  });
  const shortcuts = (result.shortcuts ?? []).map((entry) => {
    const sourceProgramPath = typeof entry?.__sourceProgramPath === 'string'
      ? entry.__sourceProgramPath : program.path;
    if (entry?.action === 'delete') {
      const reference = records.find((record) => record.ref === entry.referenceRef);
      if (!reference || reference.path !== entry.referencePath
        || !reference.types.includes('shortcut')
        || reference.shortcutIdentity !== entry.referenceIdentity
        || !recordsByPath.get(sourceProgramPath)?.types.includes('program')) {
        throw Object.assign(new Error('shortcut() returned an invalid delete effect'), {
          code: 'INVALID_SHORTCUT_EFFECT'
        });
      }
      return {
        action: 'delete',
        referenceRef: entry.referenceRef,
        referencePath: entry.referencePath,
        referenceIdentity: entry.referenceIdentity,
        sourceProgramPath,
        ...(scopeRoot ? { sourceScopeRoot: scopeRoot } : {})
      };
    }
    const target = records.find((record) => record.ref === entry?.targetRef);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || entry.action !== 'create'
      || entry.placement !== 'contain' || typeof entry.thing !== 'string' || !entry.thing.trim()
      || entry.thing !== entry.thing.trim() || entry.thing.includes('/')
      || !target || target.path !== entry.targetPath
      || !recordsByPath.get(sourceProgramPath)?.types.includes('program')) {
      throw Object.assign(new Error('shortcut() returned an invalid reference effect'), {
        code: 'INVALID_SHORTCUT_EFFECT'
      });
    }
    return { action: 'create', placement: 'contain', thing: entry.thing, targetRef: entry.targetRef,
      targetPath: entry.targetPath, sourceProgramPath,
      ...(scopeRoot ? { sourceScopeRoot: scopeRoot } : {}) };
  });
  if (scopeRoot && (result.slotBodies?.length ?? 0) > 0) {
    throw Object.assign(new Error('相对域计算 Program 不得递归登记槽体效果'), {
      code: 'SLOT_BODY_NESTED_EFFECT_FORBIDDEN',
      details: { scope_root: scopeRoot, program: program.path }
    });
  }
  const slotBodies = (result.slotBodies ?? []).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw Object.assign(new Error('slot_body() requires one JSON object'), { code: 'INVALID_SLOT_BODY_EFFECT' });
    }
    const sourceProgramPath = typeof entry.__sourceProgramPath === 'string'
      ? entry.__sourceProgramPath
      : program.path;
    const publicEntry = Object.fromEntries(Object.entries(entry).filter(([key]) => (
      key !== '__sourceProgramPath'
    )));
    const keys = Object.keys(publicEntry).sort();
    const required = entry.action === 'print'
      ? ['action', 'body', 'name']
      : ['action', 'body'];
    const allowed = entry.action === 'print'
      ? [...required, 'revision']
      : [...required];
    const invalidLegacyRevision = entry.revision !== undefined
      && (typeof entry.revision !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(entry.revision));
    if (!['seal', 'print'].includes(entry.action)
      || typeof entry.body !== 'string' || !entry.body.trim()
      || keys.some((key) => !allowed.includes(key))
      || required.some((key) => !keys.includes(key))
      || (entry.action === 'print'
        && (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.includes('/')
          || invalidLegacyRevision))) {
      throw Object.assign(new Error('slot_body() requires seal {action,body} or a current-print Program effect {action,body,name} with an optional legacy revision'), {
        code: 'INVALID_SLOT_BODY_EFFECT'
      });
    }
    return {
      ...structuredClone(publicEntry),
      body: entry.body.trim(),
      ...(entry.action === 'print' ? { name: entry.name.trim() } : {}),
      sourceProgramPath,
      ...(scopeRoot ? { sourceScopeRoot: scopeRoot } : {})
    };
  });
  const choiceIds = new Set();
  const choices = (result.choices ?? []).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw Object.assign(new Error('choice() requires one JSON object'), { code: 'INVALID_PROGRAM_CHOICE' });
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id || choiceIds.has(id)) {
      throw Object.assign(new Error('choice.id must be non-empty and unique within one Program'), { code: 'INVALID_PROGRAM_CHOICE_ID' });
    }
    choiceIds.add(id);
    if (entry.multiple === false) {
      throw Object.assign(new Error('choice.multiple=false is not supported yet'), { code: 'UNSUPPORTED_PROGRAM_CHOICE_MODE' });
    }
    if (!Array.isArray(entry.options) || entry.options.length === 0) {
      throw Object.assign(new Error('choice.options must be a non-empty array'), { code: 'INVALID_PROGRAM_CHOICE_OPTIONS' });
    }
    const optionIds = new Set();
    const options = entry.options.map((option) => {
      const optionId = typeof option?.id === 'string' ? option.id.trim() : '';
      const label = typeof option?.label === 'string' ? option.label.trim() : '';
      if (!optionId || !label || optionIds.has(optionId)) {
        throw Object.assign(new Error('Every choice option requires a unique id and non-empty label'), { code: 'INVALID_PROGRAM_CHOICE_OPTION' });
      }
      optionIds.add(optionId);
      return { id: optionId, label };
    });
    const selected = entry.selected ?? [];
    if (!Array.isArray(selected) || new Set(selected).size !== selected.length
      || selected.some((optionId) => typeof optionId !== 'string' || !optionIds.has(optionId))) {
      throw Object.assign(new Error('choice.selected must contain unique declared option ids'), { code: 'INVALID_PROGRAM_CHOICE_SELECTED' });
    }
    if (entry.empty !== undefined && (typeof entry.empty !== 'string' || !entry.empty.trim())) {
      throw Object.assign(new Error('choice.empty must be a non-empty string'), { code: 'INVALID_PROGRAM_CHOICE_EMPTY' });
    }
    return {
      id,
      options,
      selected: [...selected],
      empty: entry.empty?.trim() || '未选择',
      multiple: true,
      sourceProgramPath: program.path
    };
  });
  const jumps = (result.jumps ?? []).map((entry) => {
    const moveTargets = [entry?.destinationPath, entry?.authorizationPath]
      .filter((value) => value !== undefined);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !['guard', 'move', 'recycle'].includes(entry.action)
      || (entry.action === 'move'
        && (moveTargets.length !== 1
          || typeof moveTargets[0] !== 'string'
          || !recordsByPath.has(moveTargets[0])
          || (entry.authorizationPath !== undefined
            && !recordsByPath.get(entry.authorizationPath)?.types.includes('jump-authorization'))))
      || (entry.action !== 'move'
        && (entry.destinationPath !== undefined || entry.authorizationPath !== undefined))) {
      throw Object.assign(new Error('jump() returned an invalid window effect'), {
        code: 'INVALID_WINDOW_JUMP_EFFECT'
      });
    }
    return {
      action: entry.action,
      ...(entry.action === 'move' && entry.destinationPath !== undefined
        ? { destinationPath: entry.destinationPath } : {}),
      ...(entry.action === 'move' && entry.authorizationPath !== undefined
        ? { authorizationPath: entry.authorizationPath } : {}),
      sourceProgramPath: program.path
    };
  });
  const jumpAuthorizations = (result.jumpAuthorizations ?? []).map((entry) => {
    const sourceProgramPath = typeof entry?.__sourceProgramPath === 'string'
      ? entry.__sourceProgramPath : program.path;
    const window = recordsByPath.get(entry?.windowPath);
    const source = recordsByPath.get(entry?.sourcePath);
    const destination = recordsByPath.get(entry?.destinationPath);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !window?.types.includes('agent') || !source?.types.includes('program') || !destination
      || !recordsByPath.get(sourceProgramPath)?.types.includes('program')
      || !source.path.startsWith(`${window.path}/`)) {
      throw Object.assign(new Error('jump_authorize() returned an invalid controlled migration effect'), {
        code: 'INVALID_JUMP_AUTHORIZATION_EFFECT'
      });
    }
    return {
      windowPath: window.path,
      sourcePath: source.path,
      destinationPath: destination.path,
      issuerProgramPath: sourceProgramPath
    };
  });
  const agentRegistrations = (result.agents ?? []).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !Array.isArray(entry.labels) || !Array.isArray(entry.functions)
      || !entry.functionScopes || typeof entry.functionScopes !== 'object'
      || !Array.isArray(entry.functionScopes.groups)
      || !Array.isArray(entry.functionScopes.names)
      || entry.functionScopes.groups.some((group) => typeof group !== 'string' || !group)
      || entry.functionScopes.names.some((name) => typeof name !== 'string' || !name)
      || entry.labels.some((label) => typeof label !== 'string' || !label)
      || entry.functions.length === 0
      || entry.functions.some((name) => typeof name !== 'string' || !name)) {
      throw Object.assign(new Error('agent() returned an invalid registration effect'), {
        code: 'INVALID_AGENT_REGISTRATION'
      });
    }
    return {
      sourceProgramPath: program.path,
      labels: [...new Set(entry.labels)],
      functionScopes: {
        groups: [...new Set(entry.functionScopes.groups)].sort(),
        names: [...new Set(entry.functionScopes.names)].sort()
      },
      functions: [...new Set(entry.functions)].sort()
    };
  });
  const changedThings = [...new Set(result.changedThings ?? [])];
  if (changedThings.some((entry) => typeof entry !== 'string' || !recordsByPath.has(entry))) {
    throw Object.assign(new Error('changed() returned an unknown exact Thing coordinate'), {
      code: 'INVALID_CHANGED_THING'
    });
  }
  const trigger = result.trigger == null ? null : structuredClone(result.trigger);
  if (supportDecision === true) {
    if ([locks, messages, transforms, shortcuts, slotBodies, choices, jumps, agentRegistrations].some((entries) => entries.length > 0)) {
      throw Object.assign(new Error('Support antecedent Program may only return bool and cannot emit effects'), {
        code: 'PROGRAM_SUPPORT_EFFECT_FORBIDDEN', details: { program: program.path }
      });
    }
    if (typeof result.supportDecision !== 'boolean') {
      throw Object.assign(new Error('Support antecedent Program must return a strict JSON boolean'), {
        code: 'INVALID_PROGRAM_SUPPORT_RESULT', details: { program: program.path }
      });
    }
  }
  return {
    locks, messages, transforms, shortcuts, slotBodies, choices, jumps, jumpAuthorizations,
    agentRegistrations, changedThings, trigger,
    ...(supportDecision === true ? { supportDecision: result.supportDecision } : {})
  };
}

function runWorker({
  python, records, programs, program, timeoutMs, executeExplore, validateOnly = false,
  triggered = false, changedNodes = [], scopeRoot = null, programRoot = null,
  invokeMain = false, programArguments = {}, supportDecision = false,
  allowedFunctions = null, resolveExactPath = null
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-X', 'utf8', workerFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });
    let stdout = '';
    let stderr = '';
    let workerClosed = false;
    let protocolError = null;
    const writeToWorker = (payload) => {
      if (workerClosed || child.stdin.destroyed || !child.stdin.writable) return false;
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      return true;
    };
    const timer = setTimeout(() => {
      workerClosed = true;
      child.kill();
      const error = new Error(`Program cycle exceeded ${timeoutMs}ms`);
      error.code = 'ATOM_PROGRAM_TIMEOUT';
      reject(error);
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let handling = Promise.resolve();
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const lines = stdout.split('\n');
      stdout = lines.pop();
      for (const line of lines.filter(Boolean)) {
        handling = handling.then(async () => {
          const event = JSON.parse(line);
          if (event.type === 'call') {
            try {
              if (event.function !== 'explore') throw new Error(`Unsupported Program call: ${event.function}`);
              const result = await executeExplore(event.request);
              writeToWorker({ id: event.id, ok: true, result });
            } catch (error) {
              writeToWorker({ id: event.id, ok: false, error: { code: error.code, message: error.message } });
            }
            return;
          }
          child.__atomResult = event;
        }).catch((error) => {
          protocolError ??= Object.assign(
            new Error(`Python Program emitted invalid JSON protocol: ${error.message}`),
            { code: 'ATOM_PROGRAM_PROTOCOL_INVALID_JSON' }
          );
        });
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdin.on('error', () => {
      workerClosed = true;
    });
    child.on('error', (error) => {
      workerClosed = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', async (code) => {
      workerClosed = true;
      clearTimeout(timer);
      await handling;
      if (protocolError) {
        reject(protocolError);
        return;
      }
      if (code !== 0) {
        reject(Object.assign(new Error(stderr || `Python worker exited ${code}`), { code: 'ATOM_PROGRAM_WORKER_FAILED' }));
        return;
      }
      try {
        resolve(validateProgramResult(child.__atomResult ?? JSON.parse(stdout), records, program, {
          scopeRoot, supportDecision, resolveExactPath
        }));
      } catch (error) {
        reject(error);
      }
    });
    writeToWorker({
      world: programs ?? programRecords(records),
      program,
      validateOnly,
      triggered,
      changedNodes,
      programRoot,
      invokeMain,
      programArguments,
      supportDecision,
      ...(allowedFunctions ? { allowedFunctions } : {})
    });
  });
}

function describeProgramFailure(error, program) {
  const jumpFailure = programUsesJump(program);
  return {
    code: error?.code === 'INVALID_JUMP_CONTRACT'
      ? error.code
      : jumpFailure ? 'WINDOW_JUMP_DESTINATION_INVALID' : error?.code ?? 'ATOM_PROGRAM_FAILED',
    message: error?.message ?? 'Python Program failed',
    programRef: program.ref,
    programPath: program.path,
    type: error?.details?.type,
    details: { ...(error?.details ?? {}), program: program.path }
  };
}

export class ProgramRuntimeScheduler {
  constructor(options = {}) {
    this.python = options.python ?? 'python';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.completed = new Map();
    this.inflight = new Map();
    this.maxCompleted = options.maxCompleted ?? 8;
    this.maxWorkers = options.maxWorkers ?? DEFAULT_MAX_WORKERS;
    this.activeWorkers = 0;
    this.workerQueue = [];
    this.reusable = new Map();
    this.programReusable = new Map();
    this.dormantFailures = new Map();
    this.runProgram = options.runProgram ?? runWorker;
    this.inspectProgram = options.inspectProgram ?? runWorker;
    this.diagnosticRecorder = options.diagnosticRecorder ?? null;
    this.projectionRepository = options.projectionRepository ?? null;
    this.loadedProjection = undefined;
    this.projectionLoadWarning = null;
    this.requestDrivenLockRepository = options.requestDrivenLockRepository ?? null;
    this.requestDrivenLocks = undefined;
    this.requestDrivenLocksWorldRevision = null;
    this.requestDrivenLockRetirementChecked = false;
    this.triggerContracts = new Map();
    this.triggerIndex = new Map();
    this.programReadDependencies = new Map();
    this.triggerContractsInitialized = false;
    this.deferredTriggerContracts = new Map();
    this.slotInvocationCycles = new Map();
    this.agentSecurity = new Map();
    this.agentSecurityWorldRevision = null;
    this.latestRecords = null;
    if (this.projectionRepository
      && (typeof this.projectionRepository.load !== 'function'
        || typeof this.projectionRepository.save !== 'function')) {
      throw Object.assign(
        new Error('Program projection repository requires load() and save()'),
        { code: 'INVALID_PROGRAM_PROJECTION_REPOSITORY' }
      );
    }
    if (this.diagnosticRecorder && typeof this.diagnosticRecorder.record !== 'function') {
      throw Object.assign(
        new Error('Program diagnostic recorder requires record()'),
        { code: 'INVALID_PROGRAM_DIAGNOSTIC_RECORDER' }
      );
    }
    if (this.requestDrivenLockRepository
      && (typeof this.requestDrivenLockRepository.load !== 'function'
        || typeof this.requestDrivenLockRepository.save !== 'function')) {
      throw Object.assign(new Error('Request-driven lock repository requires load() and save()'), {
        code: 'INVALID_REQUEST_DRIVEN_LOCK_REPOSITORY'
      });
    }
  }

  async evaluateSupportProgram(atoms, selector, options = {}) {
    const records = worldRecords(atoms);
    const [program] = programRecords(records, selector);
    const preparedWorld = options.executeExplore ? null : prepareExploreWorld(atoms);
    const executeExplore = options.executeExplore ?? ((request) => executeProgramExplore({
      atoms, request, preparedWorld
    }));
    const result = await this.runBounded(() => this.runProgram({
      python: this.python,
      records,
      programs: programRecords(records),
      program,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      executeExplore: async (request) => {
        const matches = await executeExplore(request, {
          scopeRoot: options.scopeRoot ?? null,
          programPath: selector
        });
        const byPath = new Map(records.map((record) => [record.path, record]));
        return matches.map((match) => programExploreRecord(match, byPath)).filter(Boolean);
      },
      scopeRoot: options.scopeRoot ?? null,
      programRoot: options.programRoot ?? null,
      supportDecision: true,
      triggered: true
    }));
    return result.supportDecision;
  }

  async rebuildAgentSecurity(atoms) {
    const records = worldRecords(atoms);
    const programs = programRecords(records);
    const registeredPrograms = programs.filter((program) => program.types.includes('agent'));
    const fingerprint = agentSecurityFingerprint(registeredPrograms);
    if (this.agentSecurityWorldRevision === fingerprint) return this.agentSecurity;
    const registrations = await Promise.all(registeredPrograms.map((program) => (
      this.runBounded(() => this.inspectProgram({
        python: this.python,
        records,
        programs: [program],
        program,
        timeoutMs: this.timeoutMs,
        executeExplore: async () => {
          throw Object.assign(
            new Error('Agent registration reconstruction cannot execute Graph functions'),
            { code: 'INVALID_AGENT_REGISTRATION_RECONSTRUCTION_EFFECT' }
          );
        },
        validateOnly: true
      }))
    )));
    const next = new Map();
    for (const [index, program] of registeredPrograms.entries()) {
      const declarations = registrations[index].agentRegistrations ?? [];
      if (declarations.length !== 1) {
        throw Object.assign(
          new Error(`Registered Agent Program requires exactly one literal agent() declaration: ${program.path}`),
          { code: 'AGENT_REGISTRATION_SOURCE_REQUIRED' }
        );
      }
      const registration = declarations[0];
      next.set(program.path, {
        labels: [...registration.labels],
        functionScopes: structuredClone(registration.functionScopes),
        functions: [...registration.functions]
      });
    }
    this.agentSecurity = next;
    this.agentSecurityWorldRevision = fingerprint;
    return this.agentSecurity;
  }

  async inspectAgentRegistration(atoms, selector) {
    const records = worldRecords(atoms);
    const programs = programRecords(records);
    const program = programs.find((entry) => entry.path === selector);
    if (!program?.types.includes('agent')) {
      throw Object.assign(
        new Error(`Registered Agent Program was not found: ${selector}`),
        { code: 'AGENT_REGISTRATION_PROGRAM_NOT_FOUND' }
      );
    }
    const inspected = await this.runBounded(() => this.inspectProgram({
      python: this.python,
      records,
      programs,
      program,
      timeoutMs: this.timeoutMs,
      executeExplore: async () => {
        throw Object.assign(
          new Error('Agent registration inspection cannot execute Graph functions'),
          { code: 'INVALID_AGENT_REGISTRATION_RECONSTRUCTION_EFFECT' }
        );
      },
      validateOnly: true
    }));
    const declarations = inspected.agentRegistrations ?? [];
    if (declarations.length !== 1) {
      throw Object.assign(
        new Error(`Registered Agent Program requires exactly one literal agent() declaration: ${selector}`),
        { code: 'AGENT_REGISTRATION_SOURCE_REQUIRED' }
      );
    }
    return structuredClone(declarations[0]);
  }

  async assertContextFreeProjection(atoms, { isolateFailures = true } = {}) {
    if (!this.projectionRepository) return Object.freeze({ persisted: false });
    const records = worldRecords(atoms);
    const programs = programRecords(records);
    const stored = await this.projectionRepository.load();
    if (!stored
      || stored.worldKey !== worldRevisionKey(records)
      || stored.programSetKey !== programSetFingerprint(programs, isolateFailures, records)
      || stored.contextDependent !== false
      || !Array.isArray(stored.failures)
      || stored.failures.length > 0) {
      throw Object.assign(
        new Error('The committed world does not have a consumable context-free Program projection'),
        {
          code: 'ATOM_PROGRAM_PROJECTION_MISSING',
          details: { worldKey: worldRevisionKey(records) }
        }
      );
    }
    this.loadedProjection = structuredClone(stored);
    return Object.freeze({ persisted: true, worldKey: stored.worldKey });
  }

  async persistComputedContextFreeProjection(atoms, { isolateFailures = true } = {}) {
    if (!this.projectionRepository) return Object.freeze({ persisted: false });
    const records = worldRecords(atoms);
    const programs = programRecords(records);
    const key = fingerprint(records, programs, null, isolateFailures);
    const value = this.completed.get(key);
    const requests = value?.exploreRequests ?? [];
    if (!value
      || (value.failures?.length ?? 0) > 0
      || requestsDependOnAgent(requests)
      || (value.jumps?.length ?? 0) > 0) {
      throw Object.assign(
        new Error('No computed context-free Program projection is available for persistence'),
        { code: 'ATOM_PROGRAM_PROJECTION_MISSING', details: { worldKey: worldRevisionKey(records) } }
      );
    }
    const warning = await this.saveProjection({
      records,
      programs,
      isolateFailures,
      value,
      requests,
      agentOrigin: null
    });
    if (warning) {
      throw Object.assign(new Error(warning.message), {
        code: warning.code,
        details: warning.details ?? {}
      });
    }
    return this.assertContextFreeProjection(atoms, { isolateFailures });
  }

  async rebaseContextFreeProjection(previousAtoms, atoms, {
    changedPaths = [], isolateFailures = true, previousRevision = null, revision = null
  } = {}) {
    if (!this.projectionRepository) return Object.freeze({ persisted: false, reason: 'unavailable' });
    const stored = await this.projectionRepository.load();
    if (previousRevision && revision
      && stored
      && stored.worldKey === worldKeyFromRevision(previousRevision, previousAtoms)
      && stored.contextDependent === false
      && Array.isArray(stored.failures)
      && stored.failures.length === 0
      && localProjectionRebaseEligible(previousAtoms, atoms, changedPaths, stored)) {
      const projection = {
        ...structuredClone(stored),
        worldKey: worldKeyFromRevision(revision, atoms),
        locks: rebindPathLocks(stored.locks ?? [], atoms, revision)
      };
      try {
        await this.projectionRepository.save(projection);
      } catch {
        return Object.freeze({ persisted: false, reason: 'persist-failed' });
      }
      this.loadedProjection = structuredClone(projection);
      return Object.freeze({ persisted: true, worldKey: projection.worldKey, local: true });
    }
    const previousRecords = worldRecords(previousAtoms);
    const records = worldRecords(atoms);
    const previousPrograms = programRecords(previousRecords);
    const programs = programRecords(records);
    if (!stored
      || stored.worldKey !== worldRevisionKey(previousRecords)
      || stored.contextDependent !== false
      || !Array.isArray(stored.failures)
      || stored.failures.length > 0) {
      return Object.freeze({ persisted: false, reason: 'projection-stale' });
    }
    const previousProgramSet = programSetFingerprint(
      previousPrograms, isolateFailures, previousRecords
    );
    const nextProgramSet = programSetFingerprint(programs, isolateFailures, records);
    if (stored.programSetKey !== previousProgramSet || nextProgramSet !== previousProgramSet) {
      return Object.freeze({ persisted: false, reason: 'program-set-changed' });
    }
    const readPaths = new Set(stored.exploreReadPaths ?? []);
    if (changedPaths.some((path) => readPaths.has(path))) {
      return Object.freeze({ persisted: false, reason: 'dependency-changed' });
    }
    const value = {
      locks: rebindLocks(stored.locks ?? [], previousRecords, records),
      choices: structuredClone(stored.choices ?? []),
      exploreReadPaths: structuredClone(stored.exploreReadPaths ?? []),
      failures: [],
      contextIncomplete: stored.contextIncomplete === true
    };
    const warning = await this.saveProjection({
      records,
      programs,
      isolateFailures,
      value,
      requests: [],
      agentOrigin: null
    });
    if (warning) return Object.freeze({ persisted: false, reason: 'persist-failed' });
    return Object.freeze({ persisted: true, worldKey: worldRevisionKey(records) });
  }

  async rebuildRequestDrivenLocks(atoms) {
    await this.rebuildAgentSecurity(atoms);
    const records = worldRecords(atoms);
    const resolveExactPath = (selector) => resolveExactPathFromCurrentContext(atoms, selector);
    const programs = programRecords(records);
    const lockPrograms = programs.filter((program) => /\block\s*\(/u.test(program.detail));
    const fingerprint = requestDrivenLockFingerprint(
      records, lockPrograms, this.agentSecurityWorldRevision, this.requestDrivenLocks
    );
    if (this.requestDrivenLocksWorldRevision === fingerprint) return this.requestDrivenLocks ?? [];
    const inspected = await Promise.all(lockPrograms.map((program) => (
      this.runBounded(() => {
        const enclosingAgent = [...this.agentSecurity.entries()]
          .filter(([agentPath]) => (
            program.path === agentPath || program.path.startsWith(`${agentPath}/`)
          ))
          .sort(([left], [right]) => right.length - left.length)[0]?.[1] ?? null;
        const allowedFunctions = enclosingAgent
          ? [...new Set([
            ...enclosingAgent.functions,
            ...(program.types.includes('agent') ? ['agent'] : [])
          ])]
          : null;
        return this.inspectProgram({
          python: this.python,
          records,
          programs: [program],
          program,
          timeoutMs: this.timeoutMs,
          allowedFunctions,
          resolveExactPath,
          executeExplore: async () => {
            throw Object.assign(
              new Error('Persistent lock reconstruction cannot execute Graph functions'),
              { code: 'INVALID_REQUEST_DRIVEN_LOCK_RECONSTRUCTION_EFFECT' }
            );
          },
          validateOnly: true
        });
      })
    )));
    const next = inspected.flatMap((result) => result.locks).sort((left, right) => (
      left.sourceProgramPath.localeCompare(right.sourceProgramPath)
      || JSON.stringify(left.targets ?? { path: left.path, kind: left.kind })
        .localeCompare(JSON.stringify(right.targets ?? { path: right.path, kind: right.kind }))
    ));
    this.requestDrivenLocks = next;
    this.requestDrivenLocksWorldRevision = requestDrivenLockFingerprint(
      records, lockPrograms, this.agentSecurityWorldRevision, next
    );
    return this.requestDrivenLocks;
  }

  async activeRequestDrivenLocks(atoms = null, options = {}) {
    const reusePreparedIndexes = options.preparedIndexesValid === true && this.latestRecords;
    if (atoms && !reusePreparedIndexes) {
      await this.rebuildAgentSecurity(atoms);
      await this.rebuildRequestDrivenLocks(atoms);
    }
    if (this.requestDrivenLockRepository && !this.requestDrivenLockRetirementChecked) {
      await this.requestDrivenLockRepository.load();
      this.requestDrivenLockRetirementChecked = true;
    }
    return this.requestDrivenLocks ?? [];
  }

  hasPreparedIndexesForRevision(revision, atoms = []) {
    return Boolean(
      this.latestRecords
      && this.requestDrivenLocks !== undefined
      && this.agentSecurityWorldRevision !== null
      && worldRevisionKey(this.latestRecords) === worldKeyFromRevision(revision, atoms)
    );
  }

  async registerAgentWindow({ sourceProgramPath, labels, functionScopes, functions }) {
    this.agentSecurity.set(sourceProgramPath, {
      labels: [...labels], functionScopes: structuredClone(functionScopes), functions: [...functions]
    });
    this.agentSecurityWorldRevision = null;
  }

  async recycleAgentWindow(agentPath) {
    this.agentSecurity.delete(agentPath);
    this.agentSecurityWorldRevision = null;
  }

  async remapAgentWindow(previousPath, nextPath) {
    const security = this.agentSecurity.get(previousPath);
    this.agentSecurity.delete(previousPath);
    if (security) this.agentSecurity.set(nextPath, security);
    this.agentSecurityWorldRevision = null;
  }

  async overlayRequestDrivenLocks(value, agentOrigin = null) {
    const active = await this.activeRequestDrivenLocks();
    return {
      ...value,
      locks: mergeDerivedLocks(value.locks ?? [], active),
      agentSecurity: (() => {
        const scopePath = agentScopePath(agentOrigin);
        return scopePath ? structuredClone(this.agentSecurity.get(scopePath) ?? null) : null;
      })()
    };
  }

  async mergeRequestDrivenLocks(value, records, options) {
    const active = await this.activeRequestDrivenLocks();
    value.locks = mergeDerivedLocks(value.locks, active);
    return value;
  }

  async runBounded(operation) {
    if (this.activeWorkers >= this.maxWorkers) {
      await new Promise((resolve) => this.workerQueue.push(resolve));
    }
    this.activeWorkers += 1;
    try {
      return await operation();
    } finally {
      this.activeWorkers -= 1;
      this.workerQueue.shift()?.();
    }
  }

  async validateProgramSources(atoms, previousAtoms = []) {
    const records = worldRecords(atoms);
    const resolveExactPath = (selector) => resolveExactPathFromCurrentContext(atoms, selector);
    const previousRecords = worldRecords(previousAtoms);
    const previousByPath = new Map(previousRecords.map((record) => [record.path, record]));
    const activePrograms = programRecords(records);
    const activeProgramPaths = new Set(activePrograms.map((record) => record.path));
    const programs = records.filter((record) => (
      record.types.includes('program')
      && activeProgramPaths.has(record.path)
      && record.detail.trim()
      && (() => {
        const previous = previousByPath.get(record.path);
        return !previous
          || previous.detail !== record.detail
          || !previous.types.includes('program');
      })()
    ));
    const validated = await Promise.all(programs.map((program) => this.runBounded(() => this.runProgram({
      python: this.python,
      records,
      programs: activePrograms,
      program,
      timeoutMs: this.timeoutMs,
      resolveExactPath,
      executeExplore: async () => {
        throw Object.assign(
          new Error('Program validation cannot execute Graph functions'),
          { code: 'INVALID_PROGRAM_VALIDATION_EFFECT' }
        );
      },
      validateOnly: true
    }))));
    for (const [index, program] of programs.entries()) {
      if (/\bchanged\s*\(/u.test(program.detail)) {
        this.removeTriggerContract(program.path);
        this.triggerContractsInitialized = false;
      } else {
        this.setTriggerContract(program, validated[index].trigger ?? null);
      }
    }
    const activePaths = new Set(records.map((record) => record.path));
    for (const path of this.triggerContracts.keys()) {
      if (!activePaths.has(path)) this.removeTriggerContract(path);
    }
  }

  removeTriggerContract(programPath) {
    this.deferredTriggerContracts.delete(programPath);
    const existing = this.triggerContracts.get(programPath);
    if (existing) {
      const indexed = [
        ...(existing.contract?.parameters?.nodes ?? []).map((node) => ({
          mode: existing.contract.mode, node
        })),
        ...(existing.changedThings ?? []).map((node) => ({ mode: 'transform', node }))
      ];
      for (const { mode, node } of indexed) {
        const key = `${mode}\0${node}`;
        const paths = this.triggerIndex.get(key);
        paths?.delete(programPath);
        if (paths?.size === 0) this.triggerIndex.delete(key);
      }
    }
    this.triggerContracts.delete(programPath);
  }

  setTriggerContract(program, contract, changedThings = []) {
    this.removeTriggerContract(program.path);
    this.triggerContracts.set(program.path, {
      detail: program.detail, contract, changedThings: [...new Set(changedThings)]
    });
    const indexed = [
      ...(contract?.parameters?.nodes ?? []).map((node) => ({ mode: contract.mode, node })),
      ...[...new Set(changedThings)].map((node) => ({ mode: 'transform', node }))
    ];
    for (const { mode, node } of indexed) {
      const key = `${mode}\0${node}`;
      const paths = this.triggerIndex.get(key) ?? new Set();
      paths.add(program.path);
      this.triggerIndex.set(key, paths);
    }
  }

  backfillTriggerIndexForEvent(triggerEvent) {
    if (!triggerEvent) return 0;
    let backfilled = 0;
    for (const node of triggerEvent.nodes ?? []) {
      const key = `${triggerEvent.mode}\0${node}`;
      if (this.triggerIndex.has(key)) continue;
      const matches = new Set();
      for (const [programPath, entry] of this.triggerContracts) {
        const contractMatch = entry.contract?.mode === triggerEvent.mode
          && entry.contract.parameters?.nodes?.includes(node);
        const changedMatch = triggerEvent.mode === 'transform'
          && entry.changedThings?.includes(node);
        if (contractMatch || changedMatch) matches.add(programPath);
      }
      if (matches.size) {
        this.triggerIndex.set(key, matches);
        backfilled += matches.size;
      }
    }
    return backfilled;
  }

  async ensureTriggerContracts(records, programs, executeExplore, agentOrigin = null) {
    if (this.triggerContractsInitialized) return;
    const recordsByPath = new Map(records.map((record) => [record.path, record]));
    const deferredContext = [
      worldRevisionKey(records),
      agentScopePath(agentOrigin) ?? '',
      this.agentSecurityWorldRevision ?? ''
    ].join('\0');
    const candidates = programs.filter((program) => (
      /\b(?:trigger|changed)\s*\(/u.test(program.detail)
      && this.triggerContracts.get(program.path)?.detail !== program.detail
      && (this.deferredTriggerContracts.get(program.path)?.context !== deferredContext
        || this.deferredTriggerContracts.get(program.path)?.detail !== program.detail)
    ));
    const inspected = await Promise.allSettled(candidates.map((program) => this.runBounded(() => (
      this.runProgram({
        python: this.python,
        records,
        programs: programMayResolveAnotherProgram(program) ? programs : [program],
        program,
        timeoutMs: this.timeoutMs,
        executeExplore: async (request) => {
          const matches = await executeExplore(request);
          return matches.map((match) => {
            const record = programExploreRecord(match, recordsByPath);
            if (!record) {
              throw Object.assign(
                new Error(`Program explore returned an unknown path: ${match.path}`),
                { code: 'INVALID_PROGRAM_EXPLORE_RESULT' }
              );
            }
            return record;
          });
        },
        validateOnly: !/\bchanged\s*\(/u.test(program.detail),
        changedNodes: []
      })
    ))));
    for (const [index, program] of candidates.entries()) {
      const result = inspected[index];
      if (result.status === 'rejected') {
        if (result.reason?.code !== 'WINDOW_ACCESS_DENIED') throw result.reason;
        this.deferredTriggerContracts.set(program.path, {
          context: deferredContext,
          detail: program.detail
        });
        continue;
      }
      this.setTriggerContract(
        program,
        result.value.trigger ?? null,
        result.value.changedThings ?? []
      );
    }
    const stillDeferred = programs.some((program) => {
      const deferred = this.deferredTriggerContracts.get(program.path);
      return deferred?.context === deferredContext && deferred.detail === program.detail;
    });
    this.triggerContractsInitialized = !stillDeferred;
  }

  async loadProjection() {
    if (this.loadedProjection !== undefined) return this.loadedProjection;
    try {
      this.loadedProjection = this.projectionRepository
        ? await this.projectionRepository.load()
        : null;
    } catch (error) {
      this.loadedProjection = null;
      this.projectionLoadWarning = {
        code: 'PROGRAM_PROJECTION_LOAD_FAILED',
        message: 'Replaceable Program projection was unreadable and will be rebuilt',
        details: { cause: error?.code ?? error?.name ?? 'PROGRAM_PROJECTION_READ_FAILED' }
      };
    }
    return this.loadedProjection;
  }

  async persistedProjection({
    records, programs, isolateFailures, fingerprint: cycleFingerprint, agentOrigin,
    allowContextIncomplete = false
  }) {
    const stored = await this.loadProjection();
    const programSetKey = programSetFingerprint(programs, isolateFailures, records);
    if (!stored || stored.version !== 1
      || stored.worldKey !== worldRevisionKey(records)
      || stored.programSetKey !== programSetKey
      || (!allowContextIncomplete
        && stored.contextIncomplete === true && agentScopePath(agentOrigin))
      || (stored.contextDependent === true
        && stored.scopePath !== agentScopePath(agentOrigin))
      || !Array.isArray(stored.locks)
      || !Array.isArray(stored.failures)
      || stored.failures.length > 0) {
      return null;
    }
    return this.overlayRequestDrivenLocks({
      fingerprint: cycleFingerprint,
      cached: true,
      records,
      selectedProgram: null,
      locks: structuredClone(stored.locks),
      choices: structuredClone(stored.choices ?? []),
      exploreReadPaths: structuredClone(stored.exploreReadPaths ?? []),
      messages: [],
      transforms: [],
      shortcuts: [],
      slotBodies: [],
      failures: structuredClone(stored.failures),
      contextIncomplete: stored.contextIncomplete === true
    }, agentOrigin);
  }

  async saveProjection({ records, programs, isolateFailures, value, requests, agentOrigin }) {
    if (!this.projectionRepository) return;
    const contextDependent = requestsDependOnAgent(requests);
    const scopePath = contextDependent ? agentScopePath(agentOrigin) : null;
    if (contextDependent && !scopePath) return;
    const projection = {
      version: 1,
      readSetVersion: 1,
      worldKey: worldRevisionKey(records),
      programSetKey: programSetFingerprint(programs, isolateFailures, records),
      contextDependent,
      contextIncomplete: value.contextIncomplete === true,
      scopePath,
      locks: structuredClone(value.locks.filter((lock) => lock.refresh?.policy !== 'on_request')),
      choices: structuredClone(value.choices ?? []),
      exploreReadPaths: structuredClone(value.exploreReadPaths ?? []),
      failures: []
    };
    try {
      await this.projectionRepository.save(projection);
      this.loadedProjection = projection;
      return null;
    } catch (error) {
      return {
        code: 'PROGRAM_PROJECTION_PERSIST_FAILED',
        message: 'Validated Program projection remains available in memory but could not be persisted',
        details: { cause: error?.code ?? error?.name ?? 'PROGRAM_PROJECTION_WRITE_FAILED' }
      };
    }
  }

  async current(atoms, options = {}) {
    const reusePreparedIndexes = options.preparedIndexesValid === true && this.latestRecords;
    await this.activeRequestDrivenLocks(reusePreparedIndexes ? null : atoms);
    const records = reusePreparedIndexes ? this.latestRecords : worldRecords(atoms);
    if (!reusePreparedIndexes) this.latestRecords = records;
    const availablePrograms = programRecords(records);
    const programs = options.programSelector
      ? programRecords(records, options.programSelector)
      : availablePrograms;
    const isolateFailures = options.isolateFailures === true;
    const key = fingerprint(records, programs, options.agentOrigin, isolateFailures);
    const completed = this.completed.get(key);
    if (completed) return this.overlayRequestDrivenLocks({
      ...completed, cached: true, messages: [], transforms: [], shortcuts: [], slotBodies: []
    }, options.agentOrigin);

    const reusable = reusableCandidates(
      this.reusable, programs, isolateFailures, options.agentOrigin, records,
      availablePrograms
    ).map(([, entry]) => entry).find((entry) => (
      entry.worldKey === worldRevisionKey(records)
    ));
    if (reusable?.worldKey === worldRevisionKey(records)) {
      const value = await this.overlayRequestDrivenLocks({
        ...reusable.value,
        fingerprint: key,
        cached: true,
        records,
        locks: rebindLocks(reusable.value.locks, reusable.value.records, records),
        choices: structuredClone(reusable.value.choices ?? []),
        messages: [],
        transforms: [],
        shortcuts: [],
        slotBodies: [],
        failures: structuredClone(reusable.value.failures ?? [])
      }, options.agentOrigin);
      this.completed.set(key, value);
      return value;
    }

    const persisted = options.programSelector
      ? null
      : await this.persistedProjection({
        records, programs, isolateFailures, fingerprint: key, agentOrigin: options.agentOrigin,
        allowContextIncomplete: options.allowContextIncomplete === true
      });
    if (persisted) {
      this.completed.set(key, persisted);
      return persisted;
    }
    if (options.allowWindowLockSnapshot === true) {
      await this.activeRequestDrivenLocks();
      const scopePath = agentScopePath(options.agentOrigin);
      if (scopePath && this.agentSecurity.has(scopePath)) {
        return this.overlayRequestDrivenLocks({
          fingerprint: key,
          cached: true,
          records,
          selectedProgram: null,
          locks: [],
          choices: [],
          messages: [],
          transforms: [],
          shortcuts: [],
          slotBodies: [],
          failures: [],
          exploreReadPaths: [],
          contextIncomplete: true,
          windowLockSnapshotOnly: true
        }, options.agentOrigin);
      }
    }
    const error = new Error('No validated Program projection exists for the current world revision');
    error.code = 'ATOM_PROGRAM_PROJECTION_MISSING';
    error.details = { worldKey: worldRevisionKey(records) };
    throw error;
  }

  async refresh(atoms, options = {}) {
    const preparedTriggerEvent = options.triggerEvent ?? null;
    if (preparedTriggerEvent?.preparedIndexesValid === true
      && this.triggerContractsInitialized
      && this.latestRecords
      && this.requestDrivenLocks !== undefined) {
      const triggerIndexBackfilled = this.backfillTriggerIndexForEvent(preparedTriggerEvent);
      const candidatePaths = new Set();
      for (const node of preparedTriggerEvent.nodes ?? []) {
        for (const programPath of this.triggerIndex.get(
          `${preparedTriggerEvent.mode}\0${node.trim()}`
        ) ?? []) candidatePaths.add(programPath);
      }
      const eventNodes = new Set((preparedTriggerEvent.nodes ?? []).map((node) => node.trim()));
      const activeScopePath = agentScopePath(options.agentOrigin);
      for (const [programPath, dependency] of this.programReadDependencies) {
        if (dependency.contextDependent === true && dependency.scopePath !== activeScopePath) continue;
        if (dependency.requests.some((request) => requestMayObserveEvent(request, eventNodes))) {
          candidatePaths.add(programPath);
        }
      }
      const slotCandidates = slotProgramInvocationsForEvent(atoms, preparedTriggerEvent);
      if (candidatePaths.size === 0 && slotCandidates.length === 0) {
        const locks = await this.activeRequestDrivenLocks();
        return {
          fingerprint: `prepared-index:${crypto.randomUUID()}`,
          cached: true,
          records: this.latestRecords,
          selectedProgram: null,
          locks,
          choices: [],
          messages: [],
          transforms: [],
          shortcuts: [],
          slotBodies: [],
          jumps: [],
          jumpAuthorizations: [],
          agentRegistrations: [],
          exploreRequests: [],
          exploreReadPaths: [],
          failures: [],
          executedProgramPaths: [],
          reconcileSummary: {
            candidateProgramCount: 0,
            executedProgramCount: 0,
            triggerIndexBackfilled,
            preparedIndexHit: true
          },
          contextIncomplete: false,
          agentSecurity: agentScopePath(options.agentOrigin)
            ? structuredClone(this.agentSecurity.get(agentScopePath(options.agentOrigin)) ?? null)
            : null
        };
      }
    }
    await this.activeRequestDrivenLocks(atoms);
    const records = worldRecords(atoms);
    this.latestRecords = records;
    const compatibility = legacyAtomContextMetadata(atoms);
    if (compatibility) {
      isolatedProgramPathsByRecords.set(records, new Set(compatibility.isolatedProgramPaths ?? []));
    }
    const availablePrograms = programRecords(records);
    const programs = options.programSelector
      ? programRecords(records, options.programSelector)
      : availablePrograms;
    const isolateFailures = options.isolateFailures === true;
    const baseKey = fingerprint(records, programs, options.agentOrigin, isolateFailures);
    const stableKey = options.slotScopeRoot || options.slotScopeRevision
      ? `${baseKey}:${options.slotScopeRoot ?? ''}:${options.slotScopeRevision ?? ''}`
      : baseKey;
    const key = options.force === true || options.triggerEvent
      ? `${stableKey}:${crypto.randomUUID()}`
      : stableKey;
    const completed = this.completed.get(key);
    if (completed && completed.failures.length === 0) {
      const cached = completed;
      return this.overlayRequestDrivenLocks({
        ...cached, cached: true, messages: [], transforms: [], shortcuts: [], slotBodies: []
      }, options.agentOrigin);
    }
    if (this.inflight.has(key)) {
      return this.inflight.get(key).then((value) => ({
        ...value, cached: true, messages: [], transforms: [], shortcuts: [], slotBodies: []
      }));
    }

    const pending = this.computeRefresh(atoms, options, {
      records, programs, availablePrograms, isolateFailures, key
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, pending);
    return pending;
  }

  async computeRefresh(atoms, options, {
    records, programs, availablePrograms, isolateFailures, key
  }) {
    const cycleDeadline = Date.now() + this.timeoutMs;
    const indexWorld = options.prepareAllIndexes === true ? prepareExploreWorld(atoms) : null;
    if (indexWorld) {
      await this.ensureTriggerContracts(
        records,
        programs,
        (request) => executeProgramExplore({ atoms, request, preparedWorld: indexWorld }),
        null
      );
    }
    if (options.force !== true && !options.programSelector && !options.triggerEvent) {
      const persisted = await this.persistedProjection({
        records, programs, isolateFailures, fingerprint: key, agentOrigin: options.agentOrigin,
        allowContextIncomplete: options.allowContextIncomplete === true
      });
      if (persisted) {
        this.completed.set(key, persisted);
        return persisted;
      }
    }
    const byPath = new Map(records.map((record) => [record.path, record]));
    const recordsByRef = new Map(records.map((record) => [record.ref, record]));
    const dependencyCache = {
      recordsByPath: byPath,
      recordsByRef,
      snapshots: new Map()
    };
    const preparedWorld = options.executeExplore ? null : (indexWorld ?? prepareExploreWorld(atoms));
    const executeExplore = options.executeExplore ?? ((request) => executeProgramExplore({
      atoms, request, preparedWorld
    }));
    const triggerEvent = options.triggerEvent ?? null;
    if (triggerEvent && (triggerEvent.mode !== 'transform'
      || !Array.isArray(triggerEvent.nodes)
      || triggerEvent.nodes.length === 0
      || triggerEvent.nodes.some((node) => typeof node !== 'string' || !node.trim()))) {
      throw Object.assign(new Error('transform trigger event requires one non-empty nodes string list'), {
        code: 'INVALID_PROGRAM_TRIGGER_EVENT'
      });
    }
    if (triggerEvent) await this.ensureTriggerContracts(
      records, programs, executeExplore, options.agentOrigin
    );
    const triggerIndexBackfilled = this.backfillTriggerIndexForEvent(triggerEvent);
    const eventNodes = new Set((triggerEvent?.nodes ?? []).map((node) => node.trim()));
    const triggeredProgramPaths = new Set();
    if (triggerEvent) {
      for (const node of eventNodes) {
        for (const programPath of this.triggerIndex.get(`${triggerEvent.mode}\0${node}`) ?? []) {
          triggeredProgramPaths.add(programPath);
        }
      }
    }
    const slotCandidates = slotProgramInvocationsForEvent(atoms, triggerEvent);
    let cycleInvocations = null;
    if (typeof options.slotTriggerCycleId === 'string' && options.slotTriggerCycleId) {
      if (!this.slotInvocationCycles.has(options.slotTriggerCycleId)) {
        this.slotInvocationCycles.set(options.slotTriggerCycleId, new Set());
        while (this.slotInvocationCycles.size > this.maxCompleted) {
          this.slotInvocationCycles.delete(this.slotInvocationCycles.keys().next().value);
        }
      }
      cycleInvocations = this.slotInvocationCycles.get(options.slotTriggerCycleId);
    }
    const slotInvocations = [];
    for (const invocation of slotCandidates) {
      const invocationKey = `${invocation.programPath}\0${invocation.scopeRoot}\0${invocation.revision}`;
      if (cycleInvocations?.has(invocationKey)) continue;
      if (!invocation.conditions?.length) {
        cycleInvocations?.add(invocationKey);
        slotInvocations.push(invocation);
        continue;
      }
      let matched = false;
      for (const condition of invocation.conditions) {
        const remainingMs = cycleDeadline - Date.now();
        if (remainingMs <= 0) {
          throw Object.assign(new Error(`Program cycle exceeded ${this.timeoutMs}ms`), {
            code: 'ATOM_PROGRAM_TIMEOUT'
          });
        }
        matched = await evaluateSlotSupportExpr(condition, {
          recordsByPath: byPath,
          evaluateProgram: (selector) => this.evaluateSupportProgram(atoms, selector, {
            timeoutMs: remainingMs,
            scopeRoot: invocation.scopeRoot,
            programRoot: invocation.programRoot,
            executeExplore
          })
        });
        if (matched) break;
      }
      if (matched) {
        cycleInvocations?.add(invocationKey);
        slotInvocations.push(invocation);
      }
    }
    const slotInvocationsByProgram = new Map();
    for (const invocation of slotInvocations) {
      if (!slotInvocationsByProgram.has(invocation.programPath)) {
        slotInvocationsByProgram.set(invocation.programPath, []);
      }
      slotInvocationsByProgram.get(invocation.programPath).push(invocation);
    }
    const fingerprintDependencies = (requests) => dependencyFingerprint(
      requests, executeExplore, records, dependencyCache
    );
    const currentWorldKey = worldRevisionKey(records);
    const scopePath = agentScopePath(options.agentOrigin);
    const reusableEntry = options.force === true || triggerEvent
      ? null
      : reusableCandidates(
        this.reusable, programs, isolateFailures, options.agentOrigin, records,
        availablePrograms
      )[0];
    const reusable = reusableEntry?.[1] ?? null;
    if (reusable) {
      const dependenciesUnchanged = reusable.worldKey === currentWorldKey
        || await fingerprintDependencies(reusable.requests)
          === reusable.dependencyFingerprint;
      if (dependenciesUnchanged) {
        const value = await this.overlayRequestDrivenLocks({
          ...reusable.value,
          fingerprint: key,
          cached: true,
          records,
          locks: rebindLocks(reusable.value.locks, reusable.value.records, records),
          choices: structuredClone(reusable.value.choices ?? []),
          messages: [],
          transforms: [],
          shortcuts: [],
          slotBodies: [],
          failures: structuredClone(reusable.value.failures ?? [])
        }, options.agentOrigin);
        this.completed.set(key, value);
        while (this.completed.size > this.maxCompleted) {
          this.completed.delete(this.completed.keys().next().value);
        }
        if (!options.programSelector) {
          const projectionWarning = await this.saveProjection({
            records,
            programs,
            isolateFailures,
            value,
            requests: reusable.requests,
            agentOrigin: options.agentOrigin
          });
          if (projectionWarning) {
            value.runtimeWarnings = [
              ...(value.runtimeWarnings ?? []),
              projectionWarning
            ];
          }
        }
        return value;
      }
    }
    const diagnosticWarnings = [];
    const recordProgramDiagnostic = async ({ program, requests, startedAt, error = null }) => {
      if (!this.diagnosticRecorder) return;
      const diagnostic = {
        id: crypto.randomUUID(),
        type: 'program',
        durationMs: performance.now() - startedAt,
        outcome: error?.code === 'ATOM_PROGRAM_TIMEOUT'
          ? 'timeout'
          : error ? 'failure' : 'success',
        program: programDiagnosticIdentity(program),
        ...(error ? {
          failure: {
            code: error.code ?? 'ATOM_PROGRAM_FAILED',
            message: error.message ?? 'Python Program failed'
          }
        } : {}),
        affectedAtoms: [
          { path: program.path, ref: program.ref, axes: [] },
          ...requests
            .filter((request) => typeof request?.thing === 'string' && request.thing.trim())
            .map((request) => ({ path: request.thing.trim(), axes: [] }))
        ]
      };
      if (typeof this.diagnosticRecorder.enqueue === 'function') {
        this.diagnosticRecorder.enqueue(diagnostic);
        return;
      }
      try {
        await this.diagnosticRecorder.record(diagnostic);
      } catch (error) {
        diagnosticWarnings.push({
          code: 'PROGRAM_DIAGNOSTIC_RECORD_FAILED',
          message: 'Program completed, but its bounded diagnostic could not be recorded',
          details: { cause: error?.code ?? error?.name ?? 'DIAGNOSTIC_WRITE_FAILED' }
        });
      }
    };
    const dependencyTriggeredProgramPaths = new Set(triggerEvent
      ? [...this.programReadDependencies.entries()].flatMap(([programPath, dependency]) => (
          (dependency.contextDependent !== true || dependency.scopePath === scopePath)
          && dependency.requests.some((request) => requestMayObserveEvent(request, eventNodes))
            ? [programPath]
            : []
        ))
      : []);
    const indexedPrograms = triggerEvent
      ? programs.filter((program) => (
          triggeredProgramPaths.has(program.path)
          || dependencyTriggeredProgramPaths.has(program.path)
          || eventNodes.has(program.path)
          || slotInvocationsByProgram.has(program.path)
        ))
      : programs;
    const operationEntries = indexedPrograms.flatMap((program) => {
      const ownerPath = owningAgentPath(program, recordsByRef);
      if (programUsesJump(program) && ownerPath && ownerPath !== scopePath) return [];
      const scoped = slotInvocationsByProgram.get(program.path) ?? [];
      return scoped.length
        ? scoped.map((slotInvocation) => ({ program, slotInvocation }))
        : [{ program, slotInvocation: null }];
    });
    const operations = operationEntries.map(async ({ program, slotInvocation }) => {
      const dormantKey = programSetFingerprint([program], isolateFailures, records);
      const dormantFailure = this.dormantFailures.get(dormantKey) ?? null;
      const reuseDormantContextFailure = dormantFailure?.contextDependent === true
        && Array.isArray(options.reuseDormantContextFailureCodes)
        && options.reuseDormantContextFailureCodes.includes(dormantFailure.failure?.code);
      const previousEntry = options.force === true
        ? null
        : reusableProgramCandidates(
          this.programReusable, program, isolateFailures, options.agentOrigin,
          records, availablePrograms
        )[0];
      let previous = previousEntry?.[1] ?? null;
      const triggerEntry = this.triggerContracts.get(program.path) ?? null;
      const triggerContract = triggerEntry?.contract ?? null;
      const hasIndexedContract = Boolean(
        triggerContract || (triggerEntry?.changedThings?.length ?? 0) > 0
      );
      const forcedByTrigger = triggerEvent
        && (triggeredProgramPaths.has(program.path) || Boolean(slotInvocation));
      if (dormantFailure
        && options.force !== true
        && !forcedByTrigger
        && !eventNodes.has(program.path)
        && !(dormantFailure.contextDependent === true
          && scopePath
          && !reuseDormantContextFailure)) {
        return {
          programPath: program.path,
          result: {
            locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [], trigger: null
          },
          cached: true,
          requests: dormantFailure.requests,
          contextDependent: dormantFailure.contextDependent === true
        };
      }
      if (triggerEvent
        && !hasIndexedContract
        && !eventNodes.has(program.path)
        && !slotInvocation
        && !previous) {
        return {
          programPath: program.path,
          result: previous ? {
            ...previous.result,
            locks: rebindLocks(previous.result.locks, previous.records, records),
            messages: [],
            transforms: [],
            shortcuts: [],
            slotBodies: []
          } : { locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [], trigger: null },
          cached: true,
          requests: previous?.requests ?? [],
          contextDependent: previous?.contextDependent === true
        };
      }
      if (triggerEvent && hasIndexedContract && !forcedByTrigger) {
        return {
          programPath: program.path,
          result: previous ? {
            ...previous.result,
            locks: rebindLocks(previous.result.locks, previous.records, records),
            messages: [],
            transforms: [],
            shortcuts: [],
            slotBodies: []
          } : { locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [], trigger: null },
          cached: true,
          requests: previous?.requests ?? [],
          contextDependent: previous?.contextDependent === true
        };
      }
      if (previous && !forcedByTrigger) {
        const dependenciesUnchanged = previous.worldKey === currentWorldKey
          || await fingerprintDependencies(previous.requests)
            === previous.dependencyFingerprint;
        if (dependenciesUnchanged) {
          return {
            programPath: program.path,
            result: {
              ...previous.result,
              locks: rebindLocks(previous.result.locks, previous.records, records),
              messages: [],
              transforms: [],
              shortcuts: [],
              slotBodies: []
            },
            cached: true,
            requests: previous.requests,
            contextDependent: previous.contextDependent === true
          };
        }
      }

      const requests = [];
      const executionStartedAt = performance.now();
      try {
        const rawResult = await this.runBounded(() => {
          const remainingMs = cycleDeadline - Date.now();
          if (remainingMs <= 0) {
            throw Object.assign(
              new Error(`Program cycle exceeded ${this.timeoutMs}ms`),
              { code: 'ATOM_PROGRAM_TIMEOUT' }
            );
          }
          const effectiveScopeRoot = slotInvocation?.scopeRoot ?? options.slotScopeRoot ?? null;
          return this.runProgram({
            python: this.python,
            records,
            programs: programMayResolveAnotherProgram(program) ? availablePrograms : [program],
            program,
            timeoutMs: remainingMs,
            triggered: options.force === true || forcedByTrigger,
            changedNodes: [...eventNodes],
            scopeRoot: effectiveScopeRoot,
            programRoot: slotInvocation?.programRoot ?? options.slotScopeRoot ?? null,
            invokeMain: Boolean(slotInvocation),
            programArguments: slotInvocation ? {
              event: {
                mode: triggerEvent.mode,
                path: slotInvocation.eventPath,
                role: slotInvocation.sourceRole
              },
              scope_root: slotInvocation.scopeRoot,
              revision: slotInvocation.revision
            } : {},
            allowedFunctions: (() => {
              const allowed = this.agentSecurity.get(
                agentScopePath(options.agentOrigin)
              )?.functions ?? null;
              if (!allowed || !program.types.includes('agent')) return allowed;
              return [...new Set([...allowed, 'agent'])];
            })(),
            executeExplore: async (request) => {
              requests.push(structuredClone(request));
              const matches = await executeExplore(request, {
                scopeRoot: effectiveScopeRoot,
                programPath: program.path
              });
              rememberDependencySnapshot(dependencyCache, request, matches);
              return matches.map((match) => {
                const record = programExploreRecord(match, byPath);
                if (!record) throw Object.assign(new Error(`Program explore returned an unknown path: ${match.path}`), { code: 'INVALID_PROGRAM_EXPLORE_RESULT' });
                return record;
              });
            }
          });
        });
        const result = program.types.includes('agent')
          ? { ...rawResult, agentRegistrations: [] }
          : rawResult;
        const uniqueRequests = [...new Map(requests.map((request) => (
          [JSON.stringify(request), request]
        ))).values()];
        await recordProgramDiagnostic({
          program, requests: uniqueRequests, startedAt: executionStartedAt
        });
        const contextDependent = requestsDependOnAgent(uniqueRequests)
          || (result.jumps?.length ?? 0) > 0;
        this.setTriggerContract(program, result.trigger ?? null, result.changedThings ?? []);
        const stateKey = contextDependent
          ? contextualProgramSetFingerprint(
            [program], availablePrograms, isolateFailures, scopePath, records
          )
          : reusableProgramSetFingerprint(
            [program], availablePrograms, isolateFailures, records
          );
        if (!slotInvocation && !(options.slotScopeRoot) && (!contextDependent || scopePath)) {
          const reusableState = {
            contextDependent,
            scopePath: contextDependent ? scopePath : null,
            requests: uniqueRequests,
            dependencyFingerprint: await fingerprintDependencies(uniqueRequests),
            worldKey: currentWorldKey,
            result,
            records
          };
          this.programReusable.set(stateKey, reusableState);
          if (!programMayResolveAnotherProgram(program)) {
            const independentStateKey = contextDependent
              ? contextualProgramSetFingerprint(
                [program], [program], isolateFailures, scopePath, records
              )
              : reusableProgramSetFingerprint([program], [program], isolateFailures, records);
            this.programReusable.set(independentStateKey, reusableState);
          }
        }
        return {
          programPath: program.path,
          result,
          cached: false,
          requests: uniqueRequests,
          contextDependent,
          execution: {
            fingerprint: programDiagnosticIdentity(program).fingerprint,
            durationMs: performance.now() - executionStartedAt
          }
        };
      } catch (error) {
        const failure = describeProgramFailure(error, program);
        const uniqueRequests = [...new Map(requests.map((request) => (
          [JSON.stringify(request), request]
        ))).values()];
        await recordProgramDiagnostic({
          program, requests: uniqueRequests, startedAt: executionStartedAt, error
        });
        const contextDependent = requestsDependOnAgent(uniqueRequests)
          || failure.code.startsWith('WINDOW_JUMP_')
          || failure.code === 'SLOT_SCOPE_ROOT_UNBOUND';
        if (contextDependent && !scopePath) {
          if (isolateFailures && !slotInvocation && !options.slotScopeRoot) {
            this.dormantFailures.set(dormantKey, {
              requests: uniqueRequests,
              failure,
              contextDependent: true
            });
            while (this.dormantFailures.size > this.maxCompleted * Math.max(1, this.maxWorkers)) {
              this.dormantFailures.delete(this.dormantFailures.keys().next().value);
            }
          }
          return {
            programPath: program.path,
            failure,
            cached: false,
            requests: uniqueRequests,
            contextDependent,
            execution: {
              fingerprint: programDiagnosticIdentity(program).fingerprint,
              durationMs: performance.now() - executionStartedAt
            }
          };
        }
        if (isolateFailures) {
          if (!slotInvocation && !options.slotScopeRoot && !contextDependent) {
            this.dormantFailures.set(dormantKey, {
              requests: uniqueRequests,
              failure
            });
            while (this.dormantFailures.size > this.maxCompleted * Math.max(1, this.maxWorkers)) {
              this.dormantFailures.delete(this.dormantFailures.keys().next().value);
            }
          }
          return {
            programPath: program.path,
            failure,
            cached: false,
            requests: uniqueRequests,
            contextDependent,
            execution: {
              fingerprint: programDiagnosticIdentity(program).fingerprint,
              durationMs: performance.now() - executionStartedAt
            }
          };
        }
        throw error;
      }
    });
    const settled = await Promise.all(operations);
    const activeProgramPaths = new Set(programs.map((program) => program.path));
    for (const programPath of this.programReadDependencies.keys()) {
      if (!activeProgramPaths.has(programPath)) this.programReadDependencies.delete(programPath);
    }
    const programByPath = new Map(programs.map((program) => [program.path, program]));
    for (const entry of settled) {
      if (!Array.isArray(entry.requests)) continue;
      const program = programByPath.get(entry.programPath);
      if (!program) continue;
      this.programReadDependencies.set(entry.programPath, {
        detail: program.detail,
        requests: structuredClone(entry.requests),
        contextDependent: entry.contextDependent === true,
        scopePath: entry.contextDependent === true ? scopePath : null
      });
    }
    if (!triggerEvent && !options.programSelector && !options.slotScopeRoot) {
      const triggerSources = programs.filter((program) => /\b(?:trigger|changed)\s*\(/u.test(program.detail));
      this.triggerContractsInitialized = triggerSources.every((program) => (
        this.triggerContracts.get(program.path)?.detail === program.detail
      ));
    }
    const applicable = settled.filter((entry) => !(entry.contextDependent === true && !scopePath));
    const contextIncomplete = settled.some((entry) => (
      entry.contextDependent === true && !scopePath
    ));
    const results = applicable.flatMap((entry) => entry.result ? [entry.result] : []);
    const currentAgentPath = agentScopePath(options.agentOrigin);
    const uniqueRequests = [...new Map(applicable.flatMap((entry) => entry.requests).map((request) => (
      [JSON.stringify(request), request]
    ))).values()];
    const exploreReadPaths = await dependencyMatchPaths(uniqueRequests, dependencyCache);
    const executedEntries = applicable.filter((entry) => (
      entry.cached === false && entry.execution
    ));
    const slowestExecution = executedEntries.reduce((slowest, entry) => (
      !slowest || entry.execution.durationMs > slowest.execution.durationMs ? entry : slowest
    ), null);
    const value = {
      fingerprint: key,
      cached: triggerEvent
        ? applicable.every((entry) => entry.cached)
        : applicable.length > 0 && applicable.every((entry) => entry.cached),
      records,
      selectedProgram: options.programSelector ? programs[0] : null,
      locks: results.flatMap((result) => result.locks),
      choices: results.flatMap((result) => result.choices ?? []),
      messages: results.flatMap((result) => result.messages),
      transforms: results.flatMap((result) => result.transforms),
      shortcuts: results.flatMap((result) => result.shortcuts ?? []),
      slotBodies: results.flatMap((result) => result.slotBodies ?? []),
      jumps: applicable.flatMap((entry) => entry.cached === false
        ? entry.result?.jumps ?? []
        : []),
      jumpAuthorizations: applicable.flatMap((entry) => entry.cached === false
        ? entry.result?.jumpAuthorizations ?? []
        : []),
      agentRegistrations: applicable.flatMap((entry) => entry.cached === false
        ? entry.result?.agentRegistrations ?? []
        : []),
      exploreRequests: structuredClone(uniqueRequests),
      exploreReadPaths,
      failures: applicable.flatMap((entry) => entry.failure ? [entry.failure] : []),
      executedProgramPaths: applicable
        .filter((entry) => entry.cached === false && entry.result)
        .map((entry) => entry.programPath),
      reconcileSummary: {
        candidateProgramCount: operationEntries.length,
        executedProgramCount: executedEntries.length,
        triggerIndexBackfilled,
        ...(slowestExecution ? {
          slowestProgramFingerprint: slowestExecution.execution.fingerprint,
          slowestProgramDurationMs: Math.round(slowestExecution.execution.durationMs * 1000) / 1000
        } : {})
      },
      contextIncomplete
    };
    await this.mergeRequestDrivenLocks(value, records, options);
    value.agentSecurity = currentAgentPath
      ? structuredClone(this.agentSecurity.get(currentAgentPath) ?? null)
      : null;
    this.completed.set(key, value);
    while (this.completed.size > this.maxCompleted) {
      this.completed.delete(this.completed.keys().next().value);
    }
    const contextDependent = requestsDependOnAgent(uniqueRequests)
      || results.some((result) => (result.jumps?.length ?? 0) > 0);
    const runtimeWarnings = [
      ...(this.projectionLoadWarning ? [this.projectionLoadWarning] : []),
      ...diagnosticWarnings
    ];
    this.projectionLoadWarning = null;
    if (value.failures.length === 0 && !triggerEvent) {
      const reusableKey = contextDependent
        ? contextualProgramSetFingerprint(
          programs, availablePrograms, isolateFailures, scopePath, records
        )
        : reusableProgramSetFingerprint(
          programs, availablePrograms, isolateFailures, records
        );
      this.reusable.set(reusableKey, {
        contextDependent,
        contextIncomplete,
        scopePath: contextDependent ? scopePath : null,
        requests: uniqueRequests,
        dependencyFingerprint: await fingerprintDependencies(uniqueRequests),
        worldKey: currentWorldKey,
        value
      });
      if (!options.programSelector) {
        const projectionWarning = await this.saveProjection({
          records,
          programs,
          isolateFailures,
          value,
          requests: uniqueRequests,
          agentOrigin: options.agentOrigin
        });
        if (projectionWarning) runtimeWarnings.push(projectionWarning);
      }
    }
    if (runtimeWarnings.length) value.runtimeWarnings = runtimeWarnings;
    while (this.reusable.size > this.maxCompleted) {
      this.reusable.delete(this.reusable.keys().next().value);
    }
    while (this.programReusable.size > this.maxCompleted * Math.max(1, this.maxWorkers)) {
      this.programReusable.delete(this.programReusable.keys().next().value);
    }
    return value;
  }
}

export function createProgramRuntimeScheduler(options) {
  return new ProgramRuntimeScheduler(options);
}
