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
