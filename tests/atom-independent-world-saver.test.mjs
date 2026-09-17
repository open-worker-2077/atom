import assert from 'node:assert/strict';
import test from 'node:test';

import { createIndependentWorldSaver } from '../src/atom-system/world-runtime/independent-world-saver.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    async advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers].sort((left, right) => left[1].at - right[1].at)[0];
        if (!due || due[1].at > target) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
    }
  };
}

test('a burst of accepted versions saves only the latest after the quiet window', async () => {
  const saved = [];
  const saver = createIndependentWorldSaver({
    quietMs: 10,
    maxDirtyMs: 100,
    save: async (version) => { saved.push(version.version); return version.revision; }
  });
  saver.enqueue({ version: 1, revision: 'one' });
  saver.enqueue({ version: 2, revision: 'two' });

  await saver.flush();

  assert.deepEqual(saved, [2]);
  assert.equal(saver.status().savedVersion, 2);
  await saver.close();
});

test('a blocked save never blocks another accepted version and catches up in order', async () => {
  const gate = deferred();
  const started = deferred();
  const saved = [];
  const saver = createIndependentWorldSaver({
    quietMs: 0,
    maxDirtyMs: 100,
    save: async (version) => {
      saved.push(version.version);
      if (version.version === 1) { started.resolve(); await gate.promise; }
      return version.revision;
    }
  });
  saver.enqueue({ version: 1, revision: 'one' });
  await started.promise;
  for (let version = 2; version <= 100; version += 1) {
    saver.enqueue({ version, revision: `revision-${version}` });
  }
  assert.equal(saver.status().acceptedVersion, 100);
  assert.equal(saver.status().savedVersion, 0);
  gate.resolve();

  await saver.flush();

  assert.deepEqual(saved, [1, 100]);
  assert.equal(saver.status().savedVersion, 100);
  await saver.close();
});

test('a failed save keeps the newest version pending and can be retried', async () => {
  let attempts = 0;
  const saver = createIndependentWorldSaver({
    quietMs: 100,
    maxDirtyMs: 1000,
    save: async (version) => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return version.revision;
    }
  });
  saver.enqueue({ version: 1, revision: 'one' });
  await assert.rejects(saver.flush(), { code: 'ENOSPC' });
  assert.equal(saver.status().savedVersion, 0);
  assert.equal(saver.status().failure.code, 'ENOSPC');

  await saver.flush();

  assert.equal(saver.status().savedVersion, 1);
  assert.equal(saver.status().failure, null);
  await saver.close();
});

test('continuous edits cannot postpone saving beyond the maximum dirty age', async () => {
  const clock = fakeClock();
  const saved = [];
  const saver = createIndependentWorldSaver({
    clock,
    quietMs: 20,
    maxDirtyMs: 35,
    save: async (version) => { saved.push(version.version); return version.revision; }
  });
  saver.enqueue({ version: 1, revision: 'one' });
  await clock.advance(10);
  saver.enqueue({ version: 2, revision: 'two' });
  await clock.advance(10);
  saver.enqueue({ version: 3, revision: 'three' });

  await clock.advance(15);

  assert.deepEqual(saved, [3]);
  assert.equal(saver.status().savedVersion, 3);
  await saver.close();
});

test('a failed final flush stops retry timers and rejects new save targets', async () => {
  const clock = fakeClock();
  let attempts = 0;
  const saver = createIndependentWorldSaver({ clock, quietMs: 10, maxDirtyMs: 100, retryMs: 5,
    save: async () => { attempts += 1; throw Object.assign(new Error('dead'), { code: 'DEAD' }); } });
  saver.enqueue({ version: 1, revision: 'one' });
  await assert.rejects(saver.close(), { code: 'DEAD' });
  await clock.advance(20);
  assert.equal(attempts, 1, 'shutdown must not leave a background retry timer');
  assert.throws(() => saver.enqueue({ version: 2, revision: 'two' }), { code: 'WORLD_SAVER_CLOSED' });
  assert.equal(saver.status().pending, true);
});
