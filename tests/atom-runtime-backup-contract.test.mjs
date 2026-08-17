import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAtomRuntimeBackupTrigger } from '../src/atom-system/operations/atom-runtime-backup-trigger.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('private Atom runtime backup copies only recovery data and never deletes prior copies', async () => {
  const source = await fs.readFile(path.join(root, 'scripts', 'backup-atom-runtime.ps1'), 'utf8');
  assert.match(source, /atom\.json/);
  assert.match(source, /submissions\.jsonl/);
  assert.match(source, /Copy-Item/);
  assert.match(source, /git -C \$repositoryRoot push origin \$Branch/);
  assert.doesNotMatch(source, /graph\.json|knowledge\.json|Remove-Item|\/MIR/);
});

test('each authoritative Atom write schedules one serialized private backup', async () => {
  const callbacks = [];
  const runs = [];
  const watcher = { close() {} };
  const trigger = createAtomRuntimeBackupTrigger({
    worldDirectory: 'C:/AtomGraph/worlds/primary',
    backupRepository: 'C:/private/atom_backup',
    watch: (_directory, _options, callback) => { callbacks.push(callback); return watcher; },
    runBackup: async (request) => { runs.push(request); return true; },
    setTimer: (handler) => { handler(); return 1; },
    clearTimer: () => {}
  });
  trigger.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 1, 'startup captures the current recoverable state');
  callbacks[0]('change', 'graph.json');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 1, 'derived projections never create private backup churn');
  callbacks[0]('change', 'atom.json');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 2);
  assert.equal(runs[1].worldDirectory.endsWith('primary'), true);
  trigger.close();
});

test('runtime changes share one fixed five-minute backup window', async () => {
  const callbacks = [];
  const runs = [];
  const timers = [];
  const trigger = createAtomRuntimeBackupTrigger({
    worldDirectory: 'C:/AtomGraph/worlds/primary',
    backupRepository: 'C:/private/atom_backup',
    watch: (_directory, _options, callback) => {
      callbacks.push(callback);
      return { close() {} };
    },
    runBackup: async (request) => {
      runs.push(request);
      return true;
    },
    setTimer: (handler, delayMs) => {
      const timer = { handler, delayMs };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {}
  });

  trigger.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 1, 'startup still captures the current recoverable state immediately');

  callbacks[0]('change', 'atom.json');
  callbacks[0]('change', 'submissions.jsonl');
  trigger.schedule();
  assert.equal(timers.length, 1, 'later changes join the active backup window instead of postponing it');
  assert.equal(timers[0].delayMs, 5 * 60 * 1_000);

  await timers[0].handler();
  assert.equal(runs.length, 2, 'the merged changes produce one private backup version');
  trigger.close();
});
