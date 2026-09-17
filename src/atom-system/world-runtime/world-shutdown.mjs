export const DEFAULT_WORLD_SHUTDOWN_TIMEOUT_MS = 30_000;

export function worldShutdownDeadline({ timeoutMs = DEFAULT_WORLD_SHUTDOWN_TIMEOUT_MS, deadline } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647
    || (deadline !== undefined && (!Number.isSafeInteger(deadline) || deadline < 0))) {
    throw Object.assign(new Error('Shutdown requires a positive finite timeout or absolute deadline'), {
      code: 'INVALID_WORLD_SHUTDOWN_TIMEOUT'
    });
  }
  return deadline ?? Date.now() + timeoutMs;
}

export function worldShutdownTimeout() {
  return Object.assign(new Error('World shutdown exceeded its deadline; pending work is not confirmed saved'), {
    code: 'WORLD_SAVE_CLOSE_TIMEOUT'
  });
}

// Both outcomes of the underlying operation remain observed after the deadline.
export function withinWorldShutdown(operation, deadline) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(worldShutdownTimeout()), Math.max(0, deadline - Date.now()));
    Promise.resolve(operation).then((result) => {
      clearTimeout(timer);
      if (Date.now() >= deadline) reject(worldShutdownTimeout());
      else resolve(result);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
