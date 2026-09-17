import { Worker } from 'node:worker_threads';
import { sealWorldFactsRevision } from '../world-runtime/world-revision.mjs';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

export function createDurableWorldWriter({ contextFile, journalFile, worldId = 'primary' }) {
  if (!contextFile || !journalFile) {
    throw problem('INVALID_WORLD_WRITER', 'Durable world writer requires context and journal files');
  }
  const worker = new Worker(new URL('./durable-world-save-worker.mjs', import.meta.url), {
    workerData: { contextFile, journalFile, worldId }
  });
  const pending = new Map();
  let nextId = 0;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let failed = null;
  let closed = false;
  let closing = null;
  let initialization = null;
  worker.on('message', (message) => {
    if (message.ready) { readyResolve(); return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(problem(message.error?.code ?? 'WORLD_SAVE_FAILED',
      message.error?.message ?? 'Durable world save failed'));
  });
  function fail(error) {
    failed ??= error;
    readyReject(failed);
    for (const entry of pending.values()) entry.reject(failed);
    pending.clear();
  }
  worker.on('error', fail);
  worker.on('exit', (code) => {
    if (!closed) fail(problem('WORLD_SAVE_WORKER_EXITED', `Durable world writer exited (${code})`));
  });
  async function request(operation, payload = {}) {
    if (closed || failed) throw failed ?? problem('WORLD_SAVE_WORKER_CLOSED', 'Writer is closed');
    await ready;
    if (closed || failed) throw failed ?? problem('WORLD_SAVE_WORKER_CLOSED', 'Writer is closed');
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, operation, ...payload }); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }
  function initialize() {
    initialization ??= request('initialize').then((result) => {
      // Structured cloning across a worker boundary drops both freezing and
      // the local revision seal. Restore that invariant before memory adoption.
      const snapshot = result.initialSnapshot;
      if (snapshot?.worldId !== worldId
        || sealWorldFactsRevision(snapshot.facts) !== snapshot.revision) {
        throw problem('INVALID_WORLD_REVISION', 'Recovered snapshot failed revision verification');
      }
      Object.freeze(snapshot);
      return result;
    });
    return initialization;
  }
  // A worker can fail before a caller starts its first RPC.
  ready.catch(() => {});
  return Object.freeze({
    // Only transport events set failed. An RPC/data error is not a reason to
    // replace the worker and repeat disk recovery.
    get lifecycle() {
      return Object.freeze({ closed, terminalFailure: failed
        ? Object.freeze({ code: failed.code ?? failed.name, message: failed.message }) : null });
    },
    initialize,
    async findCommitted(commandId) {
      if (typeof commandId !== 'string' || !commandId) {
        throw problem('INVALID_WORLD_HISTORY_QUERY', 'History lookup requires a command id');
      }
      await initialize();
      return request('findCommitted', { commandId });
    },
    async save({ records = [], events, revision, projectionFiles = [] }) {
      if (closed || failed) throw failed ?? problem('WORLD_SAVE_WORKER_CLOSED', 'Writer is closed');
      if (!Array.isArray(records) || !Array.isArray(projectionFiles)
        || (events !== undefined && !Array.isArray(events))
        || typeof revision !== 'string') {
        throw problem('INVALID_WORLD_SAVE_BATCH', 'Save requires ordered records and revision');
      }
      await initialize();
      return request('save', { records, events, revision, projectionFiles });
    },
    async close() {
      if (closing) return closing;
      closed = true;
      readyReject(problem('WORLD_SAVE_WORKER_CLOSED', 'Writer closed'));
      for (const entry of pending.values()) entry.reject(problem('WORLD_SAVE_WORKER_CLOSED', 'Writer closed'));
      pending.clear();
      closing = worker.terminate();
      return closing;
    }
  });
}
