export const THING_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const ALPHABET_INDEX = new Map(
  [...THING_ID_ALPHABET].map((character, index) => [character, index])
);
const MAX_SAFE_ORDINAL = Number.MAX_SAFE_INTEGER;

function allocatorError(code, message, details = {}) {
  return Object.assign(new RangeError(message), { code, ...details });
}

function requireSafeOrdinal(ordinal) {
  if (!Number.isSafeInteger(ordinal)) {
    throw allocatorError(
      'UNSAFE_THING_ID_ORDINAL',
      'Thing ID ordinal must be a safe integer',
      { ordinal }
    );
  }
  if (ordinal < 0) {
    throw allocatorError(
      'INVALID_THING_ID_ORDINAL',
      'Thing ID ordinal must not be negative',
      { ordinal }
    );
  }
  if (ordinal === 0) {
    throw allocatorError(
      'RESERVED_THING_ID',
      'Thing ID ordinal 0 is reserved for the allocator watermark',
      { ordinal }
    );
  }
}

export function thingIdForOrdinal(ordinal) {
  requireSafeOrdinal(ordinal);
  let remaining = ordinal;
  let id = '';
  do {
    id = THING_ID_ALPHABET[remaining % THING_ID_ALPHABET.length] + id;
    remaining = Math.floor(remaining / THING_ID_ALPHABET.length);
  } while (remaining > 0);
  return id.padStart(3, '0');
}

function ordinalForId(value) {
  let ordinal = 0;
  for (const character of value) {
    const digit = ALPHABET_INDEX.get(character);
    if (digit === undefined) {
      throw allocatorError('INVALID_THING_ID', 'Thing ID contains a non-Base62 character', { id: value });
    }
    if (ordinal > Math.floor((MAX_SAFE_ORDINAL - digit) / THING_ID_ALPHABET.length)) {
      throw allocatorError('UNSAFE_THING_ID_ORDINAL', 'Thing ID ordinal exceeds safe integer range', { id: value });
    }
    ordinal = ordinal * THING_ID_ALPHABET.length + digit;
  }
  return ordinal;
}

export function parseShortThingId(value) {
  if (typeof value !== 'string' || value.length < 3) {
    throw allocatorError('INVALID_THING_ID', 'Thing ID must be a canonical Base62 string of at least three characters', { id: value });
  }
  const ordinal = ordinalForId(value);
  if (ordinal === 0) {
    throw allocatorError('RESERVED_THING_ID', 'Thing ID 000 is reserved for the allocator watermark', { id: value });
  }
  if (thingIdForOrdinal(ordinal) !== value) {
    throw allocatorError('NONCANONICAL_THING_ID', 'Thing ID is not in canonical shortest form', { id: value });
  }
  return Object.freeze({ id: value, ordinal });
}

function parseWatermark(value) {
  if (value === '000') return Object.freeze({ id: value, ordinal: 0 });
  return parseShortThingId(value);
}

export function planThingIdAllocation({ watermark, count }) {
  const parsedWatermark = parseWatermark(watermark);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw allocatorError(
      'INVALID_THING_ID_COUNT',
      'Thing ID allocation count must be a non-negative safe integer',
      { count }
    );
  }
  if (count === 0) {
    return Object.freeze({ ids: Object.freeze([]), nextWatermark: watermark });
  }
  const start = parsedWatermark.ordinal + 1;
  const end = start + count - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw allocatorError(
      'UNSAFE_THING_ID_ORDINAL',
      'Thing ID allocation exceeds safe integer range',
      { watermark, count }
    );
  }
  const ids = Array.from({ length: count }, (_, index) => thingIdForOrdinal(start + index));
  return Object.freeze({
    ids: Object.freeze(ids),
    nextWatermark: ids.at(-1)
  });
}

export function thingIdentityAllocatorUpdate({ previousWatermark, ids }) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw allocatorError('INVALID_THING_ID_ALLOCATION', 'Thing ID allocation must issue at least one identity');
  }
  const expected = planThingIdAllocation({ watermark: previousWatermark, count: ids.length });
  if (ids.some((id, index) => id !== expected.ids[index])) {
    throw allocatorError('INVALID_THING_ID_ALLOCATION', 'Thing ID allocation must be one contiguous sequence');
  }
  return Object.freeze({
    version: 1,
    previousWatermark,
    nextWatermark: expected.nextWatermark,
    issued: Object.freeze([...ids])
  });
}

export function createThingIdAllocationSession(initialWatermark = '000') {
  parseWatermark(initialWatermark);
  let committedWatermark = initialWatermark;
  let pendingIds = [];
  return Object.freeze({
    reserve(count) {
      const allocation = planThingIdAllocation({
        watermark: pendingIds.at(-1) ?? committedWatermark,
        count
      });
      pendingIds.push(...allocation.ids);
      return [...allocation.ids];
    },
    checkpoint() {
      return Object.freeze({ watermark: committedWatermark, pendingCount: pendingIds.length });
    },
    restore(checkpoint) {
      if (checkpoint?.watermark !== committedWatermark
        || !Number.isSafeInteger(checkpoint?.pendingCount)
        || checkpoint.pendingCount < 0
        || checkpoint.pendingCount > pendingIds.length) {
        throw allocatorError('INVALID_THING_ID_CHECKPOINT', 'Thing ID allocation checkpoint does not belong to the current generation');
      }
      pendingIds = pendingIds.slice(0, checkpoint.pendingCount);
    },
    pendingUpdate() {
      return pendingIds.length
        ? thingIdentityAllocatorUpdate({ previousWatermark: committedWatermark, ids: pendingIds })
        : null;
    },
    confirm(update) {
      const pending = this.pendingUpdate();
      if (!pending || JSON.stringify(update) !== JSON.stringify(pending)) {
        throw allocatorError('THING_IDENTITY_CONFIRMATION_MISMATCH', 'Committed Thing ID allocation does not match the pending allocation');
      }
      committedWatermark = pending.nextWatermark;
      pendingIds = [];
    },
    discard() {
      pendingIds = [];
    },
    watermark() {
      return committedWatermark;
    }
  });
}

export function rebuildThingIdWatermark(receipts) {
  if (!Array.isArray(receipts)) {
    throw allocatorError('INVALID_THING_ID_RECEIPTS', 'Thing ID receipt history must be an array');
  }
  let watermark = '000';
  const issued = new Set();
  const migrationSnapshots = new Map();
  for (const entry of receipts) {
    const receipt = entry?.receipt;
    const commandId = entry?.commandId ?? receipt?.commandId;
    if (receipt?.result?.thingIdentityMigration) {
      migrationSnapshots.set(commandId, { watermark, issued: new Set(issued) });
    }
    const rollback = receipt?.result?.thingIdentityMigrationRollback;
    if (rollback != null) {
      const snapshot = rollback?.version === 1
        ? migrationSnapshots.get(rollback.targetCommandId)
        : null;
      if (!snapshot) {
        throw allocatorError('INVALID_THING_ID_MIGRATION_ROLLBACK', 'Thing ID migration rollback target is invalid');
      }
      watermark = snapshot.watermark;
      issued.clear();
      snapshot.issued.forEach(id => issued.add(id));
    }
    const update = receipt?.result?.thingIdentityAllocator;
    if (update === undefined) continue;
    if (!update || update.version !== 1 || update.previousWatermark !== watermark
      || !Array.isArray(update.issued) || update.issued.some(id => issued.has(id))) {
      throw allocatorError('INVALID_THING_ID_ALLOCATION_HISTORY', 'Thing ID allocation history is not contiguous');
    }
    const canonical = thingIdentityAllocatorUpdate({
      previousWatermark: update.previousWatermark,
      ids: update.issued
    });
    if (canonical.nextWatermark !== update.nextWatermark) {
      throw allocatorError('INVALID_THING_ID_ALLOCATION_HISTORY', 'Thing ID allocation watermark does not match its issued identities');
    }
    update.issued.forEach(id => issued.add(id));
    watermark = update.nextWatermark;
  }
  return watermark;
}
