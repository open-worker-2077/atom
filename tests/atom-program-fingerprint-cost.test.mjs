import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

test('repeated projection validation reuses immutable Program semantics but rejects a changed source', async (t) => {
  let stored;
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: {
      load: async () => structuredClone(stored),
      save: async value => { stored = structuredClone(value); }
    }
  });
  const atoms = [{ 'thing@program': 'P', situation: 'value = 1', slot: [], strut: [] }];
  await scheduler.refresh(atoms, { isolateFailures: true });
  assert.equal((await scheduler.assertContextFreeProjection(atoms)).persisted, true);
  const original = crypto.createHash;
  let semanticHashes = 0;
  t.mock.method(crypto, 'createHash', (...args) => {
    const hash = original(...args);
    const update = hash.update.bind(hash);
    hash.update = (value, ...rest) => {
      if (typeof value === 'string' && value.startsWith('{"programs":') && value.includes('"parentPath":')) semanticHashes += 1;
      return update(value, ...rest);
    };
    return hash;
  });
  await scheduler.assertContextFreeProjection(atoms);
  await scheduler.assertContextFreeProjection(atoms);
  assert.equal(semanticHashes, 0, 'unchanged immutable semantics must not be serialized and hashed again');
  await assert.rejects(scheduler.assertContextFreeProjection(atoms, { isolateFailures: false }),
    { code: 'ATOM_PROGRAM_PROJECTION_MISSING' });
  atoms[0].situation = 'value = 2';
  await assert.rejects(scheduler.assertContextFreeProjection(atoms),
    { code: 'ATOM_PROGRAM_PROJECTION_MISSING' });
});
