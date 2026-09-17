function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

export function createIndependentWorldSaver({
  save,
  quietMs,
  maxDirtyMs,
  retryMs = maxDirtyMs,
  onSaved = () => {},
  clock = { now: () => Date.now(), setTimeout, clearTimeout }
}) {
  if (typeof save !== 'function' || typeof onSaved !== 'function'
    || ![quietMs, maxDirtyMs, retryMs].every((value) => Number.isFinite(value) && value >= 0)) {
    throw problem('INVALID_WORLD_SAVER', 'Saver requires save and non-negative scheduling intervals');
  }
  let acceptedVersion = 0;
  let savedVersion = 0;
  let pending = null;
  let inFlight = null;
  let quietTimer = null;
  let maxTimer = null;
  let dirtySince = null;
  let failure = null;
  let closed = false;

  function clearTimers() {
    if (quietTimer !== null) clock.clearTimeout(quietTimer);
    if (maxTimer !== null) clock.clearTimeout(maxTimer);
    quietTimer = null;
    maxTimer = null;
  }

  function schedule(delay, kind) {
    const timer = clock.setTimeout(() => {
      if (kind === 'quiet') quietTimer = null;
      else maxTimer = null;
      void persistLatest().catch(() => {});
    }, delay);
    timer?.unref?.();
    return timer;
  }

  function armTimers() {
    if (!pending || closed) return;
    if (quietTimer !== null) clock.clearTimeout(quietTimer);
    quietTimer = schedule(quietMs, 'quiet');
    if (maxTimer === null) {
      maxTimer = schedule(Math.max(0, maxDirtyMs - (clock.now() - dirtySince)), 'max');
    }
  }

  async function persistLatest() {
    if (inFlight) return inFlight;
    if (!pending) return null;
    const target = pending;
    pending = null;
    clearTimers();
    const running = (async () => {
      try {
        const revision = await save(target);
        if (revision !== target.revision) {
          throw problem('WORLD_SAVE_REVISION_MISMATCH', 'Saver returned a different revision');
        }
        await onSaved({ version: target.version, revision });
        savedVersion = target.version;
        failure = null;
        if (!pending) dirtySince = null;
        return target;
      } catch (error) {
        if (!pending || pending.version < target.version) pending = target;
        failure = { code: error.code ?? error.name ?? 'WORLD_SAVE_FAILED' };
        if (!closed) {
          clearTimers();
          quietTimer = schedule(retryMs, 'quiet');
        }
        throw error;
      } finally {
        inFlight = null;
        if (pending && !failure && !closed) armTimers();
      }
    })();
    inFlight = running;
    return running;
  }

  async function flush() {
    clearTimers();
    while (inFlight || pending) {
      if (inFlight) await inFlight;
      else await persistLatest();
    }
    return status();
  }

  function status() {
    return Object.freeze({ acceptedVersion, savedVersion,
      pending: acceptedVersion > savedVersion,
      failure: failure ? Object.freeze({ ...failure }) : null });
  }

  return Object.freeze({
    enqueue(version) {
      if (closed) throw problem('WORLD_SAVER_CLOSED', 'Cannot enqueue after saver closes');
      if (!Number.isSafeInteger(version?.version) || version.version <= acceptedVersion
        || typeof version.revision !== 'string' || !version.revision) {
        throw problem('INVALID_WORLD_SAVE_VERSION', 'Accepted save version must increase');
      }
      acceptedVersion = version.version;
      pending = Object.freeze({ ...version });
      dirtySince ??= clock.now();
      armTimers();
      return status();
    },
    status,
    flush,
    async close() {
      closed = true;
      clearTimers();
      return flush();
    }
  });
}
