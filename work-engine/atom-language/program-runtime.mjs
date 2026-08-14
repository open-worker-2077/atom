import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAtomKey } from './key-parser.mjs';
import { executeProgramExplore } from './query-capability.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;
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
  const programs = records.filter((record) => record.types.includes('program') && record.detail.trim());
  if (!selector) return programs;
  const matches = programs.filter((program) => (
    selector.includes('/') ? program.path === selector : program.name === selector
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
    agentOrigin: agentOrigin ? { ref: agentOrigin.ref, path: agentOrigin.path } : null,
    isolateFailures
  })).digest('hex');
}

function programSetFingerprint(programs, agentOrigin, isolateFailures) {
  return crypto.createHash('sha256').update(JSON.stringify({
    programs: programs.map(({ path: programPath, detail, types }) => ({ path: programPath, detail, types })),
    agentOrigin: agentOrigin ? { ref: agentOrigin.ref, path: agentOrigin.path } : null,
    isolateFailures
  })).digest('hex');
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

async function dependencyFingerprint(requests, executeExplore, records) {
  const recordsByPath = new Map(records.map((record) => [record.path, record]));
  const recordsByRef = new Map(records.map((record) => [record.ref, record]));
  const snapshots = [];
  for (const request of requests) {
    try {
      const matches = await executeExplore(structuredClone(request));
      snapshots.push({
        request,
        matches: matches.map((match) => recordsByPath.get(match.path))
          .filter(Boolean)
          .map((record) => semanticRecord(record, recordsByRef))
      });
    } catch (error) {
      snapshots.push({
        request,
        error: {
          code: error?.code ?? 'PROGRAM_DEPENDENCY_QUERY_FAILED',
          message: error?.message ?? 'Program dependency query failed',
          details: error?.details ?? {}
        }
      });
    }
  }
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
  return { locks, messages, transforms };
}

function runWorker({ python, records, program, timeoutMs, executeExplore }) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-X', 'utf8', workerFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
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
              child.stdin.write(`${JSON.stringify({ id: event.id, ok: true, result })}\n`);
            } catch (error) {
              child.stdin.write(`${JSON.stringify({ id: event.id, ok: false, error: { code: error.code, message: error.message } })}\n`);
            }
            return;
          }
          child.__atomResult = event;
        });
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', async (code) => {
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
    child.stdin.write(`${JSON.stringify({ world: records, program })}\n`);
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
    this.maxWorkers = options.maxWorkers ?? 4;
    this.activeWorkers = 0;
    this.workerQueue = [];
    this.reusable = new Map();
    this.programReusable = new Map();
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

  async refresh(atoms, options = {}) {
    const records = worldRecords(atoms);
    const programs = programRecords(records, options.programSelector);
    const isolateFailures = options.isolateFailures === true;
    const stableKey = fingerprint(records, programs, options.agentOrigin, isolateFailures);
    const key = options.force === true ? `${stableKey}:${crypto.randomUUID()}` : stableKey;
    if (this.completed.has(key)) {
      const cached = this.completed.get(key);
      return { ...cached, cached: true, messages: [], transforms: [] };
    }
    if (this.inflight.has(key)) {
      return this.inflight.get(key).then((value) => ({
        ...value, cached: true, messages: [], transforms: []
      }));
    }
    const byPath = new Map(records.map((record) => [record.path, record.ref]));
    const executeExplore = options.executeExplore ?? ((request) => executeProgramExplore({ atoms, request }));
    const reusableKey = programSetFingerprint(programs, options.agentOrigin, isolateFailures);
    const reusable = options.force === true ? null : this.reusable.get(reusableKey);
    if (reusable) {
      const currentDependencyFingerprint = await dependencyFingerprint(
        reusable.requests, executeExplore, records
      );
      if (currentDependencyFingerprint === reusable.dependencyFingerprint) {
        const value = {
          ...reusable.value,
          fingerprint: key,
          cached: true,
          records,
          locks: rebindLocks(reusable.value.locks, reusable.value.records, records),
          messages: [],
          transforms: [],
          failures: []
        };
        this.completed.set(key, value);
        while (this.completed.size > this.maxCompleted) {
          this.completed.delete(this.completed.keys().next().value);
        }
        return value;
      }
    }
    const deadline = Date.now() + this.timeoutMs;
    const operations = programs.map(async (program) => {
      const stateKey = programSetFingerprint([program], options.agentOrigin, isolateFailures);
      const previous = options.force === true ? null : this.programReusable.get(stateKey);
      if (previous) {
        const currentDependencyFingerprint = await dependencyFingerprint(
          previous.requests, executeExplore, records
        );
        if (currentDependencyFingerprint === previous.dependencyFingerprint) {
          if (previous.failure) {
            const failure = {
              ...previous.failure,
              programRef: program.ref,
              details: { ...previous.failure.details, program: program.path }
            };
            if (isolateFailures) return { failure, cached: true, requests: previous.requests };
            const error = Object.assign(new Error(failure.message), {
              code: failure.code, details: failure.details
            });
            throw error;
          }
          return {
            result: {
              ...previous.result,
              locks: rebindLocks(previous.result.locks, previous.records, records),
              messages: [],
              transforms: []
            },
            cached: true,
            requests: previous.requests
          };
        }
      }

      const requests = [];
      try {
        const result = await this.runBounded(() => runWorker({
          python: this.python, records, program, timeoutMs: Math.max(1, deadline - Date.now()),
          executeExplore: async (request) => {
            requests.push(structuredClone(request));
            const matches = await executeExplore(request);
            return matches.map((match) => {
              const ref = byPath.get(match.path);
              if (!ref) throw Object.assign(new Error(`Program explore returned an unknown path: ${match.path}`), { code: 'INVALID_PROGRAM_EXPLORE_RESULT' });
              return ref;
            });
          }
        }));
        const uniqueRequests = [...new Map(requests.map((request) => (
          [JSON.stringify(request), request]
        ))).values()];
        this.programReusable.set(stateKey, {
          requests: uniqueRequests,
          dependencyFingerprint: await dependencyFingerprint(uniqueRequests, executeExplore, records),
          result,
          records
        });
        return { result, cached: false, requests: uniqueRequests };
      } catch (error) {
        const failure = describeProgramFailure(error, program);
        const uniqueRequests = [...new Map(requests.map((request) => (
          [JSON.stringify(request), request]
        ))).values()];
        this.programReusable.set(stateKey, {
          requests: uniqueRequests,
          dependencyFingerprint: await dependencyFingerprint(uniqueRequests, executeExplore, records),
          failure,
          records
        });
        if (isolateFailures) return { failure, cached: false, requests: uniqueRequests };
        throw error;
      }
    });
    const settledResults = Promise.all(operations);
    const pending = settledResults.then(async (settled) => {
      const results = settled.flatMap((entry) => entry.result ? [entry.result] : []);
      const value = {
        fingerprint: key,
        cached: programs.length > 0 && settled.every((entry) => entry.cached),
        records,
        selectedProgram: options.programSelector ? programs[0] : null,
        locks: results.flatMap((result) => result.locks),
        messages: results.flatMap((result) => result.messages),
        transforms: results.flatMap((result) => result.transforms),
        failures: settled.flatMap((entry) => entry.failure && !entry.cached ? [entry.failure] : [])
      };
      this.completed.set(key, value);
      while (this.completed.size > this.maxCompleted) {
        this.completed.delete(this.completed.keys().next().value);
      }
      const uniqueRequests = [...new Map(settled.flatMap((entry) => entry.requests).map((request) => (
        [JSON.stringify(request), request]
      ))).values()];
      this.reusable.set(reusableKey, {
        requests: uniqueRequests,
        dependencyFingerprint: await dependencyFingerprint(uniqueRequests, executeExplore, records),
        value
      });
      while (this.reusable.size > this.maxCompleted) {
        this.reusable.delete(this.reusable.keys().next().value);
      }
      while (this.programReusable.size > this.maxCompleted * Math.max(1, this.maxWorkers)) {
        this.programReusable.delete(this.programReusable.keys().next().value);
      }
      return value;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, pending);
    return pending;
  }
}

export function createProgramRuntimeScheduler(options) {
  return new ProgramRuntimeScheduler(options);
}
