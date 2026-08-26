import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { legacyAtomContextMetadata } from './context-store.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { executeProgramExplore, prepareExploreWorld } from './query-capability.mjs';
import { matchesExactSelector } from './exact-selector.mjs';
import { normalizeTypePredicate } from './program-locks.mjs';
import { slotProgramInvocationsForEvent } from './slot-body-plan-runtime.mjs';
import { programDiagnosticIdentity } from '../../src/atom-system/world-runtime/year-ring.mjs';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';
import { validateWindowSelfLock, windowPolicyIsSubset } from './window-self-lock.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_WORKERS = 16;
const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'program-worker.py');
const preparedRecordSnapshots = new WeakMap();
const preparedProgramSnapshots = new WeakMap();
const isolatedProgramPathsByRecords = new WeakMap();
const legacyProgramPathsByRecords = new WeakMap();

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
  if (Object.isFrozen(atoms) && preparedRecordSnapshots.has(atoms)) {
    return preparedRecordSnapshots.get(atoms);
  }
  const records = [];
  const worldRevision = revisionOfWorldFacts(atoms).slice('sha256:'.length);
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
    isolatedProgramPathsByRecords.set(records, new Set(legacy.isolatedProgramPaths));
    legacyProgramPathsByRecords.set(records, new Set(legacy.legacyProgramPaths ?? []));
    for (const record of records) {
      if (legacy.legacyProgramPaths?.includes(record.path)) record.legacyGraphAbi = true;
    }
  }
  if (!Object.isFrozen(atoms)) return records;
  const prepared = freezePrepared(records);
  if (legacy) isolatedProgramPathsByRecords.set(prepared, new Set(legacy.isolatedProgramPaths));
  if (legacy) legacyProgramPathsByRecords.set(prepared, new Set(legacy.legacyProgramPaths ?? []));
  preparedRecordSnapshots.set(atoms, prepared);
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
  const legacyProgramPaths = legacyProgramPathsByRecords.get(records) ?? new Set();
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
    && !record.types.includes('migration-isolated')
    && !isolatedPaths.has(record.path)
    && record.detail.trim()
    && !isInsideDefaultBackup(record)
  ));
  programs = programs.map((program) => legacyProgramPaths.has(program.path)
    ? { ...program, legacyGraphAbi: true }
    : program);
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
    programs: programs.map((program) => semanticRecord(program, recordsByRef)),
    isolateFailures
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
  return requests.some((request) => !request?.thing);
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

function dependencySnapshot(request, matches, state) {
  return {
    request,
    matches: matches.map((match) => state.recordsByPath.get(match.path))
      .filter(Boolean)
      .map((record) => semanticRecord(record, state.recordsByRef))
  };
}

function rememberDependencySnapshot(state, request, matches) {
  const key = JSON.stringify(request);
  if (!state.snapshots.has(key)) {
    state.snapshots.set(key, Promise.resolve(dependencySnapshot(request, matches, state)));
  }
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

function rebindLocks(locks, previousRecords, records) {
  const oldPathByRef = new Map(previousRecords.map((record) => [record.ref, record.path]));
  const newRefByPath = new Map(records.map((record) => [record.path, record.ref]));
  return locks.map((lock) => ({
    ...structuredClone(lock),
    sourceProgramRef: newRefByPath.get(lock.sourceProgramPath) ?? lock.sourceProgramRef,
    targets: Array.isArray(lock.targets?.paths) ? structuredClone(lock.targets) : {
      ...structuredClone(lock.targets),
      refs: lock.targets.refs.map((ref) => newRefByPath.get(oldPathByRef.get(ref))).filter(Boolean)
    }
  })).filter((lock) => Array.isArray(lock.targets?.paths) || lock.targets.refs.length);
}

function worldRevisionKey(records) {
  return records[0]?.ref ?? 'empty-world';
}

function validateResult(result, records, program, options = {}) {
  const { scopeRoot = null, supportDecision = false } = options;
  if (!result?.ok) {
    const error = new Error(result?.error?.message || 'Python Program failed');
    error.code = typeof result?.error?.code === 'string'
      ? result.error.code
      : 'ATOM_PROGRAM_FAILED';
    error.details = { program: program.path, type: result?.error?.type };
    throw error;
  }
  const knownRefs = new Set(records.map((record) => record.ref));
  const recordsByPath = new Map(records.map((record) => [record.path, record]));
  const locks = (result.locks ?? []).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw Object.assign(new Error('lock() result must be a JSON object'), { code: 'INVALID_PROGRAM_LOCK' });
    }
    const refs = entry.targets?.refs;
    if (!Array.isArray(refs) || !refs.length || refs.some((ref) => !knownRefs.has(ref))) {
      throw Object.assign(new Error('lock.targets.refs contains an unknown Atom reference'), { code: 'INVALID_PROGRAM_LOCK_TARGET' });
    }
    const targetKeys = Object.keys(entry.targets ?? {});
    const targetScope = entry.targets?.scope ?? 'exact';
    if (targetKeys.some((key) => !['refs', 'scope'].includes(key))
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
    }
    return {
      ...structuredClone(entry),
      targets: { refs: [...refs], ...(targetScope === 'subtree' ? { scope: 'subtree' } : {}) },
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
      ? ['action', 'body', 'name', 'revision']
      : ['action', 'body'];
    const allowed = entry.action === 'seal' ? [...required, 'lock'] : required;
    if (!['seal', 'print'].includes(entry.action)
      || typeof entry.body !== 'string' || !entry.body.trim()
      || keys.some((key) => !allowed.includes(key))
      || required.some((key) => !keys.includes(key))
      || (entry.lock !== undefined && typeof entry.lock !== 'boolean')
      || (entry.action === 'print'
        && (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.includes('/')
          || typeof entry.revision !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(entry.revision)))) {
      throw Object.assign(new Error('slot_body() requires seal {action,body} or current-plan print {action,body,name,revision}'), {
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
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !['guard', 'move', 'recycle'].includes(entry.action)
      || (entry.action === 'move'
        && (typeof entry.destinationPath !== 'string'
          || !recordsByPath.has(entry.destinationPath)))
      || (entry.action !== 'move' && entry.destinationPath !== undefined)) {
      throw Object.assign(new Error('jump() returned an invalid window effect'), {
        code: 'INVALID_WINDOW_JUMP_EFFECT'
      });
    }
    const lock = entry.lock === undefined ? undefined : validateWindowSelfLock(entry.lock);
    return {
      action: entry.action,
      ...(entry.action === 'move' ? { destinationPath: entry.destinationPath } : {}),
      ...(lock !== undefined ? { lock } : {}),
      sourceProgramPath: program.path
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
    if ([locks, messages, transforms, slotBodies, choices, jumps].some((entries) => entries.length > 0)) {
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
    locks, messages, transforms, slotBodies, choices, jumps, changedThings, trigger,
    ...(supportDecision === true ? { supportDecision: result.supportDecision } : {})
  };
}

function bindCurrentWindowPolicy(policy, agentPath) {
  if (!policy) return null;
  return Object.fromEntries(Object.entries(policy).map(([sideName, side]) => [
    sideName,
    Object.fromEntries(Object.entries(side).map(([effect, rules]) => [
      effect,
      rules.map((rule) => ({
        ...rule,
        fromPath: rule.fromPath === '$current' ? agentPath : rule.fromPath,
        ...(rule.fromPath === '$current' ? { currentRelative: true } : {})
      }))
    ]))
  ]));
}

function runWorker({
  python, records, programs, program, timeoutMs, executeExplore, validateOnly = false,
  triggered = false, changedNodes = [], scopeRoot = null, programRoot = null,
  invokeMain = false, programArguments = {}, supportDecision = false
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
        resolve(validateResult(child.__atomResult ?? JSON.parse(stdout), records, program, {
          scopeRoot, supportDecision
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
      legacyGraphAbi: program.legacyGraphAbi === true
        || legacyProgramPathsByRecords.get(records)?.has(program.path) === true
    });
  });
}

function describeProgramFailure(error, program) {
  const jumpFailure = /\bjump\s*\(/u.test(program.detail);
  return {
    code: jumpFailure ? 'WINDOW_JUMP_DESTINATION_INVALID' : error?.code ?? 'ATOM_PROGRAM_FAILED',
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
    this.runProgram = options.runProgram ?? runWorker;
    this.diagnosticRecorder = options.diagnosticRecorder ?? null;
    this.projectionRepository = options.projectionRepository ?? null;
    this.loadedProjection = undefined;
    this.projectionLoadWarning = null;
    this.requestDrivenLockRepository = options.requestDrivenLockRepository ?? null;
    this.requestDrivenLocks = undefined;
    this.triggerContracts = new Map();
    this.triggerIndex = new Map();
    this.triggerContractsInitialized = false;
    this.activeWindowSelfLocks = new Map();
    this.activeWindowAgents = new Set();
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
        const matches = await executeExplore(request);
        const byPath = new Map(records.map((record) => [record.path, record]));
        return matches.map((match) => byPath.get(match.path)).filter(Boolean);
      },
      supportDecision: true,
      triggered: true
    }));
    return result.supportDecision;
  }

  async activeRequestDrivenLocks() {
    if (this.requestDrivenLocks !== undefined) return this.requestDrivenLocks;
    const stored = this.requestDrivenLockRepository
      ? await this.requestDrivenLockRepository.load()
      : { version: 1, locks: [] };
    for (const entry of stored?.windowSelfLocks ?? []) {
      this.activeWindowSelfLocks.set(entry.agentPath, validateWindowSelfLock(entry.policy));
      this.activeWindowAgents.add(entry.agentPath);
    }
    this.requestDrivenLocks = structuredClone(stored?.locks ?? []);
    return this.requestDrivenLocks;
  }

  async persistWindowSelfLocks() {
    if (!this.requestDrivenLockRepository) return;
    await this.requestDrivenLockRepository.save({
      version: 1,
      locks: structuredClone(this.requestDrivenLocks ?? []),
      windowSelfLocks: [...this.activeWindowSelfLocks].map(([agentPath, policy]) => ({
        agentPath, policy: structuredClone(policy)
      }))
    });
  }

  async recycleWindowSelfLock(agentPath) {
    this.activeWindowSelfLocks.delete(agentPath);
    this.activeWindowAgents.delete(agentPath);
    await this.persistWindowSelfLocks();
  }

  async remapWindowSelfLock(previousPath, nextPath) {
    const policy = this.activeWindowSelfLocks.get(nextPath)
      ?? this.activeWindowSelfLocks.get(previousPath);
    this.activeWindowSelfLocks.delete(previousPath);
    this.activeWindowAgents.delete(previousPath);
    if (policy) this.activeWindowSelfLocks.set(nextPath, policy);
    this.activeWindowAgents.add(nextPath);
    await this.persistWindowSelfLocks();
  }

  async replaceWindowSelfLock({ callerPath, targetPath, policy, records, authorize }) {
    if (typeof callerPath !== 'string' || typeof targetPath !== 'string'
      || !Array.isArray(records) || typeof authorize !== 'function') {
      throw Object.assign(new Error('Window self-lock replacement requires exact caller and target coordinates'), {
        code: 'INVALID_WINDOW_SELF_LOCK'
      });
    }
    await this.activeRequestDrivenLocks();
    const normalized = policy == null ? null : validateWindowSelfLock(policy);
    const previous = this.activeWindowSelfLocks.get(targetPath) ?? null;
    if (callerPath === targetPath) {
      if (normalized == null || !windowPolicyIsSubset({
        previous,
        next: normalized,
        agentPath: targetPath,
        targetPaths: records.map((record) => record.path)
      })) {
        throw Object.assign(new Error('An active window cannot expand or remove its own self-lock'), {
          code: 'WINDOW_SELF_LOCK_EXPANSION_DENIED'
        });
      }
    } else {
      const decision = await authorize(targetPath, 'write');
      if (decision?.decision !== 'allow') {
        throw Object.assign(new Error('Caller cannot reach the target window through both lock systems'), {
          code: 'WINDOW_ACCESS_DENIED'
        });
      }
    }
    if (normalized) this.activeWindowSelfLocks.set(targetPath, normalized);
    else this.activeWindowSelfLocks.delete(targetPath);
    this.activeWindowAgents.add(targetPath);
    await this.persistWindowSelfLocks();
    return normalized;
  }

  async overlayRequestDrivenLocks(value) {
    const active = await this.activeRequestDrivenLocks();
    return {
      ...value,
      locks: [
        ...(value.locks ?? []).filter((lock) => lock.refresh?.policy !== 'on_request'),
        ...structuredClone(active)
      ],
      windowSelfLocks: [...this.activeWindowSelfLocks].map(([agentPath, policy]) => ({
        agentPath, policy: structuredClone(policy)
      })),
      windowSelfLockAgents: [...this.activeWindowAgents]
    };
  }

  async mergeRequestDrivenLocks(value, records, options) {
    const active = await this.activeRequestDrivenLocks();
    const automatic = value.locks.filter((lock) => lock.refresh?.policy !== 'on_request');
    if (options.force === true && options.programSelector && value.failures.length === 0) {
      const sourcePath = value.selectedProgram?.path ?? options.programSelector;
      const pathByRef = new Map(records.map((record) => [record.ref, record.path]));
      const replacement = value.locks
        .filter((lock) => lock.refresh?.policy === 'on_request')
        .map((lock) => ({
          ...structuredClone(lock),
          targets: {
            paths: lock.targets.refs.map((ref) => pathByRef.get(ref)).filter(Boolean),
            ...(lock.targets.scope === 'subtree' ? { scope: 'subtree' } : {})
          }
        }));
      const next = [
        ...active.filter((lock) => lock.sourceProgramPath !== sourcePath),
        ...replacement
      ];
      if (this.requestDrivenLockRepository) {
        await this.requestDrivenLockRepository.save({
          version: 1,
          locks: next,
          windowSelfLocks: [...this.activeWindowSelfLocks].map(([agentPath, policy]) => ({
            agentPath, policy: structuredClone(policy)
          }))
        });
      }
      this.requestDrivenLocks = next;
    }
    value.locks = [...automatic, ...structuredClone(this.requestDrivenLocks ?? active)];
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

  async ensureTriggerContracts(records, programs, executeExplore) {
    if (this.triggerContractsInitialized) return;
    const recordsByPath = new Map(records.map((record) => [record.path, record]));
    const candidates = programs.filter((program) => (
      /\b(?:trigger|changed)\s*\(/u.test(program.detail)
      && this.triggerContracts.get(program.path)?.detail !== program.detail
    ));
    const inspected = await Promise.all(candidates.map((program) => this.runBounded(() => (
      this.runProgram({
        python: this.python,
        records,
        programs,
        program,
        timeoutMs: this.timeoutMs,
        executeExplore: async (request) => {
          const matches = await executeExplore(request);
          return matches.map((match) => {
            const record = recordsByPath.get(match.path);
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
      this.setTriggerContract(
        program,
        inspected[index].trigger ?? null,
        inspected[index].changedThings ?? []
      );
    }
    this.triggerContractsInitialized = true;
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
    records, programs, isolateFailures, fingerprint: cycleFingerprint, agentOrigin
  }) {
    const stored = await this.loadProjection();
    const programSetKey = programSetFingerprint(programs, isolateFailures, records);
    if (!stored || stored.version !== 1
      || stored.worldKey !== worldRevisionKey(records)
      || stored.programSetKey !== programSetKey
      || (stored.contextIncomplete === true && agentScopePath(agentOrigin))
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
      messages: [],
      transforms: [],
      slotBodies: [],
      failures: structuredClone(stored.failures),
      contextIncomplete: stored.contextIncomplete === true
    });
  }

  async saveProjection({ records, programs, isolateFailures, value, requests, agentOrigin }) {
    if (!this.projectionRepository) return;
    const contextDependent = requestsDependOnAgent(requests);
    const scopePath = contextDependent ? agentScopePath(agentOrigin) : null;
    if (contextDependent && !scopePath) return;
    const projection = {
      version: 1,
      worldKey: worldRevisionKey(records),
      programSetKey: programSetFingerprint(programs, isolateFailures, records),
      contextDependent,
      contextIncomplete: value.contextIncomplete === true,
      scopePath,
      locks: structuredClone(value.locks.filter((lock) => lock.refresh?.policy !== 'on_request')),
      choices: structuredClone(value.choices ?? []),
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
    const records = worldRecords(atoms);
    const availablePrograms = programRecords(records);
    const programs = options.programSelector
      ? programRecords(records, options.programSelector)
      : availablePrograms;
    const isolateFailures = options.isolateFailures === true;
    const key = fingerprint(records, programs, options.agentOrigin, isolateFailures);
    const completed = this.completed.get(key);
    if (completed) return this.overlayRequestDrivenLocks({
      ...completed, cached: true, messages: [], transforms: [], slotBodies: []
    });

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
        slotBodies: [],
        failures: structuredClone(reusable.value.failures ?? [])
      });
      this.completed.set(key, value);
      return value;
    }

    const persisted = options.programSelector
      ? null
      : await this.persistedProjection({
        records, programs, isolateFailures, fingerprint: key, agentOrigin: options.agentOrigin
      });
    if (persisted) {
      this.completed.set(key, persisted);
      return persisted;
    }
    const error = new Error('No validated Program projection exists for the current world revision');
    error.code = 'ATOM_PROGRAM_PROJECTION_MISSING';
    error.details = { worldKey: worldRevisionKey(records) };
    throw error;
  }

  async refresh(atoms, options = {}) {
    const records = worldRecords(atoms);
    const compatibility = legacyAtomContextMetadata(atoms);
    if (compatibility) {
      isolatedProgramPathsByRecords.set(records, new Set(compatibility.isolatedProgramPaths ?? []));
      legacyProgramPathsByRecords.set(records, new Set(compatibility.legacyProgramPaths ?? []));
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
        ...cached, cached: true, messages: [], transforms: [], slotBodies: []
      });
    }
    if (this.inflight.has(key)) {
      return this.inflight.get(key).then((value) => ({
        ...value, cached: true, messages: [], transforms: [], slotBodies: []
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
    if (options.force !== true && !options.programSelector && !options.triggerEvent) {
      const persisted = await this.persistedProjection({
        records, programs, isolateFailures, fingerprint: key, agentOrigin: options.agentOrigin
      });
      if (persisted) {
        this.completed.set(key, persisted);
        return persisted;
      }
    }
    const byPath = new Map(records.map((record) => [record.path, record]));
    const dependencyCache = {
      recordsByPath: byPath,
      recordsByRef: new Map(records.map((record) => [record.ref, record])),
      snapshots: new Map()
    };
    const preparedWorld = options.executeExplore ? null : prepareExploreWorld(atoms);
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
    if (triggerEvent) await this.ensureTriggerContracts(records, programs, executeExplore);
    const eventNodes = new Set((triggerEvent?.nodes ?? []).map((node) => node.trim()));
    const triggeredProgramPaths = new Set();
    if (triggerEvent) {
      for (const node of eventNodes) {
        for (const programPath of this.triggerIndex.get(`${triggerEvent.mode}\0${node}`) ?? []) {
          triggeredProgramPaths.add(programPath);
        }
      }
    }
    const slotInvocations = slotProgramInvocationsForEvent(atoms, triggerEvent);
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
          slotBodies: [],
          failures: structuredClone(reusable.value.failures ?? [])
        });
        this.completed.set(key, value);
        while (this.completed.size > this.maxCompleted) {
          this.completed.delete(this.completed.keys().next().value);
        }
        return value;
      }
    }
    const diagnosticWarnings = [];
    const recordProgramDiagnostic = async ({ program, requests, startedAt, error = null }) => {
      if (!this.diagnosticRecorder) return;
      try {
        await this.diagnosticRecorder.record({
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
        });
      } catch (error) {
        diagnosticWarnings.push({
          code: 'PROGRAM_DIAGNOSTIC_RECORD_FAILED',
          message: 'Program completed, but its bounded diagnostic could not be recorded',
          details: { cause: error?.code ?? error?.name ?? 'DIAGNOSTIC_WRITE_FAILED' }
        });
      }
    };
    const operationEntries = programs.flatMap((program) => {
      const scoped = slotInvocationsByProgram.get(program.path) ?? [];
      return scoped.length
        ? scoped.map((slotInvocation) => ({ program, slotInvocation }))
        : [{ program, slotInvocation: null }];
    });
    const operations = operationEntries.map(async ({ program, slotInvocation }) => {
      const previousEntry = options.force === true
        ? null
        : reusableCandidates(
          this.programReusable, [program], isolateFailures, options.agentOrigin,
          records, availablePrograms
        )[0];
      const previous = previousEntry?.[1] ?? null;
      const triggerEntry = this.triggerContracts.get(program.path) ?? null;
      const triggerContract = triggerEntry?.contract ?? null;
      const hasIndexedContract = Boolean(
        triggerContract || (triggerEntry?.changedThings?.length ?? 0) > 0
      );
      const forcedByTrigger = triggerEvent
        && (triggeredProgramPaths.has(program.path) || Boolean(slotInvocation));
      if (triggerEvent
        && !hasIndexedContract
        && !eventNodes.has(program.path)
        && !slotInvocation
        && (this.triggerIndex.size > 0 || !previous)) {
        return {
          programPath: program.path,
          result: previous ? {
            ...previous.result,
            locks: rebindLocks(previous.result.locks, previous.records, records),
            messages: [],
            transforms: [],
            slotBodies: []
          } : { locks: [], messages: [], transforms: [], slotBodies: [], choices: [], trigger: null },
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
            slotBodies: []
          } : { locks: [], messages: [], transforms: [], slotBodies: [], choices: [], trigger: null },
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
        const result = await this.runBounded(() => {
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
            programs: availablePrograms,
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
            executeExplore: async (request) => {
              requests.push(structuredClone(request));
              const matches = await executeExplore(request, {
                scopeRoot: effectiveScopeRoot,
                programPath: program.path
              });
              rememberDependencySnapshot(dependencyCache, request, matches);
              return matches.map((match) => {
                const record = byPath.get(match.path);
                if (!record) throw Object.assign(new Error(`Program explore returned an unknown path: ${match.path}`), { code: 'INVALID_PROGRAM_EXPLORE_RESULT' });
                return record;
              });
            }
          });
        });
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
          this.programReusable.set(stateKey, {
            contextDependent,
            scopePath: contextDependent ? scopePath : null,
            requests: uniqueRequests,
            dependencyFingerprint: await fingerprintDependencies(uniqueRequests),
            worldKey: currentWorldKey,
            result,
            records
          });
        }
        return { programPath: program.path, result, cached: false, requests: uniqueRequests, contextDependent };
      } catch (error) {
        const failure = describeProgramFailure(error, program);
        const uniqueRequests = [...new Map(requests.map((request) => (
          [JSON.stringify(request), request]
        ))).values()];
        await recordProgramDiagnostic({
          program, requests: uniqueRequests, startedAt: executionStartedAt, error
        });
        const contextDependent = requestsDependOnAgent(uniqueRequests);
        if (contextDependent && !scopePath) {
          return { programPath: program.path, failure, cached: false, requests: uniqueRequests, contextDependent };
        }
        if (isolateFailures) {
          return { programPath: program.path, failure, cached: false, requests: uniqueRequests, contextDependent };
        }
        throw error;
      }
    });
    const settled = await Promise.all(operations);
    const applicable = settled.filter((entry) => !(entry.contextDependent === true && !scopePath));
    const contextIncomplete = settled.some((entry) => (
      entry.contextDependent === true && !scopePath
    ));
    const results = applicable.flatMap((entry) => entry.result ? [entry.result] : []);
    const currentAgentPath = agentScopePath(options.agentOrigin);
    let windowSelfLocks = applicable.flatMap((entry) => (
      entry.result?.jumps ?? []
    ).filter((jump) => jump.lock).map((jump) => ({
      agentPath: currentAgentPath,
      sourceProgramPath: jump.sourceProgramPath,
      policy: bindCurrentWindowPolicy(jump.lock, currentAgentPath)
    })));
    const windowSelfLockAgents = currentAgentPath && results.some((result) => (
      (result.jumps?.length ?? 0) > 0
    )) ? [currentAgentPath] : [];
    if (currentAgentPath && windowSelfLockAgents.length) {
      this.activeWindowAgents.add(currentAgentPath);
      const proposed = windowSelfLocks.at(-1)?.policy ?? null;
      const previous = this.activeWindowSelfLocks.get(currentAgentPath);
      if (proposed && previous && !windowPolicyIsSubset({
        previous,
        next: proposed,
        agentPath: currentAgentPath,
        targetPaths: records.map((record) => record.path)
      })) {
        throw Object.assign(new Error('An active window may keep or tighten, but not expand, its own self-lock'), {
          code: 'WINDOW_SELF_LOCK_EXPANSION_DENIED',
          details: { agentPath: currentAgentPath }
        });
      }
      if (proposed) this.activeWindowSelfLocks.set(currentAgentPath, proposed);
      const effective = this.activeWindowSelfLocks.get(currentAgentPath);
      windowSelfLocks = effective ? [{
        agentPath: currentAgentPath,
        sourceProgramPath: windowSelfLocks.at(-1)?.sourceProgramPath ?? null,
        policy: effective
      }] : [];
    }
    const uniqueRequests = [...new Map(applicable.flatMap((entry) => entry.requests).map((request) => (
      [JSON.stringify(request), request]
    ))).values()];
    const value = {
      fingerprint: key,
      cached: applicable.length > 0 && applicable.every((entry) => entry.cached),
      records,
      selectedProgram: options.programSelector ? programs[0] : null,
      locks: results.flatMap((result) => result.locks),
      choices: results.flatMap((result) => result.choices ?? []),
      messages: results.flatMap((result) => result.messages),
      transforms: results.flatMap((result) => result.transforms),
      slotBodies: results.flatMap((result) => result.slotBodies ?? []),
      jumps: applicable.flatMap((entry) => entry.cached === false
        ? entry.result?.jumps ?? []
        : []),
      windowSelfLocks,
      windowSelfLockAgents,
      exploreRequests: structuredClone(uniqueRequests),
      failures: applicable.flatMap((entry) => entry.failure ? [entry.failure] : []),
      executedProgramPaths: applicable
        .filter((entry) => entry.cached === false && entry.result)
        .map((entry) => entry.programPath),
      contextIncomplete
    };
    await this.mergeRequestDrivenLocks(value, records, options);
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
    if (value.failures.length === 0) {
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
