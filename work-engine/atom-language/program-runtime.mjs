import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAtomKey } from './key-parser.mjs';
import { executeProgramExplore, prepareExploreWorld } from './query-capability.mjs';
import { matchesExactSelector } from './exact-selector.mjs';
import { programDiagnosticIdentity } from '../../src/atom-system/world-runtime/year-ring.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_WORKERS = 16;
const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'program-worker.py');

function fields(atom) {
  const result = new Map();
  for (const [key, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(key, { descriptionSymbolWarnings: false });
    if (!parsed.errors.length && !result.has(parsed.baseKey)) result.set(parsed.baseKey, { parsed, value });
  }
  return result;
}

function worldRecords(atoms) {
  const records = [];
  const worldRevision = crypto.createHash('sha256').update(JSON.stringify(atoms)).digest('hex');
  function visit(atom, parentRef, parentPath, address) {
    const stored = fields(atom);
    const name = stored.get('name')?.value;
    const atomPath = [...parentPath, name].join('/');
    const ref = crypto.createHash('sha256').update(`${worldRevision}:${address}`).digest('base64url').slice(0, 24);
    const record = {
      ref,
      name,
      detail: stored.get('detail')?.value ?? '',
      path: atomPath,
      types: stored.get('name')?.parsed.types.map((type) => type.raw) ?? [],
      parentRef,
      childrenRefs: [],
      partners: structuredClone(stored.get('partners')?.value ?? [])
    };
    records.push(record);
    for (const [index, child] of (stored.get('children')?.value ?? []).entries()) {
      const childRecord = visit(child, ref, [...parentPath, name], `${address}/${index}`);
      record.childrenRefs.push(childRecord.ref);
    }
    return record;
  }
  for (const [index, atom] of atoms.entries()) visit(atom, null, [], `${index}`);
  return records;
}

function programRecords(records, selector = null) {
  const recordsByRef = new Map(records.map((record) => [record.ref, record]));
  const insideDefaultBackup = new Map();
  const isInsideDefaultBackup = (record) => {
    if (!record) return false;
    if (insideDefaultBackup.has(record.ref)) return insideDefaultBackup.get(record.ref);
    const lineage = [];
    let current = record;
    while (current && !insideDefaultBackup.has(current.ref)) {
      lineage.push(current);
      if (current.types.includes('backup') && current.types.includes('default')) break;
      current = current.parentRef ? recordsByRef.get(current.parentRef) : null;
    }
    let inactive = current
      ? insideDefaultBackup.get(current.ref)
        ?? (current.types.includes('backup') && current.types.includes('default'))
      : false;
    while (lineage.length) {
      insideDefaultBackup.set(lineage.pop().ref, inactive);
    }
    return inactive;
  };
  const programs = records.filter((record) => (
    record.types.includes('program')
    && record.detail.trim()
    && !isInsideDefaultBackup(record)
  ));
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
    records,
    programs,
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
  return requests.some((request) => !request?.name);
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
    targets: {
      ...structuredClone(lock.targets),
      refs: lock.targets.refs.map((ref) => newRefByPath.get(oldPathByRef.get(ref))).filter(Boolean)
    }
  })).filter((lock) => lock.targets.refs.length);
}

function worldRevisionKey(records) {
  return records[0]?.ref ?? 'empty-world';
}

function validateResult(result, records, program) {
  if (!result?.ok) {
    const error = new Error(result?.error?.message || 'Python Program failed');
    error.code = 'ATOM_PROGRAM_FAILED';
    error.details = { program: program.path, type: result?.error?.type };
    throw error;
  }
  const knownRefs = new Set(records.map((record) => record.ref));
  const locks = (result.locks ?? []).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw Object.assign(new Error('lock() result must be a JSON object'), { code: 'INVALID_PROGRAM_LOCK' });
    }
    const refs = entry.targets?.refs;
    if (!Array.isArray(refs) || !refs.length || refs.some((ref) => !knownRefs.has(ref))) {
      throw Object.assign(new Error('lock.targets.refs contains an unknown Atom reference'), { code: 'INVALID_PROGRAM_LOCK_TARGET' });
    }
    if (!['write', 'read_write'].includes(entry.mode)) {
      throw Object.assign(new Error('lock.mode must be write or read_write'), { code: 'INVALID_PROGRAM_LOCK_MODE' });
    }
    const fields = entry.fields ?? ['name', 'detail', 'children', 'partners'];
    if (!Array.isArray(fields) || !fields.length
      || fields.some((field) => !['name', 'detail', 'children', 'partners', 'messages'].includes(field))) {
      throw Object.assign(new Error('lock.fields contains an unsupported Atom field'), { code: 'INVALID_PROGRAM_LOCK_FIELDS' });
    }
    const protect = entry.protect ?? { atom: true, messages: false };
    if (!protect || typeof protect !== 'object' || Array.isArray(protect)
      || typeof (protect.atom ?? true) !== 'boolean'
      || typeof (protect.messages ?? false) !== 'boolean') {
      throw Object.assign(new Error('lock.protect must be a JSON object of booleans'), { code: 'INVALID_PROGRAM_LOCK_PROTECT' });
    }
    return {
      ...structuredClone(entry), fields, protect: { atom: protect.atom ?? true, messages: protect.messages ?? false },
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
      sourceProgramPath: program.path
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
  return { locks, messages, transforms, choices };
}

function runWorker({ python, records, programs, program, timeoutMs, executeExplore }) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-X', 'utf8', workerFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });
    let stdout = '';
    let stderr = '';
    let workerClosed = false;
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
      if (code !== 0) {
        reject(Object.assign(new Error(stderr || `Python worker exited ${code}`), { code: 'ATOM_PROGRAM_WORKER_FAILED' }));
        return;
      }
      try {
        resolve(validateResult(child.__atomResult ?? JSON.parse(stdout), records, program));
      } catch (error) {
        reject(error);
      }
    });
    writeToWorker({
      world: programs ?? records.filter((record) => record.types.includes('program')),
      program
    });
  });
}

function describeProgramFailure(error, program) {
  return {
    code: error?.code ?? 'ATOM_PROGRAM_FAILED',
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
    return {
      fingerprint: cycleFingerprint,
      cached: true,
      records,
      selectedProgram: null,
      locks: structuredClone(stored.locks),
      choices: structuredClone(stored.choices ?? []),
      messages: [],
      transforms: [],
      failures: structuredClone(stored.failures),
      contextIncomplete: stored.contextIncomplete === true
    };
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
      locks: structuredClone(value.locks),
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
    if (completed) return { ...completed, cached: true, messages: [], transforms: [] };

    const reusable = reusableCandidates(
      this.reusable, programs, isolateFailures, options.agentOrigin, records,
      availablePrograms
    ).map(([, entry]) => entry).find((entry) => (
      entry.worldKey === worldRevisionKey(records)
    ));
    if (reusable?.worldKey === worldRevisionKey(records)) {
      const value = {
        ...reusable.value,
        fingerprint: key,
        cached: true,
        records,
        locks: rebindLocks(reusable.value.locks, reusable.value.records, records),
        choices: structuredClone(reusable.value.choices ?? []),
        messages: [],
        transforms: [],
        failures: structuredClone(reusable.value.failures ?? [])
      };
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
    const availablePrograms = programRecords(records);
    const programs = options.programSelector
      ? programRecords(records, options.programSelector)
      : availablePrograms;
    const isolateFailures = options.isolateFailures === true;
    const stableKey = fingerprint(records, programs, options.agentOrigin, isolateFailures);
    const key = options.force === true ? `${stableKey}:${crypto.randomUUID()}` : stableKey;
    const completed = this.completed.get(key);
    if (completed && completed.failures.length === 0) {
      const cached = completed;
      return { ...cached, cached: true, messages: [], transforms: [] };
    }
    if (this.inflight.has(key)) {
      return this.inflight.get(key).then((value) => ({
        ...value, cached: true, messages: [], transforms: []
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
    if (options.force !== true && !options.programSelector) {
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
    const fingerprintDependencies = (requests) => dependencyFingerprint(
      requests, executeExplore, records, dependencyCache
    );
    const currentWorldKey = worldRevisionKey(records);
    const scopePath = agentScopePath(options.agentOrigin);
    const reusableEntry = options.force === true
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
        const value = {
          ...reusable.value,
          fingerprint: key,
          cached: true,
          records,
          locks: rebindLocks(reusable.value.locks, reusable.value.records, records),
          choices: structuredClone(reusable.value.choices ?? []),
          messages: [],
          transforms: [],
          failures: structuredClone(reusable.value.failures ?? [])
        };
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
              .filter((request) => typeof request?.name === 'string' && request.name.trim())
              .map((request) => ({ path: request.name.trim(), axes: [] }))
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
    const operations = programs.map(async (program) => {
      const previousEntry = options.force === true
        ? null
        : reusableCandidates(
          this.programReusable, [program], isolateFailures, options.agentOrigin,
          records, availablePrograms
        )[0];
      const previous = previousEntry?.[1] ?? null;
      if (previous) {
        const dependenciesUnchanged = previous.worldKey === currentWorldKey
          || await fingerprintDependencies(previous.requests)
            === previous.dependencyFingerprint;
        if (dependenciesUnchanged) {
          return {
            result: {
              ...previous.result,
              locks: rebindLocks(previous.result.locks, previous.records, records),
              messages: [],
              transforms: []
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
          return this.runProgram({
            python: this.python,
            records,
            programs: availablePrograms,
            program,
            timeoutMs: remainingMs,
            executeExplore: async (request) => {
              requests.push(structuredClone(request));
              const matches = await executeExplore(request);
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
        const contextDependent = requestsDependOnAgent(uniqueRequests);
        const stateKey = contextDependent
          ? contextualProgramSetFingerprint(
            [program], availablePrograms, isolateFailures, scopePath, records
          )
          : reusableProgramSetFingerprint(
            [program], availablePrograms, isolateFailures, records
          );
        if (!contextDependent || scopePath) {
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
        return { result, cached: false, requests: uniqueRequests, contextDependent };
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
          return { failure, cached: false, requests: uniqueRequests, contextDependent };
        }
        if (isolateFailures) {
          return { failure, cached: false, requests: uniqueRequests, contextDependent };
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
    const value = {
      fingerprint: key,
      cached: applicable.length > 0 && applicable.every((entry) => entry.cached),
      records,
      selectedProgram: options.programSelector ? programs[0] : null,
      locks: results.flatMap((result) => result.locks),
      choices: results.flatMap((result) => result.choices ?? []),
      messages: results.flatMap((result) => result.messages),
      transforms: results.flatMap((result) => result.transforms),
      failures: applicable.flatMap((entry) => entry.failure ? [entry.failure] : []),
      contextIncomplete
    };
    this.completed.set(key, value);
    while (this.completed.size > this.maxCompleted) {
      this.completed.delete(this.completed.keys().next().value);
    }
    const uniqueRequests = [...new Map(applicable.flatMap((entry) => entry.requests).map((request) => (
      [JSON.stringify(request), request]
    ))).values()];
    const contextDependent = requestsDependOnAgent(uniqueRequests);
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
