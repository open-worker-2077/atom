import { isSealedWorldFacts, prepareWorldFactsRevision } from './world-revision.mjs';

export const DEFAULT_PENDING_WORLD_LIMITS = Object.freeze({
  maxBytes: 512 * 1024 * 1024, maxEvents: 2048, maxEventBytes: 64 * 1024 * 1024
});
export const isWorldCapacityError = error => ['WORLD_SAVE_BACKPRESSURE', 'WORLD_SAVE_EVENT_TOO_LARGE'].includes(error?.code);
export const isHardCapacityBlocked = outcome => outcome?.status === 'pending'
  && outcome.capacityBlocked?.code === 'WORLD_SAVE_EVENT_TOO_LARGE';
const factBytes = new WeakMap();
const jsonBytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

function worldBytes(facts) {
  if (!isSealedWorldFacts(facts)) return jsonBytes(facts);
  if (!factBytes.has(facts)) factBytes.set(facts, Buffer.byteLength(prepareWorldFactsRevision(facts).json, 'utf8'));
  return factBytes.get(facts);
}

export function pendingWorldEventBytes(event) {
  const record = event.record;
  if (event.kind !== 'record' || record.historyMode === 'local-patch') return jsonBytes(event);
  // Count the same logical JSON payload without serializing sealed worlds again.
  return jsonBytes({ ...event, record: { ...record,
    before: { ...record.before, facts: [] }, after: { ...record.after, facts: [] } } })
    + worldBytes(record.before.facts) + worldBytes(record.after.facts) - 4;
}

// One owner's logical pending evidence budget, not an RSS quota or a work queue.
export function createPendingWorldCapacity(configuration = {}) {
  const limits = Object.freeze({ ...DEFAULT_PENDING_WORLD_LIMITS, ...configuration });
  if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0)) {
    throw Object.assign(new Error('Pending limits must be positive safe integers'), { code: 'INVALID_WORLD_PENDING_LIMITS' });
  }
  const entries = new Map();
  let bytes = 0;
  let pressure = null;
  function check(size, extraBytes = size, extraEvents = 1) {
    const code = size > limits.maxEventBytes ? 'WORLD_SAVE_EVENT_TOO_LARGE'
      : bytes + extraBytes > limits.maxBytes || entries.size + extraEvents > limits.maxEvents
        ? 'WORLD_SAVE_BACKPRESSURE' : null;
    if (code) {
      pressure = { code, requiredBytes: size, retryable: code === 'WORLD_SAVE_BACKPRESSURE' };
      throw Object.assign(new Error('Pending world save capacity is exhausted'), { code,
        details: { ...pressure, limits } });
    }
  }
  return Object.freeze({
    limits,
    reserve(sizes) {
      for (const size of sizes) check(size, 0, 0);
      check(Math.max(...sizes), sizes.reduce((sum, size) => sum + size, 0), sizes.length);
      return sizes.map(size => {
        const token = Object.freeze({});
        entries.set(token, { bytes: size, accepted: false }); bytes += size;
        return token;
      });
    },
    resize(token, size) {
      const entry = entries.get(token);
      if (!entry || entry.accepted) throw new Error('Unknown pending reservation');
      check(size, size - entry.bytes, 0);
      const released = entry.bytes > size;
      bytes += size - entry.bytes; entry.bytes = size;
      return released;
    },
    accept(token) { entries.get(token).accepted = true; },
    release(tokens) {
      let released = false;
      for (const token of tokens) {
        const entry = entries.get(token);
        if (!entry) continue;
        bytes -= entry.bytes; entries.delete(token); released = true;
      }
      if (released) pressure = null;
      return released;
    },
    status() {
      let reservedBytes = 0, reservedEvents = 0;
      for (const entry of entries.values()) if (!entry.accepted) { reservedBytes += entry.bytes; reservedEvents++; }
      return Object.freeze({ limits, bytes, events: entries.size, reservedBytes, reservedEvents,
        pressure: pressure ? { ...pressure } : null });
    }
  });
}
