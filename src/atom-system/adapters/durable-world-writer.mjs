import { Worker } from 'node:worker_threads';

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
  worker.on('message', (message) => {
    if (message.ready) { readyResolve(); return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve({ revision: message.revision });
    else entry.reject(problem(message.error?.code ?? 'WORLD_SAVE_FAILED',
      message.error?.message ?? 'Durable world save failed'));
  });
  function fail(error) {
    failed = error;
    readyReject(error);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  }
  worker.on('error', fail);
  worker.on('exit', (code) => {
    if (!closed) fail(problem('WORLD_SAVE_WORKER_EXITED', `Durable world writer exited (${code})`));
  });
  return Object.freeze({
    async save({ records = [], events, revision, projectionFiles = [] }) {
      if (closed || failed) throw failed ?? problem('WORLD_SAVE_WORKER_CLOSED', 'Writer is closed');
      if (!Array.isArray(records) || !Array.isArray(projectionFiles)
        || (events !== undefined && !Array.isArray(events))
        || typeof revision !== 'string') {
        throw problem('INVALID_WORLD_SAVE_BATCH', 'Save requires ordered records and revision');
      }
      await ready;
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { worker.postMessage({ id, records, events, revision, projectionFiles }); }
        catch (error) { pending.delete(id); reject(error); }
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const entry of pending.values()) entry.reject(problem('WORLD_SAVE_WORKER_CLOSED', 'Writer closed'));
      pending.clear();
      await worker.terminate();
    }
  });
}
