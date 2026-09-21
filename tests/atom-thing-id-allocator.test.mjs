import assert from 'node:assert/strict';
import test from 'node:test';

import {
  THING_ID_ALPHABET,
  parseShortThingId,
  planThingIdAllocation,
  thingIdForOrdinal
} from '../work-engine/atom-language/thing-id-allocator.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

test('Thing IDs use the fixed case-sensitive Base62 alphabet', () => {
  assert.equal(
    THING_ID_ALPHABET,
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  );
  assert.equal(thingIdForOrdinal(1), '001');
  assert.equal(thingIdForOrdinal(10), '00A');
  assert.equal(thingIdForOrdinal(35), '00Z');
  assert.equal(thingIdForOrdinal(36), '00a');
  assert.equal(thingIdForOrdinal(238327), 'zzz');
  assert.equal(thingIdForOrdinal(238328), '1000');
  assert.notEqual(parseShortThingId('00A').ordinal, parseShortThingId('00a').ordinal);
});

test('short Thing ID parsing rejects reserved, padded, malformed, and unsafe values', () => {
  assert.throws(() => parseShortThingId('000'), { code: 'RESERVED_THING_ID' });
  for (const value of ['', '0', '00', '0001', '00_', '00-', 'é00', null, 1]) {
    assert.throws(() => parseShortThingId(value));
  }
  for (const ordinal of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assert.throws(() => thingIdForOrdinal(ordinal));
  }
});

test('batch allocation accepts the reserved watermark and crosses the three-digit boundary', () => {
  assert.deepEqual(
    planThingIdAllocation({ watermark: '000', count: 3 }),
    { ids: ['001', '002', '003'], nextWatermark: '003' }
  );
  assert.deepEqual(
    planThingIdAllocation({ watermark: 'zzz', count: 2 }),
    { ids: ['1000', '1001'], nextWatermark: '1001' }
  );
  assert.deepEqual(
    planThingIdAllocation({ watermark: '00A', count: 0 }),
    { ids: [], nextWatermark: '00A' }
  );
  for (const count of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
    assert.throws(() => planThingIdAllocation({ watermark: '000', count }));
  }
});

test('parseAtomKey defaults to canonical short identities', () => {
  const parsed = parseAtomKey('thing@program&id=00A#窗口');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.identity, '00A');
  assert.equal(parsed.persistentKey, 'thing@program&id=00A#窗口');

  const legacy = parseAtomKey('thing@program&id=AbCdEfGhIjKlMnOpQrStUv#窗口');
  assert.equal(legacy.identity, null);
  assert.equal(legacy.errors[0].code, 'INVALID_THING_IDENTITY');
});

test('legacy 22-character identities require explicit migration parsing', () => {
  const rawKey = 'thing@program&id=AbCdEfGhIjKlMnOpQrStUv#窗口';
  const parsed = parseAtomKey(rawKey, { identityContract: 'legacy-22-migration' });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.identity, 'AbCdEfGhIjKlMnOpQrStUv');

  const short = parseAtomKey('thing@program&id=00A', {
    identityContract: 'legacy-22-migration'
  });
  assert.equal(short.errors[0].code, 'INVALID_THING_IDENTITY');
});
