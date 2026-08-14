import { validateWorldSnapshot } from '../public/contracts.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function validateCycle(cycle) {
  if (!cycle || typeof cycle !== 'object' || Array.isArray(cycle)
    || typeof cycle.fingerprint !== 'string' || !cycle.fingerprint
    || typeof cycle.cached !== 'boolean'
    || !Array.isArray(cycle.records)
    || !Array.isArray(cycle.locks)
    || !Array.isArray(cycle.messages)
    || !Array.isArray(cycle.transforms)) {
    throw problem('INVALID_PROGRAM_CYCLE', 'Program evaluator returned an invalid cycle');
  }
  return cycle;
}

export function createProgramRuntimePort({ evaluate, timeoutMs = 60_000, maxConcurrent = 4 }) {
  if (typeof evaluate !== 'function') {
    throw problem('INVALID_PROGRAM_EVALUATOR', 'Program runtime requires an evaluator');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw problem('INVALID_PROGRAM_TIMEOUT', 'Program timeout must be positive');
  }
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
    throw problem('INVALID_PROGRAM_CONCURRENCY', 'Program concurrency must be a positive integer');
  }

  let active = 0;
  const waiting = [];

  async function acquire(signal) {
    if (signal?.aborted) throw problem('ATOM_PROGRAM_CANCELLED', 'Program evaluation was cancelled');
    if (active >= maxConcurrent) {
      await new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        const cancel = () => {
          const index = waiting.indexOf(waiter);
          if (index >= 0) waiting.splice(index, 1);
          reject(problem('ATOM_PROGRAM_CANCELLED', 'Program evaluation was cancelled'));
        };
        waiter.cancel = cancel;
        waiting.push(waiter);
        signal?.addEventListener('abort', cancel, { once: true });
      });
    }
    active += 1;
    return () => {
      active -= 1;
      const waiter = waiting.shift();
      if (waiter) waiter.resolve();
    };
  }

  async function evaluateRevision({ snapshot: rawSnapshot, interaction = {}, explore, signal: callerSignal }) {
    const snapshot = validateWorldSnapshot(rawSnapshot);
    if (!interaction || typeof interaction !== 'object' || Array.isArray(interaction)) {
      throw problem('INVALID_PROGRAM_INTERACTION', 'Program interaction must be an object');
    }
    if (typeof explore !== 'function') {
      throw problem('INVALID_PROGRAM_EXPLORE', 'Program runtime requires an explore capability');
    }
    const release = await acquire(callerSignal);
    const controller = new AbortController();
    const cancellation = problem('ATOM_PROGRAM_CANCELLED', 'Program evaluation was cancelled');
    const timeout = problem('ATOM_PROGRAM_TIMEOUT', `Program evaluation exceeded ${timeoutMs}ms`);
    const forwardCancellation = () => controller.abort(cancellation);
    callerSignal?.addEventListener('abort', forwardCancellation, { once: true });
    const timer = setTimeout(() => controller.abort(timeout), timeoutMs);
    const aborted = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    });
    try {
      const evaluation = Promise.resolve(evaluate({
        snapshot: structuredClone(snapshot),
        interaction: structuredClone(interaction),
        explore,
        signal: controller.signal,
        deadline: Date.now() + timeoutMs
      }));
      evaluation.catch(() => {});
      const cycle = validateCycle(await Promise.race([evaluation, aborted]));
      if (cycle.sourceRevision !== undefined && cycle.sourceRevision !== snapshot.revision) {
        throw problem('PROGRAM_REVISION_MISMATCH', 'Program cycle belongs to another world revision', {
          expectedRevision: snapshot.revision,
          actualRevision: cycle.sourceRevision
        });
      }
      return Object.freeze({
        contract: 'atom.program-cycle',
        version: 1,
        worldId: snapshot.worldId,
        sourceRevision: snapshot.revision,
        fingerprint: cycle.fingerprint,
        cached: cycle.cached,
        records: structuredClone(cycle.records),
        locks: structuredClone(cycle.locks),
        messages: structuredClone(cycle.messages),
        transforms: structuredClone(cycle.transforms)
      });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardCancellation);
      release();
    }
  }

  return Object.freeze({ evaluateRevision });
}
